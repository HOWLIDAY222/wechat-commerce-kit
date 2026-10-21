import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runWeChatRefundSyncWorker, type RefundSyncDependencies, type RefundSyncPayment } from "../../lib/services/wechat-refund-sync-worker";
import type { LegacyWeChatRefundCandidate, LegacyWeChatRefundPage } from "../../lib/providers/wechat-refund-sync";

function fixture(count = 1) {
  const directory = mkdtempSync(join(tmpdir(), "refund-sync-worker-")), stateFile = join(directory, "state.json");
  let now = 1_800_000_000_000, releases = 0, held = true;
  const payments: RefundSyncPayment[] = Array.from({ length: count }, (_, index) => ({ id: "pay" + String(index + 1).padStart(4, "0"), merchantOrderNo: "merchant" + index, gatewayTradeNo: String(1_000_000 + index) }));
  const visited: string[] = [], applied: string[] = [];
  const deps: RefundSyncDependencies = {
    scope: createHash("sha256").update("isolated-refund-worker-fixture").digest("hex"), configured: () => true, now: () => now,
    acquireLock: async () => ({ assertHeld: async () => { if (!held) throw Error("WECHAT_REFUND_SYNC_LOCK_LOST"); }, release: async () => { releases++; } }),
    listPayments: async (afterId, take) => payments.filter(row => !afterId || row.id > afterId).slice(0, take),
    discover: async input => { visited.push(input.merchantOrderNo); return { candidates: [], totalRefundCount: 0, offset: input.offset ?? 0, nextOffset: null, complete: true }; },
    verify: async candidate => ({ out_refund_no: candidate.outRefundNo, refund_id: candidate.refundId, out_trade_no: candidate.merchantOrderNo, transaction_id: candidate.transactionId, status: "SUCCESS", amount: { total: candidate.totalAmountCents, refund: candidate.refundAmountCents, currency: "CNY" } }),
    apply: async result => { applied.push(result.out_refund_no); },
  };
  return { directory, stateFile, deps, payments, visited, applied, advance: (ms = 60_000) => { now += ms; }, loseLock: () => { held = false; }, releases: () => releases, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
function candidate(payment: RefundSyncPayment, index = 0): LegacyWeChatRefundCandidate {
  return { outRefundNo: "refund" + String(index).padStart(3, "0"), refundId: String(2_000_000 + index), merchantOrderNo: payment.merchantOrderNo,
    transactionId: payment.gatewayTradeNo!, totalAmountCents: 1000, refundAmountCents: 10, providerStatus: "SUCCESS", source: "LEGACY_QUERY" };
}
function pages(rows: LegacyWeChatRefundCandidate[]) {
  return async (input: { offset?: number }): Promise<LegacyWeChatRefundPage> => {
    const offset = input.offset ?? 0, candidates = rows.slice(offset, offset + 10), complete = offset + candidates.length === rows.length;
    return { candidates, offset, totalRefundCount: rows.length, nextOffset: complete ? null : offset + candidates.length, complete };
  };
}

test("missing credentials fails visibly before lock or state writes", async () => {
  const f = fixture(); try { f.deps.configured = () => false; f.deps.acquireLock = async () => { throw Error("lock must not run"); };
    await assert.rejects(runWeChatRefundSyncWorker({ stateFile: f.stateFile }, f.deps), /NOT_CONFIGURED/); assert.equal(existsSync(f.stateFile), false);
  } finally { f.cleanup(); }
});
test("overlapping process skips without writing a cursor", async () => {
  const f = fixture(); try { f.deps.acquireLock = async () => null; const result = await runWeChatRefundSyncWorker({ stateFile: f.stateFile }, f.deps);
    assert.equal(result.skipped, "LOCKED"); assert.equal(existsSync(f.stateFile), false);
  } finally { f.cleanup(); }
});
test("keyset cursor persists across runs and fairly wraps through all payments", async () => {
  const f = fixture(7); try { for (let n = 0; n < 4; n++) assert.equal((await runWeChatRefundSyncWorker({ stateFile: f.stateFile, batchSize: 2 }, f.deps)).ok, true);
    assert.deepEqual(f.visited.slice(0, 7), f.payments.map(row => row.merchantOrderNo)); assert.equal(f.releases(), 4);
  } finally { f.cleanup(); }
});
test("both discovery pages complete before signed V3 observations can apply", async () => {
  const f = fixture(); try { const rows = Array.from({ length: 11 }, (_, n) => candidate(f.payments[0], n)); let pageCount = 0;
    const discover = pages(rows); f.deps.discover = async input => { pageCount++; return discover(input); }; f.deps.apply = async result => { assert.equal(pageCount, 2); f.applied.push(result.out_refund_no); };
    const result = await runWeChatRefundSyncWorker({ stateFile: f.stateFile }, f.deps); assert.equal(result.ok, true); assert.equal(f.applied.length, 11); assert.equal(result.gatewayRequests, 13);
  } finally { f.cleanup(); }
});
test("changing cross-page totals applies nothing and records incomplete failure", async () => {
  const f = fixture(); try { const discover = pages(Array.from({ length: 11 }, (_, n) => candidate(f.payments[0], n)));
    f.deps.discover = async input => { const page = await discover(input); if (input.offset) page.totalRefundCount = 12; return page; };
    const result = await runWeChatRefundSyncWorker({ stateFile: f.stateFile }, f.deps); assert.equal(result.ok, false); assert.equal(f.applied.length, 0); assert.equal(result.errorCounts.WECHAT_REFUND_SYNC_DISCOVERY_INCOMPLETE, 1);
  } finally { f.cleanup(); }
});
test("duplicate IDs across pages cannot be called a complete discovery", async () => {
  const f = fixture(); try { const rows = Array.from({ length: 11 }, (_, n) => candidate(f.payments[0], n)); rows[10].refundId = rows[0].refundId; f.deps.discover = pages(rows);
    const result = await runWeChatRefundSyncWorker({ stateFile: f.stateFile }, f.deps); assert.equal(result.ok, false); assert.equal(f.applied.length, 0);
  } finally { f.cleanup(); }
});
test("provider limit beyond 20 is an observable failure, never successful empty data", async () => {
  const f = fixture(); try { f.deps.discover = async () => { throw Error("WECHAT_PAY_LEGACY_REFUND_DISCOVERY_LIMIT"); };
    const result = await runWeChatRefundSyncWorker({ stateFile: f.stateFile }, f.deps); assert.equal(result.ok, false); assert.equal(result.completedPayments, 0); assert.equal(result.outstandingRetries, 1); assert.equal(result.errorCounts.WECHAT_PAY_LEGACY_REFUND_DISCOVERY_LIMIT, 1);
  } finally { f.cleanup(); }
});
test("budget-limited 20-refund payments resume verified progress instead of starving later refunds", async () => {
  const f = fixture(); try { f.deps.discover = pages(Array.from({ length: 20 }, (_, n) => candidate(f.payments[0], n)));
    for (let n = 0; n < 7; n++) { await runWeChatRefundSyncWorker({ stateFile: f.stateFile, maxGatewayRequests: 5 }, f.deps); f.advance(3_600_001); }
    assert.equal(f.applied.length, 20); assert.equal(new Set(f.applied).size, 20); const state = JSON.parse(readFileSync(f.stateFile, "utf8")); assert.equal(Object.keys(state.progress).length, 0); assert.equal(Object.keys(state.retries).length, 0);
  } finally { f.cleanup(); }
});
test("V3 PROCESSING becomes SUCCESS despite a permanently failing neighbor and stale legacy PROCESSING", async () => {
  const f = fixture(); try {
    const rows = [candidate(f.payments[0], 0), candidate(f.payments[0], 1)]; rows.forEach(row => { row.providerStatus = "PROCESSING"; });
    f.deps.discover = pages(rows); let status = "PROCESSING"; const observations: string[] = [], verify = f.deps.verify;
    f.deps.verify = async row => { if (row.outRefundNo === rows[1].outRefundNo) throw Error("WECHAT_PAY_LEGACY_API_UNAVAILABLE"); return { ...await verify(row), status }; };
    f.deps.apply = async result => { observations.push(result.status); };
    const first = await runWeChatRefundSyncWorker({ stateFile: f.stateFile, maxGatewayRequests: 2 }, f.deps); assert.equal(first.ok, false); assert.deepEqual(observations, ["PROCESSING"]);
    status = "SUCCESS"; f.advance(3_600_001);
    const second = await runWeChatRefundSyncWorker({ stateFile: f.stateFile, maxGatewayRequests: 2 }, f.deps); assert.equal(second.ok, false); assert.equal(second.completedPayments, 0); f.advance(3_600_001);
    const third = await runWeChatRefundSyncWorker({ stateFile: f.stateFile, maxGatewayRequests: 2 }, f.deps); assert.equal(third.ok, false); assert.deepEqual(observations, ["PROCESSING", "SUCCESS"]);
    assert.equal(rows[0].providerStatus, "PROCESSING");
  } finally { f.cleanup(); }
});
test("20 nonterminal refunds with a small budget fairly reach the tail and do not claim early completion", async () => {
  const f = fixture(); try {
    const rows = Array.from({ length: 20 }, (_, n) => candidate(f.payments[0], n)); rows.forEach(row => { row.providerStatus = "PROCESSING"; }); f.deps.discover = pages(rows);
    const verified: string[] = [], verify = f.deps.verify;
    f.deps.verify = async row => { verified.push(row.outRefundNo); return { ...await verify(row), status: "PROCESSING" }; };
    for (let n = 0; n < 7; n++) { const result = await runWeChatRefundSyncWorker({ stateFile: f.stateFile, maxGatewayRequests: 5 }, f.deps);
      assert.equal(result.completedPayments, n === 6 ? 1 : 0); assert.equal(result.ok, n === 6); f.advance(3_600_001); }
    assert.equal(new Set(verified).size, 20); assert(verified.includes(rows[19].outRefundNo));
  } finally { f.cleanup(); }
});
test("time budget records a resumable checkpoint and bounds gateway requests", async () => {
  const f = fixture(); try { const discover = pages([candidate(f.payments[0])]); f.deps.discover = async input => { const result = await discover(input); f.advance(100); return result; };
    const result = await runWeChatRefundSyncWorker({ stateFile: f.stateFile, maxRunMs: 50 }, f.deps); assert.equal(result.gatewayRequests, 1); assert.equal(result.budgetReached, true); assert.equal(result.ok, false); assert.equal(f.applied.length, 0);
  } finally { f.cleanup(); }
});
test("a failing payment backs off without starving the remaining payments", async () => {
  const f = fixture(3); try { const original = f.deps.discover; f.deps.discover = async input => { if (input.merchantOrderNo === f.payments[0].merchantOrderNo) throw Error("WECHAT_PAY_LEGACY_API_UNAVAILABLE"); return original(input); };
    const first = await runWeChatRefundSyncWorker({ stateFile: f.stateFile, batchSize: 1 }, f.deps); assert.equal(first.failures, 1);
    const second = await runWeChatRefundSyncWorker({ stateFile: f.stateFile, batchSize: 2 }, f.deps); assert.equal(second.completedPayments, 2); assert.deepEqual(f.visited, f.payments.slice(1).map(row => row.merchantOrderNo));
  } finally { f.cleanup(); }
});
test("retry delay is durable and exponentially capped at one hour", async () => {
  const f = fixture(); try { f.deps.discover = async () => { throw Error("WECHAT_PAY_LEGACY_API_UNAVAILABLE"); };
    for (let n = 0; n < 9; n++) { await runWeChatRefundSyncWorker({ stateFile: f.stateFile }, f.deps); const state = JSON.parse(readFileSync(f.stateFile, "utf8")), retry = state.retries[f.payments[0].id];
      assert.equal(retry.nextAttemptAt - retry.lastAttemptAt, Math.min(3_600_000, 60_000 * 2 ** Math.min(n, 6))); f.advance(3_600_001); }
  } finally { f.cleanup(); }
});
test("signed V3 verification failure cannot reach the settlement service", async () => {
  const f = fixture(); try { f.deps.discover = pages([candidate(f.payments[0])]); f.deps.verify = async () => { throw Error("WECHAT_PAY_LEGACY_REFUND_V3_AMOUNT_MISMATCH"); };
    const result = await runWeChatRefundSyncWorker({ stateFile: f.stateFile }, f.deps); assert.equal(result.ok, false); assert.equal(f.applied.length, 0);
  } finally { f.cleanup(); }
});
test("empty initial REFUNDNOTEXIST is complete, but a missing second page is an error", async () => {
  const f = fixture(); try { f.deps.discover = async () => { throw Error("WECHAT_PAY_LEGACY_REFUND_QUERY_REFUNDNOTEXIST"); };
    assert.equal((await runWeChatRefundSyncWorker({ stateFile: f.stateFile }, f.deps)).ok, true);
    const discover = pages(Array.from({ length: 11 }, (_, n) => candidate(f.payments[0], n))); f.deps.discover = async input => { if (input.offset) throw Error("WECHAT_PAY_LEGACY_REFUND_QUERY_REFUNDNOTEXIST"); return discover(input); };
    assert.equal((await runWeChatRefundSyncWorker({ stateFile: f.stateFile }, f.deps)).ok, false);
  } finally { f.cleanup(); }
});
test("lost dedicated lock aborts before database settlement and always releases", async () => {
  const f = fixture(); try { f.deps.discover = pages([candidate(f.payments[0])]); const verify = f.deps.verify;
    f.deps.verify = async input => { const result = await verify(input); f.loseLock(); return result; };
    await assert.rejects(runWeChatRefundSyncWorker({ stateFile: f.stateFile }, f.deps), /LOCK_LOST/); assert.equal(f.applied.length, 0); assert.equal(f.releases(), 1);
  } finally { f.cleanup(); }
});
test("state from another database or merchant is rejected instead of silently resetting", async () => {
  const f = fixture(); try { await runWeChatRefundSyncWorker({ stateFile: f.stateFile }, f.deps); f.deps.scope = "a".repeat(64);
    await assert.rejects(runWeChatRefundSyncWorker({ stateFile: f.stateFile }, f.deps), /STATE_INVALID/);
  } finally { f.cleanup(); }
});
test("malformed private state fails visibly, no discovery or settlement", async () => {
  const f = fixture(); try { writeFileSync(f.stateFile, "{}", { mode: 0o600 }); await assert.rejects(runWeChatRefundSyncWorker({ stateFile: f.stateFile }, f.deps), /STATE_INVALID/); assert.equal(f.visited.length, 0);
  } finally { f.cleanup(); }
});
test("provider diagnostics containing credentials or business details are not logged", async () => {
  const f = fixture(); try { f.deps.discover = async () => { throw Error("secret=unsafe-real-business-id"); }; const result = await runWeChatRefundSyncWorker({ stateFile: f.stateFile }, f.deps);
    assert.equal(JSON.stringify(result).includes("secret"), false); assert.equal(result.errorCounts.WECHAT_REFUND_SYNC_PAYMENT_FAILED, 1); assert.equal(readFileSync(f.stateFile, "utf8").includes("unsafe"), false);
  } finally { f.cleanup(); }
});

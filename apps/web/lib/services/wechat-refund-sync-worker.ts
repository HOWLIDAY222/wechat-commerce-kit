import { createHash, randomBytes } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import type { LegacyWeChatRefundCandidate, LegacyWeChatRefundPage } from "@/lib/providers/wechat-refund-sync";
import type { WeChatPayRefundResult } from "@/lib/providers/wechat-pay";

export type RefundSyncPayment = { id: string; merchantOrderNo: string; gatewayTradeNo: string | null };
export type RefundSyncLock = { assertHeld(): Promise<void>; release(): Promise<void> };
export type RefundSyncDependencies = {
  configured(): boolean;
  scope: string;
  now(): number;
  acquireLock(): Promise<RefundSyncLock | null>;
  listPayments(afterId: string | null, take: number): Promise<RefundSyncPayment[]>;
  discover(input: { merchantOrderNo: string; transactionId?: string; offset?: number }): Promise<LegacyWeChatRefundPage>;
  verify(candidate: LegacyWeChatRefundCandidate): Promise<WeChatPayRefundResult>;
  apply(result: WeChatPayRefundResult): Promise<unknown>;
};
export type RefundSyncOptions = { stateFile: string; batchSize?: number; scanLimit?: number; maxGatewayRequests?: number; maxRunMs?: number };
type Retry = { attempts: number; nextAttemptAt: number; lastAttemptAt: number; code: string };
type Progress = { fingerprint: string; nextIndex: number; visited: number[]; failed: number[]; lastAttemptAt: number };
type WorkerState = { version: 1; scope: string; cursor: string | null; retries: Record<string, Retry>; progress: Record<string, Progress>; lastRunAt: number };
export type RefundSyncReport = {
  ok: boolean; skipped: "LOCKED" | null; scanned: number; attempted: number; completedPayments: number;
  verifiedObservations: number; failures: number; deferred: number; outstandingRetries: number;
  gatewayRequests: number; budgetReached: boolean; errorCounts: Record<string, number>;
};
const identity = /^[A-Za-z0-9_-]{1,128}$/;
const noRefunds = "WECHAT_PAY_LEGACY_REFUND_QUERY_REFUNDNOTEXIST";
const incomplete = "WECHAT_REFUND_SYNC_DISCOVERY_INCOMPLETE";

function errorCode(error: unknown) {
  const value = error instanceof Error ? error.message : "";
  return /^(?:WECHAT_[A-Z0-9_]{1,110}|REFUND_[A-Z0-9_]{1,110})$/.test(value) ? value : "WECHAT_REFUND_SYNC_PAYMENT_FAILED";
}
function bounded(value: number | undefined, fallback: number, max: number) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > max) throw Error("WECHAT_REFUND_SYNC_OPTIONS_INVALID");
  return result;
}
function loadState(file: string, scope: string): WorkerState {
  if (!isAbsolute(file) || !/^[a-f0-9]{64}$/.test(scope)) throw Error("WECHAT_REFUND_SYNC_STATE_PATH_INVALID");
  const directory = dirname(file);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const parent = lstatSync(directory);
  if (!parent.isDirectory() || parent.isSymbolicLink() || (process.platform !== "win32" && (parent.mode & 0o077))) throw Error("WECHAT_REFUND_SYNC_STATE_PERMISSIONS_INVALID");
  if (!existsSync(file)) return { version: 1, scope, cursor: null, retries: {}, progress: {}, lastRunAt: 0 };
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024 || (process.platform !== "win32" && (stat.mode & 0o077))) throw Error("WECHAT_REFUND_SYNC_STATE_INVALID");
  const value = JSON.parse(readFileSync(file, "utf8")) as WorkerState;
  if (value.version !== 1 || value.scope !== scope || (value.cursor !== null && !identity.test(value.cursor))
    || !value.retries || typeof value.retries !== "object" || Array.isArray(value.retries)
    || !value.progress || typeof value.progress !== "object" || Array.isArray(value.progress)
    || Object.keys(value.retries).length > 1000 || Object.keys(value.progress).length > 1000 || !Number.isSafeInteger(value.lastRunAt)) throw Error("WECHAT_REFUND_SYNC_STATE_INVALID");
  for (const [id, retry] of Object.entries(value.retries)) {
    if (!identity.test(id) || !retry || !Number.isSafeInteger(retry.attempts) || retry.attempts < 1 || retry.attempts > 1000
      || !Number.isSafeInteger(retry.nextAttemptAt) || !Number.isSafeInteger(retry.lastAttemptAt)
      || retry.nextAttemptAt < 0 || retry.lastAttemptAt < 0 || errorCode(Error(retry.code)) !== retry.code) throw Error("WECHAT_REFUND_SYNC_STATE_INVALID");
  }
  for (const [id, progress] of Object.entries(value.progress)) {
    if (!identity.test(id) || !progress || !/^[a-f0-9]{64}$/.test(progress.fingerprint) || !Number.isSafeInteger(progress.nextIndex)
      || progress.nextIndex < 0 || progress.nextIndex > 19 || !Number.isSafeInteger(progress.lastAttemptAt)
      || ![progress.visited, progress.failed].every(indices => Array.isArray(indices) && indices.length <= 20
        && new Set(indices).size === indices.length && indices.every(index => Number.isSafeInteger(index) && index >= 0 && index < 20))) throw Error("WECHAT_REFUND_SYNC_STATE_INVALID");
  }
  return value;
}
function saveState(file: string, state: WorkerState) {
  const entries = Object.entries(state.retries).sort((a, b) => b[1].lastAttemptAt - a[1].lastAttemptAt).slice(0, 1000);
  state.retries = Object.fromEntries(entries);
  state.progress = Object.fromEntries(Object.entries(state.progress).sort((a, b) => b[1].lastAttemptAt - a[1].lastAttemptAt).slice(0, 1000));
  const temporary = file + "." + process.pid + "." + randomBytes(6).toString("hex") + ".tmp";
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, JSON.stringify(state)); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temporary, file);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

// The advisory lock lives on this dedicated connection for the whole run, never on Prisma's pool.
export async function acquireRefundSyncDatabaseLock(connectionString: string): Promise<RefundSyncLock | null> {
  const { Client } = await import("pg");
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000, application_name: "wechat-refund-sync-lock" });
  let lost = false;
  client.on("error", () => { lost = true; });
  try {
    await client.connect();
    const result = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(20261018, 660031) AS locked");
    if (!result.rows[0].locked) { await client.end(); return null; }
    return {
      async assertHeld() { if (lost) throw Error("WECHAT_REFUND_SYNC_LOCK_LOST"); try { await client.query("SELECT 1"); } catch { throw Error("WECHAT_REFUND_SYNC_LOCK_LOST"); } },
      async release() { try { if (!lost) await client.query("SELECT pg_advisory_unlock(20261018, 660031)"); } finally { await client.end(); } },
    };
  } catch { await client.end().catch(() => {}); throw Error("WECHAT_REFUND_SYNC_LOCK_UNAVAILABLE"); }
}
async function defaultDependencies(): Promise<RefundSyncDependencies> {
  const [{ appConfig }, { prisma }, provider, payment, service] = await Promise.all([
    import("@/lib/config"), import("@/lib/db/prisma"), import("@/lib/providers/wechat-refund-sync"),
    import("@/lib/providers/wechat-pay"), import("@/lib/services/wechat-refund-service"),
  ]);
  const database = process.env.DATABASE_URL;
  if (!database || appConfig.COMMERCE_STORAGE !== "prisma") throw Error("WECHAT_REFUND_SYNC_DATABASE_REQUIRED");
  const scope = createHash("sha256").update(new URL(database).pathname + ":" + (appConfig.WECHAT_PAY_MCH_ID ?? "")).digest("hex");
  return {
    scope, now: Date.now,
    configured: () => provider.isLegacyRefundSyncConfigured() && payment.getWeChatPayProviderStatus().configured,
    acquireLock: () => acquireRefundSyncDatabaseLock(database),
    listPayments: (afterId, take) => prisma.paymentIntent.findMany({
      where: { provider: "WECHAT_PAY", status: "PAID", currency: "CNY", ...(afterId ? { id: { gt: afterId } } : {}) },
      select: { id: true, merchantOrderNo: true, gatewayTradeNo: true }, orderBy: { id: "asc" }, take,
    }),
    discover: provider.listWeChatRefundCandidatesForPayment,
    verify: provider.queryVerifiedWeChatRefundCandidate,
    apply: result => service.processVerifiedWeChatRefundResult(result, { source: "DISCOVERY_QUERY" }),
  };
}

export async function runWeChatRefundSyncWorker(options: RefundSyncOptions, injected?: RefundSyncDependencies): Promise<RefundSyncReport> {
  const batchSize = bounded(options.batchSize, 5, 50), scanLimit = bounded(options.scanLimit, 100, 1000);
  const requestLimit = bounded(options.maxGatewayRequests, 40, 200), maxRunMs = bounded(options.maxRunMs, 45_000, 50_000);
  const deps = injected ?? await defaultDependencies();
  if (!deps.configured()) throw Error("WECHAT_REFUND_SYNC_NOT_CONFIGURED");
  const report: RefundSyncReport = { ok: true, skipped: null, scanned: 0, attempted: 0, completedPayments: 0,
    verifiedObservations: 0, failures: 0, deferred: 0, outstandingRetries: 0, gatewayRequests: 0, budgetReached: false, errorCounts: {} };
  const lock = await deps.acquireLock();
  if (!lock) return { ...report, skipped: "LOCKED" };
  try {
    const state = loadState(options.stateFile, deps.scope), started = deps.now(), seen = new Set<string>();
    const persist = async () => { await lock.assertHeld(); saveState(options.stateFile, state); };
    const hasBudget = () => deps.now() - started < maxRunMs && report.gatewayRequests < requestLimit;
    let wrapped = false;
    while (report.scanned < scanLimit && report.attempted < batchSize) {
      if (!hasBudget()) { report.budgetReached = true; break; }
      let rows = await deps.listPayments(state.cursor, Math.min(25, scanLimit - report.scanned));
      if (!rows.length) {
        if (wrapped || state.cursor === null) break;
        state.cursor = null; wrapped = true;
        rows = await deps.listPayments(null, Math.min(25, scanLimit - report.scanned));
        if (!rows.length) break;
      }
      for (const row of rows) {
        if (seen.has(row.id)) { wrapped = true; break; }
        if (!hasBudget() || report.attempted >= batchSize) { report.budgetReached ||= !hasBudget(); break; }
        if (!identity.test(row.id)) throw Error("WECHAT_REFUND_SYNC_PAYMENT_ID_INVALID");
        seen.add(row.id); report.scanned++; state.cursor = row.id;
        if (state.retries[row.id]?.nextAttemptAt > deps.now()) { report.deferred++; await persist(); continue; }
        report.attempted++;
        try {
          // Collect a complete, stable discovery set before applying any observation from this payment.
          const candidates: LegacyWeChatRefundCandidate[] = [], refunds = new Set<string>(), gatewayIds = new Set<string>();
          let offset = 0, total: number | null = null, complete = false;
          for (let pageNumber = 0; pageNumber < 2; pageNumber++) {
            if (!hasBudget()) throw Error("WECHAT_REFUND_SYNC_BUDGET_EXHAUSTED");
            report.gatewayRequests++;
            let page: LegacyWeChatRefundPage;
            try { page = await deps.discover({ merchantOrderNo: row.merchantOrderNo, transactionId: row.gatewayTradeNo ?? undefined, offset }); }
            catch (error) { if (errorCode(error) === noRefunds && offset === 0) { complete = true; total = 0; break; } throw error; }
            if (page.offset !== offset || !Number.isSafeInteger(page.totalRefundCount) || page.totalRefundCount < 0 || page.totalRefundCount > 20
              || (total !== null && total !== page.totalRefundCount) || page.candidates.length > 10
              || offset + page.candidates.length > page.totalRefundCount) throw Error(incomplete);
            total = page.totalRefundCount;
            for (const candidate of page.candidates) {
              if (candidate.merchantOrderNo !== row.merchantOrderNo || (row.gatewayTradeNo && candidate.transactionId !== row.gatewayTradeNo)
                || refunds.has(candidate.outRefundNo) || gatewayIds.has(candidate.refundId)) throw Error(incomplete);
              refunds.add(candidate.outRefundNo); gatewayIds.add(candidate.refundId); candidates.push(candidate);
            }
            if (page.complete) {
              if (page.nextOffset !== null || candidates.length !== total) throw Error(incomplete);
              complete = true; break;
            }
            if (page.nextOffset !== offset + page.candidates.length || page.nextOffset <= offset || page.nextOffset >= total) throw Error(incomplete);
            offset = page.nextOffset;
          }
          if (!complete) throw Error(incomplete);
          candidates.sort((a, b) => a.outRefundNo < b.outRefundNo ? -1 : a.outRefundNo > b.outRefundNo ? 1 : 0);
          const fingerprint = createHash("sha256").update(JSON.stringify(candidates.map(candidate => [candidate.outRefundNo, candidate.refundId, candidate.transactionId, candidate.merchantOrderNo, candidate.refundAmountCents, candidate.totalAmountCents]))).digest("hex");
          const savedProgress = state.progress[row.id];
          const progress: Progress = savedProgress?.fingerprint === fingerprint ? savedProgress
            : { fingerprint, nextIndex: 0, visited: [], failed: [], lastAttemptAt: deps.now() };
          if (candidates.length && progress.nextIndex >= candidates.length) throw Error(incomplete);
          const visited = new Set(progress.visited), failed = new Set(progress.failed), startIndex = progress.nextIndex;
          let candidateError: unknown;
          for (let step = 0; step < candidates.length; step++) {
            if (!hasBudget()) { candidateError ??= Error("WECHAT_REFUND_SYNC_BUDGET_EXHAUSTED"); break; }
            const index = (startIndex + step) % candidates.length, candidate = candidates[index];
            report.gatewayRequests++;
            try {
              const verified = await deps.verify(candidate);
              await lock.assertHeld();
              await deps.apply(verified);
              report.verifiedObservations++; visited.add(index); failed.delete(index);
            } catch (error) {
              if (errorCode(error) === "WECHAT_REFUND_SYNC_LOCK_LOST") throw error;
              candidateError ??= error; failed.add(index); visited.delete(index);
            }
            // A failed candidate also advances. Previously nonterminal observations are revisited on rotation.
            progress.nextIndex = (index + 1) % candidates.length;
            progress.visited = [...visited]; progress.failed = [...failed]; progress.lastAttemptAt = deps.now();
            state.progress[row.id] = progress; await persist();
            if (visited.size === candidates.length && failed.size === 0) break;
          }
          if (visited.size !== candidates.length || failed.size !== 0) throw candidateError ?? Error(incomplete);
          report.completedPayments++; delete state.retries[row.id]; delete state.progress[row.id];
        } catch (error) {
          const code = errorCode(error), attempts = Math.min((state.retries[row.id]?.attempts ?? 0) + 1, 1000), now = deps.now();
          state.retries[row.id] = { attempts, nextAttemptAt: now + Math.min(3_600_000, 60_000 * 2 ** Math.min(attempts - 1, 6)), lastAttemptAt: now, code };
          report.failures++; report.errorCounts[code] = (report.errorCounts[code] ?? 0) + 1;
          if (code === "WECHAT_REFUND_SYNC_BUDGET_EXHAUSTED") report.budgetReached = true;
          if (code === "WECHAT_REFUND_SYNC_LOCK_LOST") throw error;
        }
        state.lastRunAt = deps.now(); await persist();
      }
      if (wrapped && rows.some(row => seen.has(row.id)) && rows.every(row => seen.has(row.id))) break;
    }
    state.lastRunAt = deps.now(); await persist();
    report.outstandingRetries = Object.keys(state.retries).length;
    for (const retry of Object.values(state.retries)) if (!report.errorCounts[retry.code]) report.errorCounts[retry.code] = 0;
    report.ok = report.failures === 0 && report.outstandingRetries === 0;
    return report;
  } finally { await lock.release(); }
}

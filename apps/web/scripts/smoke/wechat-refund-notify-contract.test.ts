import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

function fixture(failure?: "decrypt" | "query" | "v3") {
  const calls: string[] = [], writes: unknown[] = [], module = { exports: {} as { POST?: (request: Request) => Promise<Response> } };
  const candidate = { outRefundNo: "platform-refund", refundId: "wx-refund", merchantOrderNo: "paid-order", transactionId: "wx-transaction", totalAmountCents: 10000, refundAmountCents: 4000, providerStatus: "SUCCESS", source: "VENDOR_PLATFORM" };
  const result = { out_refund_no: candidate.outRefundNo, refund_id: candidate.refundId, out_trade_no: candidate.merchantOrderNo, transaction_id: candidate.transactionId, status: "SUCCESS", amount: { total: 10000, refund: 4000, currency: "CNY" } };
  const dependencies: Record<string, unknown> = {
    "@/lib/providers/wechat-pay": { parseWeChatPayRefundNotification: async () => { calls.push("verify-v3-notification"); if (failure === "v3") throw Error("WECHAT_PAY_SIGNATURE_INVALID"); return { event: { id: "v3-event", event_type: "REFUND.SUCCESS" }, refund: { ...result, refund_status: "SUCCESS" } }; } },
    "@/lib/providers/wechat-refund-sync": {
      parseLegacyWeChatRefundNotification: () => { calls.push("decrypt-v2-candidate"); if (failure === "decrypt") throw Error("WECHAT_PAY_API_V2_KEY_REQUIRED"); return candidate; },
      queryVerifiedWeChatRefundCandidate: async (value: unknown) => { assert.equal(value, candidate); calls.push("verify-signed-v3-get"); if (failure === "query") throw Error("WECHAT_PAY_REFUND_AMOUNT_MISMATCH"); return result; },
    },
    "@/lib/services/wechat-refund-service": {
      processVerifiedWeChatRefundResult: async (value: unknown, options: unknown) => { assert.equal(value, result); calls.push("write-verified-query"); writes.push(options); },
      processWeChatRefundEvent: async (value: unknown) => { calls.push("write-verified-v3-notification"); writes.push(value); },
    },
  };
  const source = readFileSync(resolve("app/api/payments/wechat/refund-notify/route.ts"), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
  assert.equal((output.diagnostics ?? []).filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(output.outputText, { module, exports: module.exports, Response, Request, Error, console: { error() {} }, require(name: string) { if (!Object.hasOwn(dependencies, name)) throw Error("Unexpected refund dependency: " + name); return dependencies[name]; } });
  return { calls, writes, POST: module.exports.POST! };
}
test("merchant XML remains a candidate until a signed V3 GET succeeds, then returns XML SUCCESS", async () => {
  const f = fixture(), response = await f.POST(new Request("https://local.invalid/refund-notify", { method: "POST", headers: { "content-type": "application/xml" }, body: "<xml>synthetic</xml>" }));
  assert.equal(response.status, 200); assert.match(response.headers.get("content-type")!, /application\/xml/); assert.match(await response.text(), /CDATA\[SUCCESS\]/);
  assert.deepEqual(f.calls, ["decrypt-v2-candidate", "verify-signed-v3-get", "write-verified-query"]); assert.deepEqual(JSON.parse(JSON.stringify(f.writes)), [{ source: "LEGACY_NOTIFY_QUERY", eventId: "refund-v2-query:wx-refund:SUCCESS" }]);
});
test("missing V2 key and mismatched V3 query fail explicitly without any financial writer", async () => {
  for (const failure of ["decrypt", "query"] as const) {
    const f = fixture(failure), response = await f.POST(new Request("https://local.invalid/refund-notify", { method: "POST", headers: { "content-type": "text/xml" }, body: "<xml>synthetic</xml>" }));
    assert.equal(response.status, 500); const text = await response.text(); assert.match(text, /CDATA\[FAIL\]/); assert.equal(f.writes.length, 0);
    if (failure === "decrypt") assert.match(text, /WECHAT_PAY_API_V2_KEY_REQUIRED/);
  }
});
test("existing JSON notifications use independent V3 verification and return 204 only after writing", async () => {
  const f = fixture(), response = await f.POST(new Request("https://local.invalid/refund-notify", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
  assert.equal(response.status, 204); assert.deepEqual(f.calls, ["verify-v3-notification", "write-verified-v3-notification"]);
  const invalid = fixture("v3"), rejected = await invalid.POST(new Request("https://local.invalid/refund-notify", { method: "POST", body: "{}" })); assert.equal(rejected.status, 500); assert.equal(invalid.writes.length, 0);
});

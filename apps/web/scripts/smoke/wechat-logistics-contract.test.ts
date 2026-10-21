import assert from "node:assert/strict";
import { test } from "node:test";
import { logisticsFingerprint, logisticsFailureState, normalizeLogisticsRule, prepareLogisticsRegistration, registerLogisticsCandidate,
  type LogisticsCandidate, type RegistrationDependencies } from "@/lib/commerce/wechat-logistics-contract";

const rule = { enabled: true, activatedAt: "2026-10-16T00:00:00.000Z" };
const config = { appId: "qa-app", merchantId: "qa-merchant", baseUrl: "https://store.invalid" };
function fixture(): LogisticsCandidate {
  return { id: "shipment", orderId: "order", status: "SHIPPED", trackingCompany: "顺丰", trackingNo: "SF-QA-1", shippedAt: new Date("2026-10-16T01:00:00Z"), wechatSyncedAt: new Date(),
    order: { id: "order", orderNo: "TC-qa/1", userId: "buyer", kind: "STANDARD", source: "MINIPROGRAM", status: "CONFIRMED", paymentStatus: "PAID", fulfillmentStatus: "SHIPPED",
      createdAt: new Date("2026-10-16T00:30:00Z"), customerPhone: "13900000006", payableAmountCents: 4900, currency: "CNY",
      user: { wechatIdentities: [{ appId: "qa-app", openId: "qa-buyer-openid" }] },
      items: [{ productName: "订单快照商品", color: "白色", size: "M", quantity: 1, product: { image: "/assets/product.webp" } }],
      paymentIntents: [{ provider: "WECHAT_PAY", status: "PAID", amountCents: 4900, currency: "CNY", gatewayTradeNo: "transaction-not-required-to-start-420", merchantOrderNo: "merchant-qa-1",
        rawResponse: { appid: "qa-app", mchid: "qa-merchant", transaction_id: "transaction-not-required-to-start-420", out_trade_no: "merchant-qa-1", trade_state: "SUCCESS", payer: { openid: "qa-buyer-openid" }, amount: { total: 4900, currency: "CNY" } } }] } };
}
function harness(overrides: Partial<RegistrationDependencies> = {}) {
  let claimed = false, sends = 0;
  const persisted: Array<{ state: string; token: string | null; error: string | null }> = [];
  const deps: RegistrationDependencies = { claim: async () => { if (claimed) return null; claimed = true; return "binding"; },
    remoteOrder: async () => ({ openid: "qa-buyer-openid", merchant_trade_no: "merchant-qa-1", order_state: 2 }),
    resolveCarrier: async () => "SF", stillCurrent: async () => true,
    follow: async payload => { sends++; assert.equal(payload.receiver_phone, "13900000006"); assert.equal(payload.trans_id, "transaction-not-required-to-start-420"); return { errcode: 0, waybill_token: "qa-token" }; },
    finish: async (_id, state, token, error) => { persisted.push({ state, token, error }); }, ...overrides };
  return { deps, persisted, get sends() { return sends; } };
}

async function main() {
await test("rule defaults fail closed and malformed activation cannot enable sending", () => {
  for (const input of [null, {}, [], { enabled: true }, { enabled: "true", activatedAt: rule.activatedAt }, { enabled: true, activatedAt: "invalid" }]) assert.equal(normalizeLogisticsRule(input).enabled, false);
});
await test("payload uses buyer identity, receiver snapshot, real transaction, internal order route, and HTTPS image", () => {
  const value = prepareLogisticsRegistration(fixture(), rule, config); assert(value.eligible);
  assert.deepEqual(value.payload, { openid: "qa-buyer-openid", receiver_phone: "13900000006", waybill_id: "SF-QA-1", trans_id: "transaction-not-required-to-start-420",
    order_detail_path: "pages/order-detail/index?orderNo=TC-qa%2F1", goods_info: { detail_list: [{ goods_name: "订单快照商品", goods_img_url: "https://store.invalid/assets/product.webp", goods_desc: "白色 M ×1" }] } });
});
await test("existing purchases can register after activation without changing their creation or payment snapshots", () => {
  const f = fixture(); f.order.createdAt = new Date("2026-09-01T00:00:00Z");
  const before = JSON.stringify(f);
  const prepared = prepareLogisticsRegistration(f, rule, config); assert(prepared.eligible);
  assert.equal(prepared.payload.trans_id, f.order.paymentIntents[0].gatewayTradeNo);
  assert.equal(JSON.stringify(f), before);
});
await test("pre-activation shipment stays excluded even if the purchase date is new", () => {
  const f = fixture(); f.shippedAt = new Date("2026-10-15T23:59:59.999Z");
  assert.deepEqual(prepareLogisticsRegistration(f, rule, config), { eligible: false, reason: "BEFORE_ACTIVATION" });
  f.shippedAt = new Date(rule.activatedAt); assert.equal(prepareLogisticsRegistration(f, rule, config).eligible, true);
});
await test("disabled, historic shipments, unpaid/refunded, gift, web, unsynced and incomplete purchases never become candidates", () => {
  const changes: Array<(f: LogisticsCandidate) => void> = [
    f => { f.shippedAt = new Date("2026-10-15"); },
    f => { f.order.paymentStatus = "REFUNDED"; }, f => { f.order.status = "CANCELLED"; },
    f => { f.order.kind = "GIFT_PURCHASE"; }, f => { f.order.kind = "GIFT_REDEMPTION"; }, f => { f.order.source = "WEB"; },
    f => { f.order.fulfillmentStatus = "DELIVERED"; }, f => { f.wechatSyncedAt = null; }, f => { f.trackingNo = ""; },
    f => { f.order.customerPhone = "138****1234"; }, f => { f.order.user.wechatIdentities[0].appId = "different-app"; },
  ];
  for (const change of changes) { const f = fixture(); change(f); assert.equal(prepareLogisticsRegistration(f, rule, config).eligible, false); }
  assert.equal(prepareLogisticsRegistration(fixture(), { enabled: false, activatedAt: null }, config).eligible, false);
});
await test("payment snapshot mismatches fail closed for each identity, transaction and amount field", () => {
  for (const [key, value] of Object.entries({ appid: "other-app", mchid: "other-merchant", transaction_id: "other-transaction", out_trade_no: "other-order", trade_state: "NOTPAY", payer: { openid: "other-buyer" }, amount: { total: 1, currency: "CNY" } })) {
    const f = fixture(); (f.order.paymentIntents[0].rawResponse as Record<string, unknown>)[key] = value;
    assert.equal(prepareLogisticsRegistration(f, rule, config).eligible, false, key);
  }
  const duplicate = fixture(); duplicate.order.paymentIntents.push(duplicate.order.paymentIntents[0]); assert.equal(prepareLogisticsRegistration(duplicate, rule, config).eligible, false);
});
await test("missing/insecure images do not invent product data and Unicode descriptions stay bounded", () => {
  const f = fixture(); f.order.items[0].product!.image = "http://insecure.invalid/p.png"; assert.equal(prepareLogisticsRegistration(f, rule, config).eligible, false);
  f.order.items[0].product!.image = "/safe.webp"; f.order.items[0].color = "白".repeat(70);
  const value = prepareLogisticsRegistration(f, rule, config); assert(value.eligible); assert.equal(Array.from(value.payload.goods_info.detail_list[0].goods_desc!).length, 40);
});
await test("fingerprint changes with carrier or tracking number and normalizes surrounding whitespace", () => {
  assert.equal(logisticsFingerprint(" 顺丰 ", " SF-1 "), logisticsFingerprint("顺丰", "SF-1"));
  assert.notEqual(logisticsFingerprint("顺丰", "SF-1"), logisticsFingerprint("顺丰", "SF-2"));
  assert.notEqual(logisticsFingerprint("顺丰", "SF-1"), logisticsFingerprint("中通", "SF-1"));
});
await test("concurrent workers claim one registration and persist token before another run", async () => {
  const h = harness(); const result = await Promise.all([registerLogisticsCandidate(fixture(), rule, config, h.deps), registerLogisticsCandidate(fixture(), rule, config, h.deps)]);
  assert.equal(h.sends, 1); assert.equal(result.filter(row => row.outcome === "registered").length, 1);
  assert.deepEqual(h.persisted, [{ state: "BOUND", token: "qa-token", error: null }]);
  assert.equal((await registerLogisticsCandidate(fixture(), rule, config, h.deps)).outcome, "skipped"); assert.equal(h.sends, 1);
});
await test("lost response is UNKNOWN and a rerun does not resend", async () => {
  let sends = 0; const h = harness({ follow: async () => { sends++; throw Error("WECHAT_SHIPPING_NETWORK_UNAVAILABLE"); } });
  assert.equal((await registerLogisticsCandidate(fixture(), rule, config, h.deps)).outcome, "unknown");
  assert.equal(h.persisted[0].state, "UNKNOWN"); await registerLogisticsCandidate(fixture(), rule, config, h.deps); assert.equal(sends, 1);
});
await test("explicit rejection is FAILED while malformed success and local persistence failure are UNKNOWN", async () => {
  assert.equal(logisticsFailureState(Error("WECHAT_SHIPPING_API_9300560"), true), "FAILED");
  const rejected = harness({ follow: async () => { throw Error("WECHAT_SHIPPING_API_9300560"); } });
  assert.equal((await registerLogisticsCandidate(fixture(), rule, config, rejected.deps)).outcome, "failed");
  const malformed = harness({ follow: async () => ({ errcode: 0 }) }); assert.equal((await registerLogisticsCandidate(fixture(), rule, config, malformed.deps)).outcome, "unknown");
  let attempts = 0; const conflict = harness({ finish: async (_id, state) => { attempts++; if (state === "BOUND") throw Error("WECHAT_LOGISTICS_PERSISTENCE_CONFLICT"); } });
  assert.equal((await registerLogisticsCandidate(fixture(), rule, config, conflict.deps)).outcome, "unknown"); assert.equal(attempts, 2);
});
await test("remote buyer mismatch, refund and concurrent tracking/rule changes never send a follow request", async () => {
  for (const override of [
    { remoteOrder: async () => ({ openid: "different-buyer", merchant_trade_no: "merchant-qa-1", order_state: 2 }) },
    { remoteOrder: async () => ({ openid: "qa-buyer-openid", merchant_trade_no: "merchant-qa-1", order_state: 5 }) },
    { stillCurrent: async () => false }, { resolveCarrier: async () => { throw Error("WECHAT_DELIVERY_COMPANY_UNKNOWN"); } },
  ]) { const h = harness(override); assert.equal((await registerLogisticsCandidate(fixture(), rule, config, h.deps)).outcome, "failed"); assert.equal(h.sends, 0); }
});
}
main().catch(error => { console.error(error); process.exitCode = 1; });

import assert from "node:assert/strict";
import { test } from "node:test";
import { assertRefundPaymentIdentity, nextObservedRefundStatus, normalizeVerifiedRefund, refundObservationFingerprint } from "../../lib/commerce/wechat-refund-sync";

const resource = { out_refund_no: "merchant-refund-001", refund_id: "wx-refund-001", out_trade_no: "merchant-order-001", transaction_id: "wx-order-001", refund_status: "SUCCESS", amount: { total: 10000, refund: 4000, currency: "CNY" } };
const payment = { provider: "WECHAT_PAY", status: "PAID", merchantOrderNo: resource.out_trade_no, gatewayTradeNo: resource.transaction_id, amountCents: 10000, currency: "CNY" };
test("verified refund cents and exact original transaction remain the financial identity", () => {
  const observation = normalizeVerifiedRefund(resource); assert.equal(observation.status, "SUCCEEDED"); assert.equal(observation.refundAmountCents, 4000); assert.doesNotThrow(() => assertRefundPaymentIdentity(payment, observation));
  for (const patch of [{ merchantOrderNo: "other-order" }, { transactionId: "other-transaction" }, { totalAmountCents: 9999 }]) assert.throws(() => assertRefundPaymentIdentity(payment, { ...observation, ...patch }));
  for (const patch of [{ provider: "ALIPAY" }, { status: "CREATED" }, { gatewayTradeNo: null }, { currency: "USD" }]) assert.throws(() => assertRefundPaymentIdentity({ ...payment, ...patch }, observation));
});
test("fractional, zero, over-total, non-CNY or unknown-state refunds fail closed", () => {
  for (const amount of [{ total: 10000, refund: 0 }, { total: 10000, refund: 10001 }, { total: 10000, refund: 1.1 }, { total: 10000, refund: 1, currency: "USD" }]) assert.throws(() => normalizeVerifiedRefund({ ...resource, amount }));
  assert.throws(() => normalizeVerifiedRefund({ ...resource, refund_status: "UNKNOWN" }));
  assert.throws(() => normalizeVerifiedRefund({ ...resource, refund_status: "toString" }));
  for (const out_refund_no of ["", " padded", "newline\nvalue"]) assert.throws(() => normalizeVerifiedRefund({ ...resource, out_refund_no }));
});
test("success never regresses on a delayed processing or failure observation", () => {
  for (const status of ["PROCESSING", "FAILED", "SUCCEEDED"] as const) assert.equal(nextObservedRefundStatus("SUCCEEDED", status), "SUCCEEDED");
  assert.equal(nextObservedRefundStatus("PROCESSING", "SUCCEEDED"), "SUCCEEDED");
});
test("the canonical event fingerprint detects changed refund identities and amounts", () => {
  const observation = normalizeVerifiedRefund(resource), fingerprint = refundObservationFingerprint(observation);
  assert.equal(fingerprint, refundObservationFingerprint(normalizeVerifiedRefund({ ...resource, amount: { ...resource.amount } })));
  for (const patch of [{ outRefundNo: "changed" }, { providerRefundId: "changed" }, { refundAmountCents: 3999 }, { status: "FAILED" as const }]) assert.notEqual(fingerprint, refundObservationFingerprint({ ...observation, ...patch }));
});

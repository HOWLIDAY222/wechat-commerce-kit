import assert from "node:assert/strict";
import { test } from "node:test";
import { hasActualShipment, isRetryableRefundTransaction, planRefundLifecycle, requiresReturnReceipt } from "../../lib/commerce/refunded-order-lifecycle";
import { canTransitionAfterSales } from "../../lib/after-sales/state-machine";
const success = (amount = 10000) => ({ refundStatus: "SUCCEEDED", refundAmountCents: amount });
const request = (patch = {}) => ({ id: "as", type: "RETURN_REFUND", status: "WAITING_RETURN", receivedAt: null as Date | null, returnAddress: "品牌退货地址", returnTrackingNo: null, refundAmountCents: 10000, refunds: [] as ReturnType<typeof success>[], ...patch });
const order = (patch = {}) => ({ fulfillmentStatus: "PENDING", shipments: [] as Array<{ status: string; trackingNo?: string }>, payableAmountCents: 10000, refunds: [success()], afterSalesRequests: [request()], ...patch });
test("full unshipped refunds end refund after-sales without assigning an external refund to individual items", () => {
  const value = order(), before = JSON.stringify(value), plan = planRefundLifecycle(value);
  assert.equal(plan.closeOrder, true); assert.deepEqual(plan.completeIds, ["as"]); assert.equal(JSON.stringify(value), before);
});
test("shipment records and actual tracking prevent treating a pending-looking order as unshipped", () => {
  for (const value of [order({ fulfillmentStatus: "DELIVERED" }), order({ shipments: [{ status: "PROCESSING", trackingNo: "QA-TRACK" }] })]) {
    assert.equal(hasActualShipment(value), true); assert.equal(planRefundLifecycle(value).closeOrder, false);
  }
});
test("receivedAt is required for shipped return refunds even if legacy status already says refunded or completed", () => {
  for (const status of ["REFUNDED", "COMPLETED"]) {
    const value = order({ fulfillmentStatus: "SHIPPED", afterSalesRequests: [request({ status })] });
    assert.equal(planRefundLifecycle(value).closeOrder, false);
  }
  assert.equal(planRefundLifecycle(order({ fulfillmentStatus: "SHIPPED", afterSalesRequests: [request({ receivedAt: new Date() })] })).closeOrder, true);
});
test("partial refunds require an exact after-sales link and never close the entire order", () => {
  const value = order({ fulfillmentStatus: "DELIVERED", refunds: [success(5000)], afterSalesRequests: [request({ refundAmountCents: 5000, receivedAt: new Date(), refunds: [success(5000)] })] });
  assert.deepEqual(planRefundLifecycle(value).completeIds, ["as"]); assert.equal(planRefundLifecycle(value).closeOrder, false);
  assert.deepEqual(planRefundLifecycle({ ...value, afterSalesRequests: [request({ refundAmountCents: 5000, receivedAt: new Date() })] }).completeIds, []);
});
test("a full-order refund covers the money but never waives any outstanding return or exchange obligation", () => {
  const received = request({ receivedAt: new Date() });
  assert.equal(planRefundLifecycle(order({ fulfillmentStatus: "SHIPPED", afterSalesRequests: [received, request({ id: "other" })] })).closeOrder, false);
  assert.equal(planRefundLifecycle(order({ afterSalesRequests: [request({ type: "EXCHANGE" })] })).closeOrder, false);
  assert.equal(planRefundLifecycle(order({ fulfillmentStatus: "SHIPPED", afterSalesRequests: [] })).closeOrder, false);
});
test("refund-only resolutions need no receipt and quality returns follow their actual return evidence", () => {
  assert.equal(requiresReturnReceipt(request({ type: "REFUND_ONLY" }), true), false);
  assert.equal(requiresReturnReceipt(request({ type: "QUALITY_ISSUE", status: "REFUND_PROCESSING", returnAddress: null }), true), false);
  assert.equal(requiresReturnReceipt(request({ type: "QUALITY_ISSUE" }), true), true);
  assert.equal(canTransitionAfterSales("refunded", "received", "return_refund"), true);
  assert.equal(canTransitionAfterSales("refunded", "received", "refund_only"), false);
});
test("Prisma 7 raw PostgreSQL serialization and deadlock metadata retries both financial and lifecycle transactions", () => {
  assert.equal(isRetryableRefundTransaction({ code: "P2034" }), true);
  for (const code of ["40001", "40P01"]) {
    assert.equal(isRetryableRefundTransaction({ code: "P2010", meta: { code } }), true);
    const adapter = Object.assign(new Error("a driver error"), { name: "DriverAdapterError", cause: { originalCode: code, kind: "postgres", code, severity: "ERROR" } });
    assert.equal(isRetryableRefundTransaction({ code: "P2010", meta: { driverAdapterError: adapter } }), true);
    const actualAdapter = Object.assign(new Error("TransactionWriteConflict"), { name: "DriverAdapterError", cause: { originalCode: code, originalMessage: "could not serialize access due to concurrent update", kind: "TransactionWriteConflict" } });
    assert.equal(isRetryableRefundTransaction({ code: "P2010", meta: { driverAdapterError: actualAdapter } }), true);
    assert.equal(isRetryableRefundTransaction({ code, severity: "ERROR" }), true);
  }
});
test("unique constraints, malformed adapter metadata, business errors and message-only conflicts are never swallowed", () => {
  for (const error of [null, "40001", Error("40001 could not serialize"), { code: "P2002" }, { code: "P2010", meta: { code: "23505" } }, { code: "P2010", meta: { driverAdapterError: { name: "OtherError", cause: { kind: "postgres", originalCode: "40001" } } } }, { code: "P2010", meta: { driverAdapterError: { name: "DriverAdapterError", cause: { kind: "UniqueConstraintViolation", originalCode: "23505" } } } }, { code: "P2010", meta: { driverAdapterError: { name: "DriverAdapterError", cause: { kind: "postgres", originalCode: "40001", code: "23505" } } } }]) assert.equal(isRetryableRefundTransaction(error), false);
});

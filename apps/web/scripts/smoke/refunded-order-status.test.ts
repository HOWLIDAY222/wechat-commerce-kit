import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { fulfillmentActions, needsPaymentReview } from "../../lib/commerce/admin-operations";
import { formatOrderFulfillmentStatusLabel, formatOrderStatusLabel } from "../../lib/display-labels";

// Exercise the real private UI predicates and server guards without importing
// their session, database, network, or React rendering boundaries.
function functions(file: string, names: string[], scope: Record<string, unknown> = {}) {
  const source = ts.createSourceFile(file, readFileSync(resolve(file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declarations = source.statements.filter(statement => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text ?? ""));
  assert.equal(declarations.length, names.length, "Expected real source functions to remain present");
  const input = declarations.map(statement => statement.getText(source)).join("\n") + `\nmodule.exports = {${names.join(",")}};`;
  const output = ts.transpileModule(input, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  runInNewContext(output, { module, Error, Date, ...scope });
  return module.exports as Record<string, (...args: any[]) => any>;
}
const table = functions("app/admin/orders/order-admin-table.tsx", ["buildTabs", "matchesTab", "isPaid", "isShipped", "isClosed", "isCompleted", "isAnomaly", "hasOpenAfterSales", "getOrderPriority", "getOrderSecondaryAction"], { fulfillmentActions, needsPaymentReview, needsWeChatShippingSync: () => false });
const dashboard = functions("app/admin/page.tsx", ["getOrderStats"], { fulfillmentActions, needsPaymentReview, needsWeChatShippingSync: () => false, isToday: () => false });
const detail = functions("app/admin/orders/[orderNo]/page.tsx", ["getOrderHeaderAction"]);
const form = functions("app/admin/orders/order-admin-form.tsx", ["getAvailableActions", "resolveNextStatus"]);
const guards = functions("lib/services/order-service.ts", ["assertAdminOrderStatusAction", "assertAdminFulfillmentAction"]);
const state = (paymentStatus = "REFUNDED", fulfillmentStatus = "PENDING", status = "CONFIRMED") => Object.freeze({ orderNo: "QA-REFUND-44", status, paymentStatus, fulfillmentStatus, shipments: [], afterSalesRequests: [] });

test("a fully refunded unshipped order displays refunded overall and unshipped without changing its history", () => {
  for (const status of ["PENDING", "PROCESSING", "UNFULFILLED"]) {
    const order = state("REFUNDED", status), before = JSON.stringify(order), allowed = fulfillmentActions(order);
    assert.equal(formatOrderStatusLabel(order.status, order.paymentStatus), "已退款");
    assert.equal(formatOrderFulfillmentStatusLabel(order), "未发货");
    assert.equal(allowed.reason, "已退款，未发货");
    assert.equal(allowed.ship || allowed.deliver || allowed.correct, false);
    assert.equal(needsPaymentReview(order), false); assert.equal(JSON.stringify(order), before);
  }
});
test("actual shipping and delivery history remains visible after a full refund with read-only logistics links", () => {
  for (const [status, label] of [["SHIPPED", "已发货"], ["DELIVERED", "已签收"]]) {
    const order = { ...state("REFUNDED", status), shipments: [{ id: "qa-shipment" }] };
    assert.equal(formatOrderFulfillmentStatusLabel(order), label);
    const allowed = fulfillmentActions(order); assert.equal(allowed.reason, ""); assert.equal(allowed.ship || allowed.deliver || allowed.correct, false);
    assert.equal(detail.getOrderHeaderAction(order).label, "查看物流"); assert.equal(table.getOrderSecondaryAction(order).label, "查看物流");
  }
});
test("partial refunds retain paid fulfillment behavior, while unpaid and closed orders retain their existing gates", () => {
  const partial = { ...state("PAID"), refunds: [{ refundAmountCents: 1000, refundStatus: "SUCCEEDED" }] };
  assert.equal(formatOrderStatusLabel(partial.status, partial.paymentStatus), "已确认"); assert.equal(formatOrderFulfillmentStatusLabel(partial), "待发货"); assert.equal(fulfillmentActions(partial).ship, true);
  assert.equal(needsPaymentReview(state("PENDING")), true); assert.equal(fulfillmentActions(state("PENDING")).ship, false);
  assert.equal(needsPaymentReview(state("PENDING", "PENDING", "CANCELLED")), false);
  assert.equal(fulfillmentActions(state("PAID", "PENDING", "CLOSED")).ship, false);
  assert.equal(formatOrderStatusLabel("CONFIRMED"), "已确认");
  assert.equal(formatOrderStatusLabel("CLOSED", "REFUNDED"), "订单已结束");
});
test("real order tabs and dashboard count refunded orders in neither awaiting shipment nor awaiting payment", () => {
  const orders = [state(), state("REFUNDED", "PROCESSING"), state("REFUNDED", "SHIPPED"), state("REFUNDED", "DELIVERED"), state("PAID"), state("PAID", "SHIPPED"), state("PENDING"), state("PENDING", "PENDING", "CANCELLED")];
  const tabs = table.buildTabs(orders);
  assert.equal(tabs.find((tab: { key: string }) => tab.key === "PENDING_SHIPMENT").count, 1);
  assert.equal(tabs.find((tab: { key: string }) => tab.key === "PENDING_PAYMENT").count, 1);
  assert.equal(tabs.find((tab: { key: string }) => tab.key === "SHIPPED").count, 3);
  const stats = dashboard.getOrderStats(orders); assert.equal(stats.paidUnfulfilled, 1); assert.equal(stats.pendingPayment, 1);
  for (const order of orders.filter(order => order.paymentStatus === "REFUNDED")) {
    assert.equal(table.matchesTab(order, "PENDING_SHIPMENT"), false); assert.equal(table.matchesTab(order, "PENDING_PAYMENT"), false);
    assert.notEqual(table.getOrderSecondaryAction(order)?.label, "核对支付"); assert.notEqual(table.getOrderPriority(order), 3);
  }
});
test("a CREATED refunded order offers neither unpaid cancellation nor payment confirmation in the actual form", () => {
  assert.equal(form.getAvailableActions("CREATED", "REFUNDED").length, 0);
  assert.equal(form.resolveNextStatus("cancel", "CREATED", "REFUNDED"), "");
  assert.equal(form.getAvailableActions("CREATED", "PENDING")[0].value, "cancel");
  assert.equal(form.getAvailableActions("CREATED", "PAID")[0].value, "confirm");
});
test("completed after-sales history remains readable without counting as an open after-sales task", () => {
  const closed = { ...state(), status: "CLOSED", afterSalesRequests: [{ status: "COMPLETED" }] };
  assert.equal(table.matchesTab(closed, "AFTER_SALES"), false); assert.equal(table.hasOpenAfterSales(closed), false);
  assert.equal(table.getOrderSecondaryAction(closed).label, "查看售后");
  assert.equal(table.hasOpenAfterSales({ ...closed, afterSalesRequests: [{ status: "REFUNDED" }] }), true);
  assert.equal(table.hasOpenAfterSales({ ...closed, afterSalesRequests: [null, {}, "COMPLETED", { status: 123 }] }), true);
});
test("the real server guards reject refunded cancellation and every fulfillment transition before a write", () => {
  assert.throws(() => guards.assertAdminOrderStatusAction("CREATED", "REFUNDED", "CANCELLED"), /ORDER_STATUS_ACTION_NOT_ALLOWED/);
  guards.assertAdminOrderStatusAction("CREATED", "PENDING", "CANCELLED"); guards.assertAdminOrderStatusAction("CREATED", "PAID", "CONFIRMED");
  for (const current of ["PENDING", "PROCESSING", "SHIPPED", "DELIVERED"]) for (const next of ["SHIPPED", "DELIVERED"]) assert.throws(() => guards.assertAdminFulfillmentAction("CONFIRMED", "REFUNDED", current, next, {}), /UNPAID_ORDER_SHIPMENT_FORBIDDEN/);
  guards.assertAdminFulfillmentAction("CONFIRMED", "PAID", "PENDING", "SHIPPED", { trackingCompany: "QA", trackingNo: "QA-ONLY" });
});

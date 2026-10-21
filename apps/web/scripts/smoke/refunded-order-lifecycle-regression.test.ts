import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(database.pathname, "/vk_refunded_order_status_smoke_20261018");
  assert(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(process.env.COMMERCE_STORAGE, "prisma");
  const originalFetch = globalThis.fetch; let gatewayCalls = 0;
  globalThis.fetch = async () => { gatewayCalls++; throw Error("No gateway request is permitted in lifecycle database QA"); };
  const { prisma } = await import("@/lib/db/prisma");
  const { processVerifiedWeChatRefundResult: write } = await import("@/lib/services/wechat-refund-service");
  const { updateAfterSalesStatus: transition, performReshipmentAction: reshipmentAction, submitAfterSalesReturnShipment: submitReturn, createAfterSalesRequest: createAfterSales } = await import("@/lib/services/after-sales-service");
  const { performAdminOrderAction: action, confirmOrderReceiptForUser: confirmReceipt } = await import("@/lib/services/order-service");
  const users: string[] = [], orders: string[] = [], products: string[] = [], suffix = randomUUID();
  const owner = await prisma.user.create({ data: { role: "OWNER", name: "lifecycle-owner-" + suffix } }); users.push(owner.id);
  async function fixture(options: { shipped?: boolean; legacyReserved?: boolean; insufficientReservation?: boolean; trackingOnly?: boolean } = {}) {
    const product = await prisma.product.create({ data: { slug: "lifecycle-qa-" + randomUUID(), code: "LC-QA-" + randomUUID(), name: "隔离退款生命周期商品", category: "QA", summary: "仅隔离测试", skus: { create: { skuCode: "LC-SKU-" + randomUUID(), color: "白", size: "M", priceCents: 5000, stockQuantity: options.legacyReserved ? 100 : 98, reservedQuantity: options.insufficientReservation ? 1 : options.legacyReserved ? 5 : 3 } } }, include: { skus: true } }); products.push(product.id);
    const sku = product.skus[0], user = await prisma.user.create({ data: { role: "CUSTOMER", name: "lifecycle-qa-" + suffix } }); users.push(user.id);
    const order = await prisma.order.create({ data: { orderNo: "LC-QA-" + randomUUID(), userId: user.id, status: "CONFIRMED", paymentStatus: "PAID", fulfillmentStatus: options.shipped ? "SHIPPED" : "PENDING", customerName: "隔离测试", customerPhone: "13900000022", addressSnapshot: "仅隔离地址", subtotalCents: 10000, payableAmountCents: 10000, shippingFeeCents: 0, items: { create: { productId: product.id, skuId: sku.id, productName: product.name, productCode: product.code, color: "白", size: "M", quantity: 2, unitPriceCents: 5000 } } }, include: { items: true } }); orders.push(order.id);
    const payment = await prisma.paymentIntent.create({ data: { orderId: order.id, provider: "WECHAT_PAY", method: "JSAPI", status: "PAID", currency: "CNY", amountCents: 10000, merchantOrderNo: "lc-pay-" + randomUUID(), gatewayTradeNo: "lc-wx-" + randomUUID() } });
    await prisma.inventoryLog.create({ data: { skuId: sku.id, action: "RESERVE", quantity: 2, note: `Order ${order.orderNo}` } });
    if (!options.legacyReserved) await prisma.inventoryLog.create({ data: { skuId: sku.id, action: "DEDUCT", quantity: 2, note: `Paid order ${order.orderNo}` } });
    if (options.shipped || options.trackingOnly) await prisma.shipment.create({ data: { orderId: order.id, status: options.shipped ? "SHIPPED" : "PROCESSING", trackingCompany: "合成承运商", trackingNo: "LC-TRACK-" + randomUUID(), ...(options.shipped ? { shippedAt: new Date() } : {}) } });
    return { user, order, payment, sku };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function afterSales(f: Fixture, options: { amount?: number; exact?: boolean; received?: boolean; status?: "WAITING_RETURN" | "RETURN_IN_TRANSIT" | "REFUND_PROCESSING" | "COMPLETED" } = {}) {
    const request = await prisma.afterSalesRequest.create({ data: { afterSalesNo: "LC-AS-" + randomUUID(), userId: f.user.id, orderId: f.order.id, type: "RETURN_REFUND", status: options.status ?? "REFUND_PROCESSING", reason: "隔离售后", description: "仅验证收尾", refundAmountCents: options.amount ?? 10000, returnAddress: "本地合成退货地址", ...(options.received ? { receivedAt: new Date() } : {}), items: { create: { orderItemId: f.order.items[0].id, productId: f.order.items[0].productId, skuId: f.sku.id, productName: "合成商品", color: "白", size: "M", quantity: 1, unitPriceCents: 5000, refundAmountCents: options.amount ?? 10000 } } } });
    const refund = options.exact ? await prisma.refund.create({ data: { orderId: f.order.id, paymentId: f.payment.id, afterSalesId: request.id, refundNo: "lc-local-" + randomUUID(), refundAmountCents: options.amount ?? 10000, reason: "隔离退款" } }) : null;
    return { request, refund };
  }
  function observation(f: Fixture, amount = 10000, number = "lc-external-" + randomUUID()) { return { out_refund_no: number, refund_id: "lc-wx-refund-" + number, out_trade_no: f.payment.merchantOrderNo, transaction_id: f.payment.gatewayTradeNo!, status: "SUCCESS", amount: { total: 10000, refund: amount, currency: "CNY" } }; }
  const readOrder = (f: Fixture) => prisma.order.findUniqueOrThrow({ where: { id: f.order.id }, include: { shipments: true } });
  try {
    await test("a full unshipped external refund ends the order and refund after-sales on concurrent signed sweeps exactly once", async () => {
      const f = await fixture(), as = await afterSales(f, { status: "WAITING_RETURN" }), result = observation(f);
      await Promise.all(Array.from({ length: 4 }, () => write(result)));
      const order = await readOrder(f); assert.equal(order.status, "CLOSED"); assert.equal(order.fulfillmentStatus, "PENDING"); assert.equal(order.paymentStatus, "REFUNDED");
      assert.equal((await prisma.afterSalesRequest.findUniqueOrThrow({ where: { id: as.request.id } })).status, "COMPLETED");
      assert.equal(await prisma.auditLog.count({ where: { targetId: f.order.id, action: "order.refund.closed" } }), 1);
      assert.equal(await prisma.afterSalesMessage.count({ where: { afterSalesId: as.request.id } }), 1);
      assert.equal((await prisma.orderItem.findUniqueOrThrow({ where: { id: f.order.items[0].id } })).refundAmountCents, 0);
      const stock = await prisma.productSku.findUniqueOrThrow({ where: { id: f.sku.id } }); assert.equal(stock.stockQuantity, 98); assert.equal(stock.reservedQuantity, 3);
    });
    await test("money first never substitutes for return receipt and actual receipt later immediately ends the after-sales and order", async () => {
      const f = await fixture({ shipped: true }), as = await afterSales(f, { exact: true });
      await write(observation(f, 10000, as.refund!.refundNo));
      assert.equal((await readOrder(f)).status, "CONFIRMED"); assert.equal((await prisma.afterSalesRequest.findUniqueOrThrow({ where: { id: as.request.id } })).receivedAt, null);
      await assert.rejects(transition(as.request.afterSalesNo, { status: "completed", actorType: "admin", actorId: owner.id }), /RETURN_RECEIPT_REQUIRED/);
      const completed = await transition(as.request.afterSalesNo, { status: "received", actorType: "admin", actorId: owner.id }); assert.equal(completed.status, "completed");
      assert.equal((await readOrder(f)).status, "CLOSED"); assert.equal((await readOrder(f)).fulfillmentStatus, "SHIPPED"); assert.equal((await readOrder(f)).shipments[0].trackingNo?.startsWith("LC-TRACK-"), true);
    });
    await test("receipt first remains recorded and a later verified refund completes both without another admin click", async () => {
      const f = await fixture({ shipped: true }), as = await afterSales(f, { exact: true, status: "RETURN_IN_TRANSIT" });
      await transition(as.request.afterSalesNo, { status: "received", actorType: "admin", actorId: owner.id }); assert.equal((await readOrder(f)).status, "CONFIRMED");
      await write(observation(f, 10000, as.refund!.refundNo)); assert.equal((await readOrder(f)).status, "CLOSED");
      assert.equal((await prisma.afterSalesRequest.findUniqueOrThrow({ where: { id: as.request.id } })).status, "COMPLETED");
    });
    await test("a received partial after-sales completes only when exactly linked and leaves the rest of the order open", async () => {
      const f = await fixture({ shipped: true }), as = await afterSales(f, { exact: true, amount: 5000, received: true });
      await write(observation(f, 5000, as.refund!.refundNo)); assert.equal((await readOrder(f)).status, "CONFIRMED"); assert.equal((await readOrder(f)).paymentStatus, "PAID");
      assert.equal((await prisma.afterSalesRequest.findUniqueOrThrow({ where: { id: as.request.id } })).status, "COMPLETED");
      const other = await fixture({ shipped: true }), unknown = await afterSales(other, { amount: 5000, received: true }); await write(observation(other, 5000));
      assert.equal((await prisma.afterSalesRequest.findUniqueOrThrow({ where: { id: unknown.request.id } })).status, "REFUND_PROCESSING"); assert.equal((await readOrder(other)).status, "CONFIRMED");
    });
    await test("a real tracking record or a legacy completed label cannot fabricate an unshipped order or a return receipt", async () => {
      const f = await fixture({ trackingOnly: true }); await afterSales(f); await write(observation(f)); assert.equal((await readOrder(f)).status, "CONFIRMED");
      const other = await fixture({ shipped: true }), legacy = await afterSales(other, { status: "COMPLETED" }); await write(observation(other));
      assert.equal((await readOrder(other)).status, "CONFIRMED"); assert.equal((await prisma.afterSalesRequest.findUniqueOrThrow({ where: { id: legacy.request.id } })).receivedAt, null);
    });
    await test("only this order's proven outstanding reservation is released once while other orders and stock stay untouched", async () => {
      const f = await fixture({ legacyReserved: true }); const result = observation(f); await write(result); await write(result);
      const stock = await prisma.productSku.findUniqueOrThrow({ where: { id: f.sku.id } }); assert.equal(stock.stockQuantity, 100); assert.equal(stock.reservedQuantity, 3);
      assert.equal(await prisma.inventoryLog.count({ where: { skuId: f.sku.id, action: "RELEASE", note: `Refund closed order ${f.order.orderNo}` } }), 1);
    });
    await test("inventory anomalies never roll back verified money and a later signed replay safely retries the deferred closure", async () => {
      const f = await fixture({ legacyReserved: true, insufficientReservation: true }), result = observation(f); await write(result);
      assert.equal((await readOrder(f)).paymentStatus, "REFUNDED"); assert.equal((await readOrder(f)).status, "CONFIRMED"); assert.equal((await prisma.refund.findUniqueOrThrow({ where: { refundNo: result.out_refund_no } })).refundStatus, "SUCCEEDED");
      assert.equal(await prisma.auditLog.count({ where: { targetId: f.order.id, action: "order.refund.lifecycle_deferred" } }), 1);
      await prisma.productSku.update({ where: { id: f.sku.id }, data: { reservedQuantity: 5 } }); await write(result);
      assert.equal((await readOrder(f)).status, "CLOSED"); assert.equal((await prisma.productSku.findUniqueOrThrow({ where: { id: f.sku.id } })).reservedQuantity, 3);
    });
    await test("concurrent shipping and a full refund cannot produce a closed order that still ships after closure", async () => {
      const f = await fixture(); await afterSales(f, { status: "WAITING_RETURN" });
      const results = await Promise.allSettled([write(observation(f)), action(f.order.orderNo, { action: "ship", trackingCompany: "合成", trackingNo: "LC-RACE-ONLY" }, owner.id)]);
      assert.equal(results[0].status, "fulfilled"); const order = await readOrder(f); assert.equal(order.paymentStatus, "REFUNDED");
      if (order.status === "CLOSED") { assert.equal(order.fulfillmentStatus, "PENDING"); assert.equal(order.shipments.length, 0); assert.equal(results[1].status, "rejected"); }
      else { assert.equal(order.fulfillmentStatus, "SHIPPED"); assert.equal(order.shipments.length, 1); }
      await assert.rejects(action(f.order.orderNo, { action: "ship", trackingCompany: "合成", trackingNo: "LC-AFTER-ONLY" }, owner.id)); assert.equal(gatewayCalls, 0);
    });
    await test("refunded orders cannot confirm delivery, ship replacements or create a new after-sales shipment", async () => {
      const f = await fixture({ shipped: true }); await afterSales(f); await write(observation(f));
      await assert.rejects(confirmReceipt(f.order.orderNo, f.user.id), /UNPAID_ORDER_RECEIPT_FORBIDDEN/);
      const shipment = (await readOrder(f)).shipments[0]; await assert.rejects(reshipmentAction(shipment.id, { action: "deliver" }, owner.id), /ORDER_NOT_AVAILABLE_FOR_FULFILLMENT/);
      const exchange = await prisma.afterSalesRequest.create({ data: { afterSalesNo: "LC-EXCHANGE-" + randomUUID(), orderId: f.order.id, userId: f.user.id, type: "EXCHANGE", status: "INSPECTING", reason: "合成换货", description: "仅验证已退款不能再次出库" } });
      await assert.rejects(transition(exchange.afterSalesNo, { status: "exchange_shipping", actorType: "admin", actorId: owner.id }), /ORDER_NOT_AVAILABLE_FOR_FULFILLMENT/);
      assert.equal((await readOrder(f)).shipments.length, 1); assert.equal(gatewayCalls, 0);
    });
    await test("customer return tracking and a new after-sales request cannot reopen an order completed by a concurrent full refund", async () => {
      const f = await fixture(), as = await afterSales(f, { status: "WAITING_RETURN" });
      const results = await Promise.allSettled([write(observation(f)), submitReturn(f.user.id, as.request.afterSalesNo, { trackingCompany: "合成", trackingNo: "QA-CUSTOMER-RETURN" })]); assert.equal(results[0].status, "fulfilled");
      assert.equal((await readOrder(f)).status, "CLOSED"); assert.equal((await prisma.afterSalesRequest.findUniqueOrThrow({ where: { id: as.request.id } })).status, "COMPLETED");
      await assert.rejects(submitReturn(f.user.id, as.request.afterSalesNo, { trackingCompany: "合成", trackingNo: "QA-LATE-RETURN" }), /AFTER_SALES_INVALID_TRANSITION/);
      const other = await fixture(); await Promise.allSettled([write(observation(other)), createAfterSales(other.user.id, { orderNo: other.order.orderNo, type: "refund_only", reason: "合成申请", description: "仅验证并发门槛", items: [{ orderItemId: other.order.items[0].id, quantity: 1 }] })]);
      assert.equal((await readOrder(other)).status, "CLOSED"); assert.equal(await prisma.afterSalesRequest.count({ where: { orderId: other.order.id, status: { notIn: ["COMPLETED", "CANCELLED", "REJECTED"] } } }), 0);
      await assert.rejects(createAfterSales(other.user.id, { orderNo: other.order.orderNo, type: "refund_only", reason: "合成申请", description: "已结束不可新建", items: [{ orderItemId: other.order.items[0].id, quantity: 1 }] }), /CLOSED_ORDER_AFTER_SALES_FORBIDDEN/);
      assert.equal(gatewayCalls, 0);
    });
  } finally {
    const afterSales = await prisma.afterSalesRequest.findMany({ where: { orderId: { in: orders } }, select: { id: true } }), refunds = await prisma.refund.findMany({ where: { orderId: { in: orders } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: users } }, { targetId: { in: [...orders, ...afterSales.map(row => row.id), ...refunds.map(row => row.id)] } }] } });
    await prisma.paymentNotification.deleteMany({ where: { orderId: { in: orders } } }); await prisma.refund.deleteMany({ where: { orderId: { in: orders } } });
    await prisma.afterSalesRequest.deleteMany({ where: { orderId: { in: orders } } }); await prisma.order.deleteMany({ where: { id: { in: orders } } }); await prisma.user.deleteMany({ where: { id: { in: users } } }); await prisma.product.deleteMany({ where: { id: { in: products } } });
    globalThis.fetch = originalFetch; await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

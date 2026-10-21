import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(database.pathname, "/vk_merchant_refund_sync_smoke_20261018");
  assert(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(process.env.COMMERCE_STORAGE, "prisma");
  process.env.WECHAT_PAY_MCH_ID ||= "qa-merchant-refund-only";
  const originalFetch = globalThis.fetch; let gatewayCalls = 0;
  globalThis.fetch = async () => { gatewayCalls++; throw Error("No gateway request is permitted in the refund writer database QA"); };
  const { prisma } = await import("@/lib/db/prisma");
  const { processVerifiedWeChatRefundResult: write, processWeChatRefundEvent: notify, executeWeChatRefundForAdmin: execute } = await import("@/lib/services/wechat-refund-service");
  const { changeMemberPoints } = await import("@/lib/services/member-points-service");
  const { getOrderRefundSummary: summary, getOrderRefundSummaryByOrderNo: summaryByNo } = await import("@/lib/services/wechat-refund-read-model");
  const users: string[] = [], orders: string[] = [], afterSalesIds: string[] = [], templates: string[] = [], suffix = randomUUID(); let sequence = 0;
  const product = await prisma.product.create({ data: { slug: "refund-sync-qa-" + suffix, code: "REFUNDQA-" + suffix, name: "隔离退款验证商品", category: "QA", summary: "仅隔离数据", skus: { create: { skuCode: "REFUNDQA-SKU-" + suffix, color: "测试", size: "M", priceCents: 5000, stockQuantity: 100, reservedQuantity: 0 } } }, include: { skus: true } });
  const sku = product.skus[0];
  async function fixture() {
    const user = await prisma.user.create({ data: { role: "CUSTOMER", name: "refund-qa-" + suffix, phone: "136" + String(++sequence).padStart(8, "0"), membership: { create: {} } } }); users.push(user.id);
    const order = await prisma.order.create({ data: { orderNo: "REFUND-QA-" + randomUUID(), userId: user.id, kind: "STANDARD", status: "CONFIRMED", paymentStatus: "PAID", fulfillmentStatus: "DELIVERED", customerName: "隔离测试", customerPhone: "13900000022", addressSnapshot: "仅隔离测试地址", subtotalCents: 10000, payableAmountCents: 10000, shippingFeeCents: 0,
      items: { create: { productId: product.id, skuId: sku.id, productCode: product.code, productName: product.name, color: "测试", size: "M", quantity: 2, unitPriceCents: 5000 } } }, include: { items: true } }); orders.push(order.id);
    const payment = await prisma.paymentIntent.create({ data: { orderId: order.id, provider: "WECHAT_PAY", method: "JSAPI", status: "PAID", amountCents: 10000, currency: "CNY", merchantOrderNo: "merchant-qa-" + randomUUID(), gatewayTradeNo: "wx-transaction-" + randomUUID() } });
    await prisma.$transaction(tx => changeMemberPoints(tx, user.id, { eventKey: "paid:" + order.id, delta: 100, orderId: order.id, basisCents: 10000, reason: "隔离原订单积分", allowDebt: true }));
    return { user, order, payment, item: order.items[0] };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function localRequest(f: Fixture, amount = 10000, providerId?: string) {
    const request = await prisma.afterSalesRequest.create({ data: { afterSalesNo: "AS-QA-" + randomUUID(), userId: f.user.id, orderId: f.order.id, type: "RETURN_REFUND", status: "REFUND_PROCESSING", reason: "隔离售后", description: "仅验证已有精确关联", refundAmountCents: amount,
      items: { create: { orderItemId: f.item.id, productId: product.id, skuId: sku.id, productName: product.name, color: "测试", size: "M", quantity: amount === 10000 ? 2 : 1, unitPriceCents: 5000, refundAmountCents: amount } } } }); afterSalesIds.push(request.id);
    const refund = await prisma.refund.create({ data: { orderId: f.order.id, paymentId: f.payment.id, afterSalesId: request.id, refundNo: "local-qa-" + randomUUID(), paymentRefundId: providerId, refundAmountCents: amount, reason: "本地待处理退款" } });
    return { request, refund };
  }
  function result(f: Fixture, amount: number, identity = "external-qa-" + randomUUID(), status = "SUCCESS") { return { out_refund_no: identity, refund_id: "wx-refund-" + identity, out_trade_no: f.payment.merchantOrderNo, transaction_id: f.payment.gatewayTradeNo!, status, amount: { total: 10000, refund: amount, currency: "CNY" } }; }
  const balance = async (id: string) => (await prisma.memberProfile.findUniqueOrThrow({ where: { userId: id } })).pointsBalance;
  try {
    const owner = await prisma.user.create({ data: { role: "OWNER", name: "refund-owner-qa-" + suffix } }); users.push(owner.id);
    const f = await fixture(), local = await localRequest(f), external = result(f, 4000);
    await test("an unknown merchant refund imports once under concurrent delivery without guessing a local after-sales relationship", async () => {
      await Promise.all(Array.from({ length: 4 }, () => write(external, { source: "DISCOVERY_QUERY" })));
      const rows = await prisma.refund.findMany({ where: { paymentId: f.payment.id } }); assert.equal(rows.length, 2);
      const imported = rows.find(row => row.refundNo === external.out_refund_no)!; assert.equal(imported.afterSalesId, null); assert.equal(imported.refundStatus, "SUCCEEDED");
      assert.equal((await prisma.refund.findUniqueOrThrow({ where: { id: local.refund.id } })).refundStatus, "CREATED");
      assert.equal((await prisma.afterSalesRequest.findUniqueOrThrow({ where: { id: local.request.id } })).status, "REFUND_PROCESSING");
      assert.equal((await prisma.orderItem.findUniqueOrThrow({ where: { id: f.item.id } })).refundAmountCents, 0);
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).paymentStatus, "PAID"); assert.equal(await balance(f.user.id), 60);
      const view = await summary(f.order.id); assert.equal(view.state, "PARTIAL"); assert.equal(view.succeededAmountCents, 4000); assert.equal(view.requestedAmountCents, 10000); assert.equal(view.processingAmountCents, 0); assert.equal(view.unlinkedSucceededCents, 4000); assert.equal(view.requiresAfterSalesReview, true); assert(view.lastVerifiedAt);
      assert.deepEqual(await summaryByNo(f.order.orderNo), view); assert.equal(await summaryByNo("unknown-qa-order"), null);
    });
    await test("replay and delayed processing or failure never repeat point reversal or regress a successful refund", async () => {
      const first = await prisma.refund.findUniqueOrThrow({ where: { refundNo: external.out_refund_no } });
      await write(external, { eventId: "refund-other-delivery-" + suffix });
      for (const status of ["PROCESSING", "CLOSED"]) await write({ ...external, status });
      const stored = await prisma.refund.findUniqueOrThrow({ where: { id: first.id } }); assert.equal(stored.refundStatus, "SUCCEEDED"); assert.equal(stored.completedAt?.toISOString(), first.completedAt?.toISOString()); assert.equal(await balance(f.user.id), 60);
      assert.equal(await prisma.pointEntry.count({ where: { orderId: f.order.id, eventKey: { startsWith: "refund:" } } }), 1);
      await assert.rejects(write({ ...external, amount: { ...external.amount, refund: 3999 } }), /AMOUNT_MISMATCH|EVENT_CHANGED/);
      await assert.rejects(write({ ...external, out_refund_no: "different-merchant-number" }, { eventId: "changed-number-" + suffix }), /REFUND_NO_MISMATCH/);
    });
    await test("a local pending execution is blocked before any gateway call when a verified external refund requires reconciliation", async () => {
      await assert.rejects(execute(local.refund.refundNo, owner.id), /REFUND_RECONCILIATION_REQUIRED/); assert.equal(gatewayCalls, 0);
      const pending = await fixture(), pendingLocal = await localRequest(pending); await write(result(pending, 4000, undefined, "PROCESSING"));
      const view = await summary(pending.order.id); assert.equal(view.state, "PROCESSING"); assert.equal(view.succeededAmountCents, 0); assert.equal(view.processingAmountCents, 4000); assert.equal(view.requestedAmountCents, 10000); assert.equal(view.unlinkedProcessingCents, 4000); assert.equal(view.requiresAfterSalesReview, true);
      await assert.rejects(execute(pendingLocal.refund.refundNo, owner.id), /REFUND_RECONCILIATION_REQUIRED/); assert.equal(gatewayCalls, 0);
    });
    await test("two distinct partial refunds total the real payment once and cannot exceed it or auto-complete an unrelated after-sales request", async () => {
      await write(result(f, 6000)); assert.equal(await balance(f.user.id), 0);
      const view = await summary(f.order.id); assert.equal(view.state, "REFUNDED"); assert.equal(view.succeededAmountCents, 10000); assert.equal(view.requiresAfterSalesReview, true); assert.equal(view.succeededCount, 2);
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: f.order.id } })).paymentStatus, "REFUNDED"); assert.equal((await prisma.afterSalesRequest.findUniqueOrThrow({ where: { id: local.request.id } })).status, "REFUND_PROCESSING");
      const over = result(f, 1); await assert.rejects(write(over), /REFUND_TOTAL_EXCEEDS_PAYMENT/); assert.equal(await prisma.refund.count({ where: { refundNo: over.out_refund_no } }), 0); assert.equal(await balance(f.user.id), 0);
    });
    await test("wrong original transaction, order, total or currency cannot create or attach a refund", async () => {
      const other = await fixture(), observation = result(other, 4000);
      for (const patch of [{ transaction_id: "wrong-transaction" }, { out_trade_no: f.payment.merchantOrderNo }, { amount: { total: 9999, refund: 4000, currency: "CNY" } }, { amount: { total: 10000, refund: 4000, currency: "USD" } }]) await assert.rejects(write({ ...observation, ...patch }));
      assert.equal(await prisma.refund.count({ where: { orderId: other.order.id } }), 0); assert.equal(await balance(other.user.id), 100);
      await assert.rejects(notify({ eventId: "bad-merchant-" + suffix, eventType: "REFUND.SUCCESS", rawPayload: {}, refund: { ...observation, mchid: "wrong-merchant", refund_status: "SUCCESS" } }), /MCH_ID_MISMATCH/);
    });
    await test("an exact local refund number completes only its own approved refund and returns item cents once", async () => {
      const other = await fixture(), precise = await localRequest(other, 5000), observation = result(other, 5000, precise.refund.refundNo);
      await write(observation); await write(observation);
      assert.equal((await prisma.afterSalesRequest.findUniqueOrThrow({ where: { id: precise.request.id } })).status, "REFUNDED");
      assert.equal((await prisma.orderItem.findUniqueOrThrow({ where: { id: other.item.id } })).refundAmountCents, 5000); assert.equal(await balance(other.user.id), 50);
      assert.equal(await prisma.afterSalesMessage.count({ where: { afterSalesId: precise.request.id } }), 1);
      assert.equal((await summary(other.order.id)).unlinkedSucceededCents, 0);
    });
    await test("a unique explicitly registered provider refund ID links exactly, while duplicate registrations fail closed", async () => {
      const other = await fixture(), observation = result(other, 5000), precise = await localRequest(other, 5000, observation.refund_id);
      const stored = await write(observation); assert.equal(stored.id, precise.refund.id); assert.equal(stored.afterSalesId, precise.request.id); assert.equal(stored.refundNo, precise.refund.refundNo);
      const ambiguous = await fixture(), duplicate = result(ambiguous, 5000); await localRequest(ambiguous, 5000, duplicate.refund_id); await localRequest(ambiguous, 5000, duplicate.refund_id);
      await assert.rejects(write(duplicate), /REFUND_ID_AMBIGUOUS/); assert.equal(await balance(ambiguous.user.id), 100);
    });
    await test("already spent points may become debt and an already used coupon stays used after an external refund", async () => {
      const other = await fixture(); await prisma.$transaction(tx => changeMemberPoints(tx, other.user.id, { eventKey: "qa-spend:" + other.order.id, delta: -100, reason: "隔离已兑换积分" }));
      const template = await prisma.couponTemplate.create({ data: { title: "隔离已用券", amountCents: 100, minimumCents: 1000, startsAt: new Date(0), endsAt: new Date("2099-01-01T00:00:00Z"), totalLimit: 10 } }); templates.push(template.id);
      const claim = await prisma.couponClaim.create({ data: { userId: other.user.id, templateId: template.id, source: "POINTS", pointsSpent: 100, heldOrderId: other.order.id } }); await prisma.order.update({ where: { id: other.order.id }, data: { couponClaimId: claim.id } });
      await write(result(other, 4000)); assert.equal(await balance(other.user.id), -40); const after = await prisma.couponClaim.findUniqueOrThrow({ where: { id: claim.id } }); assert.equal(after.heldOrderId, other.order.id); assert.equal(after.voided, false); assert.equal(after.pointsSpent, 100);
    });
    await test("successful event replay cannot be repurposed to a different original payment and stock never changes", async () => {
      const other = await fixture(); await assert.rejects(write(result(other, 4000), { eventId: `refund-query:${external.refund_id}:${external.status}` }), /EVENT_CHANGED/);
      assert.equal(await prisma.refund.count({ where: { orderId: other.order.id } }), 0); assert.equal(await balance(other.user.id), 100);
      const stock = await prisma.productSku.findUniqueOrThrow({ where: { id: sku.id } }); assert.equal(stock.stockQuantity, 100); assert.equal(stock.reservedQuantity, 0); assert.equal(gatewayCalls, 0);
    });
  } finally {
    const refunds = await prisma.refund.findMany({ where: { orderId: { in: orders } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: users } }, { targetId: { in: [...users, ...orders, ...afterSalesIds, ...refunds.map(row => row.id)] } }] } });
    await prisma.paymentNotification.deleteMany({ where: { orderId: { in: orders } } }); await prisma.refund.deleteMany({ where: { orderId: { in: orders } } });
    await prisma.afterSalesRequest.deleteMany({ where: { id: { in: afterSalesIds } } }); await prisma.order.updateMany({ where: { id: { in: orders } }, data: { couponClaimId: null } });
    await prisma.couponClaim.deleteMany({ where: { userId: { in: users } } }); await prisma.pointEntry.deleteMany({ where: { userId: { in: users } } });
    await prisma.order.deleteMany({ where: { id: { in: orders } } }); await prisma.memberProfile.deleteMany({ where: { userId: { in: users } } }); await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.couponTemplate.deleteMany({ where: { id: { in: templates } } }); await prisma.product.delete({ where: { id: product.id } }); globalThis.fetch = originalFetch; await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

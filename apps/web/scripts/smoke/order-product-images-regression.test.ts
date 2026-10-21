import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(database.pathname, "/vk_refunded_order_status_smoke_20261018");
  assert.ok(["localhost", "127.0.0.1"].includes(database.hostname));
  assert.equal(process.env.COMMERCE_STORAGE, "prisma");
  const originalFetch = globalThis.fetch;
  let gatewayCalls = 0;
  globalThis.fetch = async () => { gatewayCalls++; throw Error("No remote request is allowed in order image database QA"); };
  const { prisma } = await import("@/lib/db/prisma");
  const { listOrdersByUser, getOrderForUser } = await import("@/lib/services/order-service");
  const users: string[] = [], products: string[] = [], orders: string[] = [], suffix = randomUUID();
  try {
    assert.equal(await prisma.product.count({ where: { slug: "x1-air-white" } }), 0, "The isolated QA fixture must not replace any existing product");
    const owner = await prisma.user.create({ data: { role: "CUSTOMER", name: "image-qa-" + suffix } }); users.push(owner.id);
    const other = await prisma.user.create({ data: { role: "CUSTOMER", name: "other-image-qa-" + suffix } }); users.push(other.id);
    async function product(slug: string, image: string | null, gallery: boolean) {
      const row = await prisma.product.create({ data: {
        slug, code: "IMAGE-QA-" + randomUUID(), name: "Current catalog title", category: "QA", summary: "Isolated image QA", image,
        ...(gallery ? { images: { create: [{ imageUrl: "/qa/gallery-later.jpg", sortOrder: 9 }, { imageUrl: "/qa/gallery-first.jpg", sortOrder: 0 }] } } : {}),
        skus: { create: { skuCode: "IMAGE-SKU-" + randomUUID(), color: "白色", size: "M", priceCents: 4400, stockQuantity: 100, reservedQuantity: 3 } },
      }, include: { skus: true } }); products.push(row.id); return row;
    }
    const x1 = await product("x1-air-white", "/qa/x1-main.jpg", true);
    const generic = await product("image-qa-generic-" + suffix, null, true);
    const noImage = await product("image-qa-empty-" + suffix, null, false);
    const order = await prisma.order.create({ data: {
      orderNo: "IMAGE-QA-" + suffix, userId: owner.id, status: "CLOSED", paymentStatus: "REFUNDED", fulfillmentStatus: "PENDING",
      customerName: "Isolated QA", customerPhone: "13900000022", addressSnapshot: "Isolated QA address",
      subtotalCents: 13200, discountCents: 100, payableAmountCents: 13100, shippingFeeCents: 0,
      items: { create: [x1, generic, noImage].map((row, index) => ({ productId: row.id, skuId: row.skus[0].id,
        productCode: row.code, productName: "Purchased snapshot " + index, color: "白色", size: "M", style: index === 0 ? "regular" : "",
        quantity: 1, unitPriceCents: 4400, discountShareCents: index === 0 ? 100 : 0 })) },
    }, include: { items: true } }); orders.push(order.id);
    const payment = await prisma.paymentIntent.create({ data: { orderId: order.id, provider: "WECHAT_PAY", method: "JSAPI", status: "PAID",
      currency: "CNY", amountCents: 13100, merchantOrderNo: "IMAGE-PAY-" + suffix, gatewayTradeNo: "IMAGE-TXN-" + suffix } });
    await prisma.refund.create({ data: { orderId: order.id, paymentId: payment.id, refundNo: "IMAGE-REFUND-" + suffix,
      refundStatus: "SUCCEEDED", refundAmountCents: 13100, reason: "Isolated QA refund" } });
    await prisma.afterSalesRequest.create({ data: { orderId: order.id, userId: owner.id, afterSalesNo: "IMAGE-AS-" + suffix,
      type: "REFUND_ONLY", status: "CANCELLED", reason: "Isolated historic request", description: "No transition is allowed in image reads" } });
    const readSnapshot = async () => ({
      order: await prisma.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true, paymentIntents: true,
        refunds: true, shipments: true, afterSalesRequests: true } }),
      skus: await prisma.productSku.findMany({ where: { productId: { in: products } }, orderBy: { id: "asc" } }),
      audits: await prisma.auditLog.findMany({ where: { targetId: order.id }, orderBy: { id: "asc" } }),
    });
    const before = await readSnapshot();

    await test("real Prisma historical list and detail read the correct images without exposing product relations", async () => {
      const [detail, list] = await Promise.all([getOrderForUser(order.orderNo, owner.id), listOrdersByUser(owner.id)]);
      assert.ok(detail);
      assert.equal(list.length, 1);
      const expected = new Map([[x1.id, "/assets/catalog/x1-air-white/vk-20261014-packs/pack-1-750.webp"],
        [generic.id, "/qa/gallery-first.jpg"], [noImage.id, ""]]);
      for (const result of [detail, list[0]]) {
        assert.equal(result.paymentStatus, "REFUNDED"); assert.equal(result.status, "CLOSED"); assert.equal(result.fulfillmentStatus, "PENDING");
        assert.equal(result.payableAmountCents, 13100); assert.equal(result.discountCents, 100);
        for (const item of result.items) {
          assert.ok("productId" in item);
          assert.equal(item.productImage, expected.get(item.productId));
          assert.equal("product" in item, false);
          const stored = order.items.find(row => row.id === item.id); assert.ok(stored);
          const { productImage, ...snapshot } = item;
          assert.equal(typeof productImage, "string"); assert.deepEqual(snapshot, stored);
        }
      }
      assert.ok("refundSummary" in detail); assert.equal(detail.refundSummary?.fullyRefunded, true);
    });

    await test("real owner-scoped detail supports payment aliases while denying another account", async () => {
      assert.equal((await getOrderForUser(payment.merchantOrderNo, owner.id))?.id, order.id);
      assert.equal(await getOrderForUser(order.orderNo, other.id), null);
      assert.equal(await getOrderForUser(payment.merchantOrderNo, other.id), null);
      assert.deepEqual(await listOrdersByUser(other.id), []);
    });

    await test("repeated image reads preserve every stored order, refund, after-sales and stock field with no gateway or audit write", async () => {
      await Promise.all(Array.from({ length: 3 }, () => getOrderForUser(order.orderNo, owner.id)));
      assert.deepEqual(await readSnapshot(), before);
      assert.equal(gatewayCalls, 0);
    });
  } finally {
    await prisma.afterSalesRequest.deleteMany({ where: { orderId: { in: orders } } });
    await prisma.refund.deleteMany({ where: { orderId: { in: orders } } });
    await prisma.order.deleteMany({ where: { id: { in: orders } } });
    await prisma.product.deleteMany({ where: { id: { in: products } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    globalThis.fetch = originalFetch;
    await prisma.$disconnect();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

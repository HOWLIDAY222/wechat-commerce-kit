import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { OrderStatus, PaymentStatus, FulfillmentStatus, PaymentIntentStatus } from "@prisma/client";

async function main() {
  const url = new URL(process.env.DATABASE_URL || "");
  assert.equal(url.pathname, "/vk_shipping_smoke_20261015", "Shipping tests require the dedicated empty QA database");
  assert(["localhost", "127.0.0.1"].includes(url.hostname));
  assert.equal(process.env.WECHAT_API_BASE_URL, "http://127.0.0.1:18997");
  const { prisma } = await import("@/lib/db/prisma");
  const { Client } = await import("pg");
  const { syncPendingWeChatShipments: sync } = await import("@/lib/services/wechat-shipping-service");
  const { listOrdersForAdmin } = await import("@/lib/services/order-service");
  const { listAdminPayments, listAdminUsers, getAdminUserDetail } = await import("@/lib/services/admin-ops-service");
  const { getWeChatShippingState } = await import("@/lib/commerce/wechat-shipping-status");
  const suffix = randomUUID();
  const originalFetch = globalThis.fetch;
  type Remote = { trade: string; openid: string; state: number; uploaded: boolean; tracking: string; uploads: number; loseResponse?: boolean; onUpload?: () => Promise<void> };
  const remotes = new Map<string, Remote>();
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    const endpoint = new URL(String(input));
    assert.equal(endpoint.origin, "http://127.0.0.1:18997", "No external gateway calls in regression tests");
    requests++;
    const body = JSON.parse(String(init?.body || "{}"));
    if (endpoint.pathname === "/cgi-bin/stable_token") return Response.json({ access_token: "qa-token", expires_in: 7200 });
    if (endpoint.pathname.endsWith("get_delivery_list")) return Response.json({ errcode: 0, delivery_list: [{ delivery_id: "SF", delivery_name: "顺丰速运" }] });
    const transactionId = body.transaction_id || body.order_key?.transaction_id;
    const remote = remotes.get(transactionId);
    assert(remote, "Only QA fixture transactions may be requested");
    if (endpoint.pathname.endsWith("get_order")) return Response.json({ errcode: 0, order: {
      transaction_id: transactionId, merchant_id: process.env.WECHAT_PAY_MCH_ID, merchant_trade_no: remote.trade,
      openid: remote.openid, order_state: remote.state,
      shipping: { finish_shipping: remote.uploaded, shipping_list: remote.uploaded ? [{ tracking_no: remote.tracking, express_company: "SF" }] : [] },
    } });
    if (endpoint.pathname.endsWith("upload_shipping_info")) {
      assert.equal(body.payer.openid, remote.openid);
      assert.equal(body.delivery_mode, 1);
      if (body.logistics_type === 1) {
        assert.equal(body.shipping_list[0].contact.receiver_contact, "****0006");
        assert(body.shipping_list[0].item_desc.includes("隔离测试商品"));
      }
      remote.uploads++;
      remote.uploaded = true;
      remote.state = 2;
      remote.tracking = body.shipping_list[0].tracking_no || "";
      await remote.onUpload?.();
      if (remote.loseResponse) { remote.loseResponse = false; throw Error("Lost response after acceptance"); }
      return Response.json({ errcode: 0 });
    }
    throw Error("Unexpected QA endpoint");
  };
  try {
    const user = await prisma.user.create({ data: { name: "隔离发货测试", wechatIdentities: { create: { appId: process.env.WECHAT_MINIPROGRAM_APP_ID!, openId: "qa-openid-"+suffix } } } });
    const product = await prisma.product.create({ data: { slug: "shipping-qa-"+suffix, code: "shipping-qa-"+suffix, name: "隔离测试商品", category: "TEST", summary: "QA only", skus: { create: { skuCode: "shipping-sku-"+suffix, color: "白色", size: "M", priceCents: 4900, stockQuantity: 100 } } }, include: { skus: true } });
    async function fixture(options: { status?: OrderStatus; paymentStatus?: PaymentStatus; fulfillmentStatus?: FulfillmentStatus; paymentIntentStatus?: PaymentIntentStatus; kind?: string; shipment?: boolean; company?: string } = {}) {
      const id = randomUUID();
      const orderNo = "shipping-qa-"+id;
      const transaction = "qa-transaction-"+id;
      const remote: Remote = { trade: orderNo, openid: "qa-openid-"+suffix, state: 1, uploaded: false, tracking: "", uploads: 0 };
      remotes.set(transaction, remote);
      const order = await prisma.order.create({ data: {
        orderNo, userId: user.id, customerName: "隔离测试", customerPhone: "13900000006", addressSnapshot: "独立测试库", source: "MINIPROGRAM",
        kind: options.kind || "STANDARD", status: options.status || "CONFIRMED", paymentStatus: options.paymentStatus || "PAID", fulfillmentStatus: options.fulfillmentStatus || "SHIPPED", subtotalCents: 4900, payableAmountCents: 4900,
        items: { create: { productId: product.id, skuId: product.skus[0].id, productCode: product.code, productName: product.name, color: "白色", size: "M", quantity: 1, unitPriceCents: 4900 } },
        paymentIntents: { create: { provider: "WECHAT_PAY", method: "wechat_jsapi", merchantOrderNo: orderNo, gatewayTradeNo: transaction, amountCents: 4900, status: options.paymentIntentStatus || "PAID" } },
        ...(options.shipment === false ? {} : { shipments: { create: { trackingCompany: options.company || "顺丰", trackingNo: "SF-QA-"+id, status: options.fulfillmentStatus || "SHIPPED" } } }),
      }, include: { shipments: true, paymentIntents: true } });
      return { order, remote };
    }
    async function protectedSnapshot(orderId: string) {
      return JSON.stringify({ order: await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, paymentIntents: true } }), sku: await prisma.productSku.findUnique({ where: { id: product.skus[0].id } }) });
    }
    async function shipment(id: string) { return prisma.shipment.findUniqueOrThrow({ where: { id } }); }

    await test("successful upload preserves order, payment, item and stock data; rerun does not re-upload", async () => {
      const f = await fixture(), before = await protectedSnapshot(f.order.id);
      assert.equal((await sync({ orderId: f.order.id })).synced, 1);
      assert((await shipment(f.order.shipments[0].id)).wechatSyncedAt);
      assert.equal((await sync({ orderId: f.order.id })).inspected, 0);
      assert.equal(f.remote.uploads, 1);
      assert.equal(await protectedSnapshot(f.order.id), before);
    });
    await test("paid orders awaiting shipment are never marked shipped or submitted", async () => {
      const f = await fixture({ fulfillmentStatus: "PENDING", shipment: false }), before = requests;
      assert.equal((await sync({ orderId: f.order.id })).inspected, 0);
      assert.equal(requests, before);
      assert.equal(getWeChatShippingState(f.order), "NOT_SHIPPED");
    });
    await test("unpaid, cancelled and refunded orders are excluded even with old paid-attempt records", async () => {
      for (const options of [{ paymentStatus: "PENDING" as const }, { status: "CANCELLED" as const }, { paymentStatus: "REFUNDED" as const }]) {
        const f = await fixture(options), before = requests;
        assert.equal((await sync({ orderId: f.order.id })).inspected, 0);
        assert.equal(requests, before);
      }
    });
    await test("WeChat-side refunded transaction never receives shipment upload", async () => {
      const f = await fixture(); f.remote.state = 5;
      assert.equal((await sync({ orderId: f.order.id })).failed, 1);
      assert.equal(f.remote.uploads, 0);
      assert.equal((await shipment(f.order.shipments[0].id)).wechatSyncError, "WECHAT_SHIPPING_ORDER_REFUNDED");
    });
    await test("lost response uses backoff and recovers by querying without a second upload", async () => {
      const f = await fixture(); f.remote.loseResponse = true;
      assert.equal((await sync({ orderId: f.order.id })).failed, 1);
      const row = await shipment(f.order.shipments[0].id);
      assert(row.wechatRetryAt && row.wechatRetryAt.getTime() > Date.now());
      assert.equal((await sync({ orderId: f.order.id })).inspected, 0);
      await prisma.shipment.update({ where: { id: row.id }, data: { wechatRetryAt: null } });
      assert.equal((await sync({ orderId: f.order.id })).synced, 1);
      assert.equal(f.remote.uploads, 1);
    });
    await test("transaction identity mismatch is recorded and never uploaded", async () => {
      const f = await fixture(); f.remote.openid = "different-user";
      assert.equal((await sync({ orderId: f.order.id })).failed, 1);
      assert.equal(f.remote.uploads, 0);
      assert.equal((await shipment(f.order.shipments[0].id)).wechatSyncError, "WECHAT_SHIPPING_ORDER_MISMATCH");
    });
    await test("existing different WeChat tracking is reported as a conflict, never overwritten", async () => {
      const f = await fixture(); f.remote.uploaded = true; f.remote.tracking = "different-tracking";
      assert.equal((await sync({ orderId: f.order.id })).failed, 1);
      assert.equal(f.remote.uploads, 0);
      assert.equal((await shipment(f.order.shipments[0].id)).wechatSyncError, "WECHAT_SHIPPING_REMOTE_CONFLICT");
    });
    await test("unknown carrier remains recoverable without changing order state", async () => {
      const f = await fixture({ company: "未知承运商" }), before = await protectedSnapshot(f.order.id);
      assert.equal((await sync({ orderId: f.order.id })).failed, 1);
      assert.equal(f.remote.uploads, 0);
      assert.equal(await protectedSnapshot(f.order.id), before);
    });
    await test("separate web and timer workers cannot submit concurrently", async () => {
      const f = await fixture();
      const lock = new Client({ connectionString: process.env.DATABASE_URL }); await lock.connect();
      try {
        await lock.query("SELECT pg_advisory_lock(87432,64015)");
        assert.equal((await sync({ orderId: f.order.id })).busy, true);
        assert.equal(f.remote.uploads, 0);
      } finally { await lock.query("SELECT pg_advisory_unlock(87432,64015)"); await lock.end(); }
      assert.equal((await sync({ orderId: f.order.id })).synced, 1);
    });
    await test("tracking correction during an upload does not mark the new number synced or overwrite it", async () => {
      const f = await fixture(), id = f.order.shipments[0].id;
      f.remote.onUpload = async () => { await prisma.shipment.update({ where: { id }, data: { trackingNo: "SF-CORRECTED-QA", wechatSyncedAt: null, wechatSyncError: null } }); };
      f.remote.loseResponse = true;
      assert.equal((await sync({ orderId: f.order.id })).skipped, 1);
      const row = await shipment(id);
      assert.equal(row.trackingNo, "SF-CORRECTED-QA"); assert.equal(row.wechatSyncedAt, null); assert.equal(row.wechatSyncError, null);
    });
    await test("immediate synchronization only processes the requested committed order", async () => {
      const a = await fixture(), b = await fixture();
      assert.equal((await sync({ orderId: a.order.id })).synced, 1);
      assert.equal(b.remote.uploads, 0); assert.equal((await shipment(b.order.shipments[0].id)).wechatSyncedAt, null);
    });
    await test("latest gift-card shipment branch is retained without requiring a physical tracking number", async () => {
      const f = await fixture({ kind: "GIFT_PURCHASE" });
      await prisma.shipment.update({ where: { id: f.order.shipments[0].id }, data: { trackingNo: null, trackingCompany: null } });
      assert.equal((await sync({ orderId: f.order.id })).synced, 1); assert.equal(f.remote.uploads, 1);
    });
    await test("test archive cannot hide a paid real order, even with an incorrect archive event", async () => {
      const f = await fixture({ fulfillmentStatus: "PENDING", shipment: false }), before = await protectedSnapshot(f.order.id);
      await prisma.auditLog.create({ data: { actorType: "system", action: "admin.test_order.archived", targetType: "order", targetId: f.order.id, detail: { reason: "QA defensive check" } } });
      assert((await listOrdersForAdmin()).some(order => order.id === f.order.id));
      assert.equal(await protectedSnapshot(f.order.id), before);
    });
    await test("confirmed unpaid test archive removes list, payment and customer counts without deleting rows; restore works", async () => {
      const f = await fixture({ status: "CANCELLED", paymentStatus: "CANCELLED", paymentIntentStatus: "CANCELLED", shipment: false });
      await prisma.auditLog.create({ data: { actorType: "system", action: "admin.test_order.archived", targetType: "order", targetId: f.order.id, detail: { reason: "QA confirmed test" } } });
      const orders = await listOrdersForAdmin();
      assert(!orders.some(order => order.id === f.order.id));
      assert(! (await listAdminPayments()).some(payment => payment.id === f.order.paymentIntents[0].id));
      const detail = await getAdminUserDetail(user.id); assert(detail);
      assert("_count" in detail);
      assert(!detail.orders.some(order => order.id === f.order.id));
      assert.equal(detail._count.orders, orders.filter(order => order.userId === user.id).length);
      const listed = (await listAdminUsers()).find(candidate => candidate.id === user.id);
      assert(listed && "_count" in listed);
      assert.equal(listed._count.orders, detail._count.orders);
      assert(await prisma.order.findUnique({ where: { id: f.order.id } }));
      await prisma.auditLog.create({ data: { actorType: "system", action: "admin.test_order.restored", targetType: "order", targetId: f.order.id, detail: { reason: "QA restore" } } });
      assert((await listOrdersForAdmin()).some(order => order.id === f.order.id));
    });
  } finally { globalThis.fetch = originalFetch; await prisma.$disconnect(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

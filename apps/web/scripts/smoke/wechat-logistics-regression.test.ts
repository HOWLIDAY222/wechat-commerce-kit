import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { FulfillmentStatus, OrderStatus, PaymentStatus, Prisma } from "@prisma/client";

async function main() {
  const database = new URL(process.env.DATABASE_URL || "");
  assert.equal(database.pathname, "/vk_logistics_smoke_20261018", "Only the dedicated disposable logistics QA database is allowed");
  assert(["127.0.0.1", "localhost"].includes(database.hostname));
  assert.equal(process.env.COMMERCE_STORAGE, "prisma");
  assert.equal(process.env.WECHAT_API_BASE_URL, "http://127.0.0.1:18998");
  assert.equal(process.env.WECHAT_MINIPROGRAM_APP_ID, "qa-logistics-app");
  assert.equal(process.env.WECHAT_PAY_MCH_ID, "qa-logistics-merchant");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(String(input)).origin, "http://127.0.0.1:18998", "No external gateway calls from this test");
    return originalFetch(input, init);
  };
  type Remote = { transaction: string; merchant: string; openid: string; state: number; tracking: string;
    calls: number; queryCalls: number; token: string; followError?: number; loseResponse?: boolean; traceError?: number; traceMismatch?: boolean;
    traceStatus?: number; beforeFollow?: () => Promise<void>; beforeRemote?: () => Promise<void>; beforeTrace?: () => Promise<void> };
  const remotes = new Map<string, Remote>(); let requests = 0;
  const server = createServer(async (request, response) => {
    try {
      requests++;
      const endpoint = new URL(request.url || "", "http://127.0.0.1:18998");
      let text = ""; for await (const chunk of request) text += String(chunk);
      const body = JSON.parse(text || "{}");
      const reply = (value: unknown) => { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(value)); };
      if (endpoint.pathname === "/cgi-bin/stable_token") { reply({ access_token: "qa-logistics-access", expires_in: 7200 }); return; }
      assert.equal(endpoint.searchParams.get("access_token"), "qa-logistics-access");
      if (endpoint.pathname.endsWith("get_delivery_list")) { reply({ errcode: 0, delivery_list: [{ delivery_id: "SF", delivery_name: "顺丰速运" }] }); return; }
      if (endpoint.pathname === "/wxa/sec/order/get_order") {
        const remote = remotes.get(body.transaction_id); assert(remote, "Only known QA transactions may be requested");
        await remote.beforeRemote?.();
        reply({ errcode: 0, order: { transaction_id: remote.transaction, merchant_id: "qa-logistics-merchant", merchant_trade_no: remote.merchant,
          openid: remote.openid, order_state: remote.state, shipping: { finish_shipping: true, shipping_list: [{ tracking_no: remote.tracking, express_company: "SF" }] } } }); return;
      }
      if (endpoint.pathname.endsWith("/follow_waybill")) {
        const remote = remotes.get(body.trans_id); assert(remote);
        assert.equal(body.openid, remote.openid); assert.equal(body.receiver_phone, "13900000006");
        assert.equal(body.waybill_id, remote.tracking); assert.equal(body.delivery_id, "SF");
        assert.equal(body.order_detail_path, `pages/order-detail/index?orderNo=${encodeURIComponent(remote.merchant.replace(/W1$/, ""))}`);
        assert.equal(body.goods_info.detail_list[0].goods_name, "隔离物流商品");
        assert.equal(body.goods_info.detail_list[0].goods_img_url, "https://store.invalid/qa-product.webp");
        remote.calls++; await remote.beforeFollow?.();
        if (remote.loseResponse) { request.socket.destroy(); return; }
        if (remote.followError) { reply({ errcode: remote.followError, errmsg: "QA rejected" }); return; }
        reply({ errcode: 0, waybill_token: remote.token }); return;
      }
      if (endpoint.pathname.endsWith("/query_follow_trace")) {
        const remote = Array.from(remotes.values()).find(value => value.token === body.waybill_token); assert(remote);
        assert.equal(body.openid, remote.openid); remote.queryCalls++; await remote.beforeTrace?.();
        if (remote.traceError) { reply({ errcode: remote.traceError }); return; }
        reply({ errcode: 0, waybill_info: { status: remote.traceStatus ?? 2, waybill_id: remote.traceMismatch ? "DIFFERENT-QA-TRACKING" : remote.tracking } }); return;
      }
      throw Error("Unexpected gateway endpoint; original upload_shipping_info must never be called here");
    } catch { response.statusCode = 500; response.end(JSON.stringify({ error: "QA_GATEWAY_ASSERTION_FAILED" })); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(18998, "127.0.0.1", resolve); });
  const { prisma } = await import("@/lib/db/prisma");
  const { getLogisticsRule, setLogisticsRule, syncPendingWeChatLogistics: sync, getUserOrderLogistics, getAdminOrderLogistics } = await import("@/lib/services/wechat-logistics-service");
  const { GET: logisticsGet } = await import("@/app/api/account/orders/[orderNo]/logistics/route");
  const { createSessionToken, persistSessionToken } = await import("@/lib/auth/session");
  const suffix = randomUUID();
  try {
    // This disposable database can rerun the suite without retaining an old
    // activation boundary. The production-name guard above is mandatory.
    await prisma.siteSetting.deleteMany({ where: { key: "wechatLogisticsRule" } });
    const owner = await prisma.user.create({ data: { name: "QA logistics owner", role: "OWNER" } });
    const admin = await prisma.user.create({ data: { name: "QA logistics admin", role: "ADMIN" } });
    const buyer = await prisma.user.create({ data: { name: "QA logistics buyer", phone: "13900000024", wechatIdentities: { create: { appId: "qa-logistics-app", openId: "qa-openid-" + suffix } } } });
    const stranger = await prisma.user.create({ data: { name: "QA logistics stranger" } });
    const product = await prisma.product.create({ data: { slug: "logistics-qa-" + suffix, code: "logistics-qa-" + suffix, name: "隔离物流商品", category: "TEST", summary: "QA only", image: "https://store.invalid/qa-product.webp",
      skus: { create: { skuCode: "logistics-sku-" + suffix, color: "白色", size: "M", priceCents: 4900, stockQuantity: 100 } } }, include: { skus: true } });
    async function fixture(options: { createdAt?: Date; shippedAt?: Date; status?: OrderStatus; paymentStatus?: PaymentStatus; fulfillmentStatus?: FulfillmentStatus; source?: string; kind?: string; synced?: boolean; rawResponse?: Prisma.InputJsonValue; company?: string } = {}) {
      const id = randomUUID(), orderNo = "logistics-qa-" + id, transaction = "qa-transaction-" + id;
      const remote: Remote = { transaction, merchant: orderNo + "W1", openid: "qa-openid-" + suffix, state: 2, tracking: "SF-QA-" + id, calls: 0, queryCalls: 0, token: "qa-waybill-token-" + id };
      remotes.set(transaction, remote);
      const order = await prisma.order.create({ data: { orderNo, userId: buyer.id, customerName: "隔离物流收件人", customerPhone: "13900000006", addressSnapshot: "独立物流测试库",
        kind: options.kind ?? "STANDARD", source: options.source ?? "MINIPROGRAM", status: options.status ?? "CONFIRMED", paymentStatus: options.paymentStatus ?? "PAID", fulfillmentStatus: options.fulfillmentStatus ?? "SHIPPED",
        createdAt: options.createdAt ?? new Date(), subtotalCents: 4900, payableAmountCents: 4900,
        items: { create: { productId: product.id, skuId: product.skus[0].id, productCode: product.code, productName: "隔离物流商品", color: "白色", size: "M", quantity: 1, unitPriceCents: 4900 } },
        paymentIntents: { create: { provider: "WECHAT_PAY", method: "wechat_jsapi", status: "PAID", amountCents: 4900, merchantOrderNo: remote.merchant, gatewayTradeNo: transaction,
          rawResponse: options.rawResponse ?? { appid: "qa-logistics-app", mchid: "qa-logistics-merchant", out_trade_no: remote.merchant, transaction_id: transaction, trade_state: "SUCCESS", payer: { openid: remote.openid }, amount: { total: 4900, currency: "CNY" } } } },
        shipments: { create: { status: "SHIPPED", trackingCompany: options.company ?? "顺丰", trackingNo: remote.tracking, shippedAt: options.shippedAt ?? new Date(), wechatSyncedAt: options.synced === false ? null : new Date() } },
      }, include: { shipments: true, paymentIntents: true } });
      return { order, remote, shipment: order.shipments[0] };
    }
    async function binding(shipmentId: string) {
      return prisma.$queryRaw<Array<{ state: string; waybill_token: string | null; error_code: string | null }>>`SELECT state, waybill_token, error_code FROM wechat_logistics_bindings WHERE shipment_id = ${shipmentId}`;
    }
    async function protectedSnapshot(orderId: string) {
      return JSON.stringify({ order: await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, shipments: true, paymentIntents: true, refunds: true, afterSalesRequests: true } }),
        sku: await prisma.productSku.findUnique({ where: { id: product.skus[0].id } }) });
    }

    await test("default disabled needs no new table; enabling requires existing schema and active OWNER", async () => {
      await setLogisticsRule(false, owner.id);
      await assert.rejects(setLogisticsRule(true, admin.id), /OWNER_REQUIRED/);
      const f = await fixture(); const before = await protectedSnapshot(f.order.id), calls = requests;
      await prisma.$executeRaw`ALTER TABLE wechat_logistics_bindings RENAME TO qa_logistics_bindings_temporarily_absent`;
      try {
        assert.equal((await getLogisticsRule()).enabled, false);
        assert.equal((await sync()).disabled, true);
        assert.equal((await getAdminOrderLogistics(f.order.orderNo))?.shipments[0].state, "DISABLED");
        assert.deepEqual(await getUserOrderLogistics(f.order.id, buyer.id), { available: false, reason: "DISABLED" });
        await assert.rejects(setLogisticsRule(true, owner.id), /WECHAT_LOGISTICS_SCHEMA_REQUIRED/);
        assert.equal(requests, calls); assert.equal(await protectedSnapshot(f.order.id), before);
      } finally { await prisma.$executeRaw`ALTER TABLE qa_logistics_bindings_temporarily_absent RENAME TO wechat_logistics_bindings`; }
      await setLogisticsRule(true, owner.id);
      assert.equal((await sync({ orderId: f.order.id })).inspected, 0, "Shipment sent before activation stays excluded");
    });
    await test("new purchase registers once, stores token, uses receiver snapshot and leaves all commerce data untouched", async () => {
      const f = await fixture(), before = await protectedSnapshot(f.order.id);
      assert.equal((await sync({ orderId: f.order.id })).registered, 1); assert.equal(f.remote.calls, 1);
      assert.equal((await binding(f.shipment.id))[0].state, "BOUND");
      assert.equal((await sync({ orderId: f.order.id })).inspected, 0); assert.equal(f.remote.calls, 1);
      assert.equal(await protectedSnapshot(f.order.id), before);
      const view = await getAdminOrderLogistics(f.order.orderNo); assert.equal(view?.shipments[0].state, "BOUND"); assert(!JSON.stringify(view).includes(f.remote.token));
    });
    await test("existing pre-activation purchase registers on its new shipment while GET stays read-only before registration", async () => {
      const f = await fixture({ createdAt: new Date("2000-01-01") }), before = await protectedSnapshot(f.order.id), calls = requests;
      assert.deepEqual(await getUserOrderLogistics(f.order.id, buyer.id), { available: false, reason: "NOT_REGISTERED" });
      assert.equal(requests, calls); assert.equal((await binding(f.shipment.id)).length, 0);
      assert.equal((await sync({ orderId: f.order.id })).registered, 1); assert.equal(f.remote.calls, 1);
      const result = await getUserOrderLogistics(f.order.id, buyer.id); assert(result.available); assert.equal(result.waybillToken, f.remote.token);
      assert.equal((await sync({ orderId: f.order.id })).inspected, 0); assert.equal(f.remote.calls, 1);
      assert.equal(await protectedSnapshot(f.order.id), before);
    });
    await test("historic shipments, unpaid, cancelled, web, gift and pending-upload orders never register or modify existing data", async () => {
      for (const options of [{ createdAt: new Date("2000-01-01"), shippedAt: new Date("2000-01-01") }, { shippedAt: new Date("2000-01-01") }, { paymentStatus: "PENDING" as const }, { paymentStatus: "REFUNDED" as const },
        { status: "CANCELLED" as const }, { source: "WEB" }, { kind: "GIFT_PURCHASE" }, { kind: "GIFT_REDEMPTION" }, { synced: false }]) {
        const f = await fixture(options), before = await protectedSnapshot(f.order.id), calls = requests;
        assert.equal((await sync({ orderId: f.order.id })).inspected, 0); assert.equal(requests, calls); assert.equal(f.remote.calls, 0);
        assert.equal(await protectedSnapshot(f.order.id), before); assert.equal((await binding(f.shipment.id)).length, 0);
      }
    });
    await test("first-read reasons distinguish historic shipments and original shipping upload still pending without gateway calls", async () => {
      const calls = requests;
      const historic = await fixture({ createdAt: new Date("2000-01-01"), shippedAt: new Date("2000-01-01") });
      assert.deepEqual(await getUserOrderLogistics(historic.order.id, buyer.id), { available: false, reason: "BEFORE_ACTIVATION" });
      const unsynced = await fixture({ createdAt: new Date("2000-01-01"), synced: false });
      assert.deepEqual(await getUserOrderLogistics(unsynced.order.id, buyer.id), { available: false, reason: "SHIPPING_SYNC_PENDING" });
      assert.equal(requests, calls); assert.equal((await binding(historic.shipment.id)).length, 0); assert.equal((await binding(unsynced.shipment.id)).length, 0);
    });
    await test("a pre-activation shipment is not enrolled just because tracking or shipping-sync metadata changes later", async () => {
      const f = await fixture({ createdAt: new Date("2000-01-01"), shippedAt: new Date("2000-01-02") });
      await prisma.shipment.update({ where: { id: f.shipment.id }, data: { trackingNo: "SF-QA-HISTORIC-CORRECTION", wechatSyncedAt: new Date() } });
      const before = await protectedSnapshot(f.order.id), calls = requests;
      assert.equal((await sync({ orderId: f.order.id })).inspected, 0);
      assert.deepEqual(await getUserOrderLogistics(f.order.id, buyer.id), { available: false, reason: "BEFORE_ACTIVATION" });
      assert.equal(requests, calls); assert.equal(f.remote.calls, 0); assert.equal((await binding(f.shipment.id)).length, 0); assert.equal(await protectedSnapshot(f.order.id), before);
    });
    await test("two independent concurrent workers can send only once", async () => {
      const f = await fixture(); const results = await Promise.all([sync({ orderId: f.order.id }), sync({ orderId: f.order.id })]);
      assert.equal(results.reduce((sum, row) => sum + row.registered, 0), 1); assert.equal(f.remote.calls, 1); assert.equal((await binding(f.shipment.id)).length, 1);
    });
    await test("lost response is quarantined UNKNOWN without automatic retry", async () => {
      const f = await fixture(), before = await protectedSnapshot(f.order.id); f.remote.loseResponse = true;
      assert.equal((await sync({ orderId: f.order.id })).unknown, 1); assert.equal((await binding(f.shipment.id))[0].state, "UNKNOWN");
      await sync({ orderId: f.order.id }); assert.equal(f.remote.calls, 1); assert.equal(await protectedSnapshot(f.order.id), before);
    });
    await test("explicit gateway rejection is FAILED and a timer does not resend", async () => {
      const f = await fixture(); f.remote.followError = 9300560;
      assert.equal((await sync({ orderId: f.order.id })).failed, 1); assert.equal((await binding(f.shipment.id))[0].error_code, "WECHAT_SHIPPING_API_9300560");
      await sync({ orderId: f.order.id }); assert.equal(f.remote.calls, 1);
    });
    await test("remote payer mismatch is rejected before follow and commerce remains unchanged", async () => {
      const f = await fixture(), before = await protectedSnapshot(f.order.id); f.remote.openid = "different-qa-buyer";
      assert.equal((await sync({ orderId: f.order.id })).failed, 1); assert.equal(f.remote.calls, 0); assert.equal(await protectedSnapshot(f.order.id), before);
    });
    await test("tracking correction while preflight is running prevents sending old tracking", async () => {
      const f = await fixture(); f.remote.beforeRemote = async () => { await prisma.shipment.update({ where: { id: f.shipment.id }, data: { trackingNo: "SF-QA-CORRECTED", wechatSyncedAt: null } }); };
      assert.equal((await sync({ orderId: f.order.id })).failed, 1); assert.equal(f.remote.calls, 0);
      assert.equal((await binding(f.shipment.id))[0].error_code, "WECHAT_LOGISTICS_TRACKING_OR_RULE_CHANGED");
    });
    await test("corrected tracking for an eligible shipment hides the old token and registers the new fingerprint only once", async () => {
      const f = await fixture({ createdAt: new Date("2000-01-01") }); await sync({ orderId: f.order.id });
      const oldToken = f.remote.token;
      f.remote.tracking = "SF-QA-CORRECTED-" + randomUUID(); f.remote.token = "qa-new-waybill-token-" + randomUUID();
      await prisma.shipment.update({ where: { id: f.shipment.id }, data: { trackingNo: f.remote.tracking, wechatSyncedAt: null } });
      const calls = requests;
      assert.deepEqual(await getUserOrderLogistics(f.order.id, buyer.id), { available: false, reason: "SHIPPING_SYNC_PENDING" });
      assert.equal((await sync({ orderId: f.order.id })).inspected, 0); assert.equal(requests, calls);
      await prisma.shipment.update({ where: { id: f.shipment.id }, data: { wechatSyncedAt: new Date() } });
      const before = await protectedSnapshot(f.order.id);
      assert.equal((await sync({ orderId: f.order.id })).registered, 1); assert.equal(f.remote.calls, 2);
      assert.equal((await binding(f.shipment.id)).length, 2);
      const current = await getUserOrderLogistics(f.order.id, buyer.id); assert(current.available); assert.equal(current.waybillToken, f.remote.token); assert.notEqual(current.waybillToken, oldToken);
      assert.equal((await sync({ orderId: f.order.id })).inspected, 0); assert.equal(f.remote.calls, 2); assert.equal(await protectedSnapshot(f.order.id), before);
    });
    await test("disabled or new activation boundary during preflight prevents a message", async () => {
      const f = await fixture(); f.remote.beforeRemote = async () => { await setLogisticsRule(false, owner.id); };
      assert.equal((await sync({ orderId: f.order.id })).failed, 1); assert.equal(f.remote.calls, 0);
      await delay(5); await setLogisticsRule(true, owner.id);
      assert.equal((await sync({ orderId: f.order.id })).inspected, 0);
    });
    await test("owner-only customer route returns token with no-store; stranger and unauthenticated requests never receive one", async () => {
      const f = await fixture(); await sync({ orderId: f.order.id });
      const buyerToken = createSessionToken(), strangerToken = createSessionToken();
      const expires = new Date(Date.now() + 60_000); await persistSessionToken(buyerToken, expires, { userId: buyer.id, role: "customer" }); await persistSessionToken(strangerToken, expires, { userId: stranger.id, role: "customer" });
      const context = { params: Promise.resolve({ orderNo: f.order.orderNo }) };
      const response = await logisticsGet(new Request("https://store.invalid/api/account/orders/qa/logistics", { headers: { Authorization: "Bearer " + buyerToken } }), context);
      assert.equal(response.status, 200); assert.match(response.headers.get("cache-control") || "", /private, no-store/);
      const data = await response.json(); assert.equal(data.logistics.waybillToken, f.remote.token); assert.equal(data.logistics.status, 2);
      const calls = requests;
      const forbidden = await logisticsGet(new Request("https://store.invalid/api/account/orders/qa/logistics", { headers: { Authorization: "Bearer " + strangerToken } }), context);
      assert.equal(forbidden.status, 404); assert(!JSON.stringify(await forbidden.json()).includes(f.remote.token)); assert.equal(requests, calls);
      const absent = await logisticsGet(new Request("https://store.invalid/api/account/orders/qa/logistics", { headers: { Authorization: "Bearer invalid" } }), context);
      assert.equal(absent.status, 401);
      assert.deepEqual(await getUserOrderLogistics(f.order.id, stranger.id), { available: false, reason: "ORDER_NOT_FOUND" });
    });
    await test("trace delivered statuses only display and never confirm receipt, allocate points or change stock", async () => {
      for (const status of [4, 6]) {
        const f = await fixture(); f.remote.traceStatus = status; await sync({ orderId: f.order.id }); const before = await protectedSnapshot(f.order.id);
        const result = await getUserOrderLogistics(f.order.id, buyer.id); assert(result.available); assert.equal(result.status, status);
        assert.equal(await protectedSnapshot(f.order.id), before);
      }
    });
    await test("trace error keeps only buyer's persisted token; remote tracking mismatch and later corrections hide old tokens", async () => {
      const f = await fixture(); f.remote.traceError = 9300513; await sync({ orderId: f.order.id }); const before = await protectedSnapshot(f.order.id);
      const result = await getUserOrderLogistics(f.order.id, buyer.id); assert(result.available); assert.equal(result.waybillToken, f.remote.token); assert.equal(result.status, null);
      assert.equal(await protectedSnapshot(f.order.id), before);
      const mismatch = await fixture(); mismatch.remote.traceMismatch = true; await sync({ orderId: mismatch.order.id }); assert.deepEqual(await getUserOrderLogistics(mismatch.order.id, buyer.id), { available: false, reason: "TRACKING_MISMATCH" });
      await prisma.shipment.update({ where: { id: f.shipment.id }, data: { trackingNo: "SF-QA-NEW-NUMBER", wechatSyncedAt: null } });
      const corrected = await getUserOrderLogistics(f.order.id, buyer.id); assert(!corrected.available); assert(!JSON.stringify(corrected).includes(f.remote.token));
      const inFlight = await fixture(); await sync({ orderId: inFlight.order.id }); inFlight.remote.beforeTrace = async () => { await prisma.shipment.update({ where: { id: inFlight.shipment.id }, data: { trackingNo: "SF-QA-QUERY-CORRECTION", wechatSyncedAt: null } }); };
      assert.deepEqual(await getUserOrderLogistics(inFlight.order.id, buyer.id), { available: false, reason: "TRACKING_CHANGED" });
    });
    await test("stale SENDING acceptance becomes UNKNOWN and is never submitted again", async () => {
      const f = await fixture(); await sync({ orderId: f.order.id });
      await prisma.$executeRaw`UPDATE wechat_logistics_bindings SET state = 'SENDING', waybill_token = NULL, registered_at = NULL,
        attempt_started_at = ${new Date(Date.now() - 11 * 60_000)} WHERE shipment_id = ${f.shipment.id}`;
      const report = await sync({ orderId: f.order.id }); assert.equal(report.unknown, 1); assert.equal((await binding(f.shipment.id))[0].state, "UNKNOWN"); assert.equal(f.remote.calls, 1);
    });
    await test("false-to-true resets activation and never backfills a shipment sent while disabled", async () => {
      const before = await getLogisticsRule(); await setLogisticsRule(false, owner.id); const f = await fixture(); await delay(5);
      const after = await setLogisticsRule(true, owner.id); assert(after.activatedAt && before.activatedAt && Date.parse(after.activatedAt) > Date.parse(before.activatedAt));
      assert.equal((await sync({ orderId: f.order.id })).inspected, 0); assert.equal(f.remote.calls, 0);
      const unchanged = await setLogisticsRule(true, owner.id); assert.equal(unchanged.activatedAt, after.activatedAt);
    });
    await test("disabling new registration preserves existing BOUND queries and admin state without another follow", async () => {
      const f = await fixture(); await sync({ orderId: f.order.id }); const before = await protectedSnapshot(f.order.id);
      await setLogisticsRule(false, owner.id);
      const calls = f.remote.calls; assert.equal((await sync({ orderId: f.order.id })).disabled, true);
      const existing = await getUserOrderLogistics(f.order.id, buyer.id); assert(existing.available); assert.equal(existing.waybillToken, f.remote.token);
      assert.equal((await getAdminOrderLogistics(f.order.orderNo))?.shipments[0].state, "BOUND");
      assert.equal(f.remote.calls, calls); assert.equal(await protectedSnapshot(f.order.id), before);
    });
  } finally {
    await prisma.$disconnect(); globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
main().catch(error => { console.error(error instanceof Error ? error.stack : "LOGISTICS_QA_FAILED"); process.exitCode = 1; });

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { FulfillmentStatus, OrderStatus, PaymentStatus } from "@prisma/client";

async function main() {
  const database = new URL(process.env.DATABASE_URL || "");
  assert.equal(database.pathname, "/vk_dispatch_estimate_smoke_20261018", "Only the dedicated disposable dispatch-estimate QA database is allowed");
  assert(["localhost", "127.0.0.1"].includes(database.hostname));
  assert.equal(process.env.COMMERCE_STORAGE, "prisma");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Error("No external or internal gateway requests are permitted in dispatch-estimate tests"); };
  const { prisma } = await import("@/lib/db/prisma");
  const { Client } = await import("pg");
  const { getAdminOrderDispatchEstimate: adminGet, getUserOrderDispatchEstimate: userGet, setOrderDispatchEstimate: save } = await import("@/lib/services/order-dispatch-estimate-service");
  const { beijingCalendarDate } = await import("@/lib/commerce/order-dispatch-estimate");
  const { GET: customerGet } = await import("@/app/api/account/orders/[orderNo]/dispatch-estimate/route");
  const { createSessionToken, persistSessionToken } = await import("@/lib/auth/session");
  const { performAdminOrderAction } = await import("@/lib/services/order-service");
  const suffix = randomUUID();
  const plusDays = (days: number) => { const date = new Date(beijingCalendarDate() + "T00:00:00Z"); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
  try {
    const owner = await prisma.user.create({ data: { name: "QA dispatch owner", role: "OWNER" } });
    const admin = await prisma.user.create({ data: { name: "QA dispatch admin", role: "ADMIN" } });
    const disabled = await prisma.user.create({ data: { name: "QA dispatch disabled admin", role: "ADMIN", status: "DISABLED" } });
    const buyer = await prisma.user.create({ data: { name: "QA dispatch buyer" } });
    const stranger = await prisma.user.create({ data: { name: "QA dispatch stranger" } });
    const product = await prisma.product.create({ data: { slug: "dispatch-qa-" + suffix, code: "dispatch-qa-" + suffix, name: "隔离预计发货商品", category: "TEST", summary: "QA only",
      estimatedShipAt: new Date("2099-01-01T00:00:00Z"), skus: { create: { skuCode: "dispatch-qa-sku-" + suffix, color: "白色", size: "M", priceCents: 4900, stockQuantity: 100 } } }, include: { skus: true } });
    async function fixture(options: { kind?: string; status?: OrderStatus; paymentStatus?: PaymentStatus; fulfillmentStatus?: FulfillmentStatus; payable?: number;
      shipment?: { status?: FulfillmentStatus; trackingNo?: string; trackingCompany?: string; shippedAt?: Date; deliveredAt?: Date }; refundedCents?: number } = {}) {
      const id = randomUUID(), orderNo = "dispatch-qa-" + id, merchantOrderNo = orderNo + "W1";
      const order = await prisma.order.create({ data: { orderNo, userId: buyer.id, kind: options.kind ?? "STANDARD", source: "MINIPROGRAM",
        status: options.status ?? "CONFIRMED", paymentStatus: options.paymentStatus ?? "PAID", fulfillmentStatus: options.fulfillmentStatus ?? "PENDING",
        customerName: "隔离预计发货测试", customerPhone: "13900000006", addressSnapshot: "独立预计发货测试库",
        subtotalCents: options.payable ?? 4900, payableAmountCents: options.payable ?? 4900,
        items: { create: { productId: product.id, skuId: product.skus[0].id, productCode: product.code, productName: product.name, color: "白色", size: "M", quantity: 1, unitPriceCents: 4900 } },
        paymentIntents: { create: { provider: "WECHAT_PAY", method: "wechat_jsapi", status: "PAID", merchantOrderNo, gatewayTradeNo: "qa-no-real-transaction-" + id, amountCents: options.payable ?? 4900 } },
        ...(options.shipment ? { shipments: { create: { status: options.shipment.status ?? "PROCESSING", trackingNo: options.shipment.trackingNo, trackingCompany: options.shipment.trackingCompany, shippedAt: options.shipment.shippedAt, deliveredAt: options.shipment.deliveredAt } } } : {}),
        ...(options.refundedCents ? { refunds: { create: { refundNo: "dispatch-refund-qa-" + id, refundStatus: "SUCCEEDED", refundAmountCents: options.refundedCents, reason: "Isolated QA only" } } } : {}),
      }, include: { shipments: true, paymentIntents: true } });
      return order;
    }
    async function protectedSnapshot(orderId: string) {
      return JSON.stringify({ order: await prisma.order.findUnique({ where: { id: orderId }, include: { items: true, shipments: true, paymentIntents: true, refunds: true, afterSalesRequests: true } }),
        sku: await prisma.productSku.findUnique({ where: { id: product.skus[0].id } }) });
    }
    const auditCount = (orderId: string) => prisma.auditLog.count({ where: { targetId: orderId, action: "order.dispatch_estimate.updated" } });
    const recordCount = async (orderId: string) => Number((await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM order_dispatch_estimates WHERE order_id = ${orderId}`)[0].count);

    await test("unknown estimates read UNSET without inserting rows or borrowing a product's current ship date", async () => {
      const order = await fixture(), before = await protectedSnapshot(order.id);
      const result = await adminGet(order.orderNo); assert(result); assert.equal(result.editable, true); assert.equal(result.dispatchEstimate.status, "UNSET"); assert.equal(result.dispatchEstimate.startDate, null); assert.equal(result.dispatchEstimate.endDate, null); assert.equal(result.dispatchEstimate.revision, 0);
      const customer = await userGet(order.id, buyer.id); assert(customer); assert.equal(customer.status, "UNSET"); assert.equal(customer.startDate, null); assert.equal(customer.endDate, null);
      assert.equal(await recordCount(order.id), 0); assert.equal(await auditCount(order.id), 0); assert.equal(await protectedSnapshot(order.id), before);
    });
    await test("admin sets a Beijing calendar date window with atomic audit while order/payment/stock/shipment snapshots remain unchanged", async () => {
      const order = await fixture(), before = await protectedSnapshot(order.id), startDate = plusDays(10), endDate = plusDays(12);
      const result = await save(order.orderNo, { startDate, endDate, expectedRevision: 0 }, admin.id);
      assert.equal(result.dispatchEstimate.startDate, startDate); assert.equal(result.dispatchEstimate.endDate, endDate); assert.equal(result.dispatchEstimate.status, "SCHEDULED"); assert.equal(result.dispatchEstimate.revision, 1); assert.equal(result.editable, true);
      const customer = await userGet(order.id, buyer.id); assert.deepEqual(customer, result.dispatchEstimate); assert.equal(await recordCount(order.id), 1);
      const event = await prisma.auditLog.findFirstOrThrow({ where: { targetId: order.id, action: "order.dispatch_estimate.updated" } });
      assert.equal(event.actorId, admin.id); assert.deepEqual(event.detail, { before: { startDate: null, endDate: null, revision: 0 }, after: { startDate, endDate, revision: 1 } });
      assert.equal(await protectedSnapshot(order.id), before);
    });
    await test("explicit revisioned update and clear synchronize to customer reads without touching commerce data", async () => {
      const order = await fixture(), before = await protectedSnapshot(order.id);
      await save(order.orderNo, { startDate: plusDays(10), endDate: plusDays(10), expectedRevision: 0 }, owner.id);
      const changed = await save(order.orderNo, { startDate: plusDays(11), endDate: plusDays(11), expectedRevision: 1 }, owner.id); assert.equal(changed.dispatchEstimate.revision, 2);
      assert.deepEqual(await userGet(order.id, buyer.id), changed.dispatchEstimate);
      const cleared = await save(order.orderNo, { startDate: null, endDate: null, expectedRevision: 2 }, owner.id);
      assert.equal(cleared.dispatchEstimate.status, "UNSET"); assert.equal(cleared.dispatchEstimate.startDate, null); assert.equal(cleared.dispatchEstimate.endDate, null); assert.equal(cleared.dispatchEstimate.revision, 3);
      assert.deepEqual(await userGet(order.id, buyer.id), cleared.dispatchEstimate); assert.equal(await auditCount(order.id), 3); assert.equal(await protectedSnapshot(order.id), before);
    });
    await test("past-date writes are rejected without changing the prior estimate, audit or protected order fields", async () => {
      const order = await fixture(); const current = await save(order.orderNo, { startDate: plusDays(10), endDate: plusDays(10), expectedRevision: 0 }, owner.id), before = await protectedSnapshot(order.id);
      await assert.rejects(save(order.orderNo, { startDate: plusDays(-1), endDate: plusDays(-1), expectedRevision: 1 }, owner.id), /DISPATCH_ESTIMATE_DATE_IN_PAST/);
      assert.deepEqual((await adminGet(order.orderNo))?.dispatchEstimate, current.dispatchEstimate); assert.equal(await auditCount(order.id), 1); assert.equal(await protectedSnapshot(order.id), before);
    });
    await test("ongoing windows ending today are accepted and invalid or partial ranges never create a row", async () => {
      const order = await fixture(); const result = await save(order.orderNo, { startDate: plusDays(-2), endDate: beijingCalendarDate(), expectedRevision: 0 }, owner.id); assert.equal(result.dispatchEstimate.status, "SCHEDULED");
      assert.equal(result.dispatchEstimate.startDate, plusDays(-2)); assert.equal(result.dispatchEstimate.endDate, beijingCalendarDate());
      const invalid = await fixture();
      for (const range of [{ startDate: "2026-02-30", endDate: "2026-03-05" }, { startDate: null, endDate: plusDays(10) }, { startDate: plusDays(10), endDate: null }, { startDate: plusDays(11), endDate: plusDays(10) }]) await assert.rejects(save(invalid.orderNo, { ...range, expectedRevision: 0 }, owner.id), /INVALID_DISPATCH_ESTIMATE/);
      await assert.rejects(prisma.$executeRaw`INSERT INTO order_dispatch_estimates (order_id, start_date, end_date, revision, updated_by) VALUES (${invalid.id}, NULL, ${plusDays(10)}::date, 1, ${owner.id})`, /order_dispatch_estimate_date_pair/);
      await assert.rejects(prisma.$executeRaw`INSERT INTO order_dispatch_estimates (order_id, start_date, end_date, revision, updated_by) VALUES (${invalid.id}, ${plusDays(11)}::date, ${plusDays(10)}::date, 1, ${owner.id})`, /order_dispatch_estimate_date_order/);
      assert.equal(await recordCount(invalid.id), 0); assert.equal(await auditCount(invalid.id), 0);
    });
    await test("stale revision cannot overwrite a newer estimate or emit an extra audit event", async () => {
      const order = await fixture(); const current = await save(order.orderNo, { startDate: plusDays(10), endDate: plusDays(10), expectedRevision: 0 }, owner.id);
      await assert.rejects(save(order.orderNo, { startDate: plusDays(11), endDate: plusDays(11), expectedRevision: 0 }, admin.id), /DISPATCH_ESTIMATE_REVISION_CONFLICT/);
      assert.deepEqual((await adminGet(order.orderNo))?.dispatchEstimate, current.dispatchEstimate); assert.equal(await auditCount(order.id), 1);
    });
    await test("concurrent first edits serialize on the order row and exactly one expectedRevision wins", async () => {
      const order = await fixture(), before = await protectedSnapshot(order.id);
      const results = await Promise.allSettled([save(order.orderNo, { startDate: plusDays(10), endDate: plusDays(10), expectedRevision: 0 }, owner.id), save(order.orderNo, { startDate: plusDays(11), endDate: plusDays(11), expectedRevision: 0 }, admin.id)]);
      assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
      const rejected = results.find(result => result.status === "rejected"); assert(rejected && rejected.status === "rejected"); assert.match(String(rejected.reason), /DISPATCH_ESTIMATE_REVISION_CONFLICT/);
      assert.equal((await adminGet(order.orderNo))?.dispatchEstimate.revision, 1); assert.equal(await auditCount(order.id), 1); assert.equal(await protectedSnapshot(order.id), before);
    });
    await test("cancelled, closed, unpaid, fully-refunded, already-shipped and digital gift orders reject any schedule mutation", async () => {
      for (const options of [{ status: "CANCELLED" as const }, { status: "CLOSED" as const }, { status: "CREATED" as const }, { paymentStatus: "PENDING" as const },
        { paymentStatus: "REFUNDED" as const }, { refundedCents: 4900 }, { fulfillmentStatus: "SHIPPED" as const }, { fulfillmentStatus: "DELIVERED" as const }, { fulfillmentStatus: "RETURNED" as const }, { kind: "GIFT_PURCHASE" }]) {
        const order = await fixture(options), before = await protectedSnapshot(order.id);
        const view = await adminGet(order.orderNo); assert(view); assert.equal(view.editable, false);
        await assert.rejects(save(order.orderNo, { startDate: plusDays(10), endDate: plusDays(10), expectedRevision: 0 }, owner.id), /DISPATCH_ESTIMATE_/);
        assert.equal(await recordCount(order.id), 0); assert.equal(await auditCount(order.id), 0); assert.equal(await protectedSnapshot(order.id), before);
      }
    });
    await test("actual shipment evidence blocks edits even when the order still says pending", async () => {
      for (const shipment of [{ trackingNo: "QA-ONLY-WAYBILL" }, { trackingCompany: "QA-ONLY-CARRIER" }, { shippedAt: new Date() }, { deliveredAt: new Date() }, { status: "SHIPPED" as const }]) {
        const order = await fixture({ shipment }), before = await protectedSnapshot(order.id);
        await assert.rejects(save(order.orderNo, { startDate: plusDays(10), endDate: plusDays(10), expectedRevision: 0 }, owner.id), /DISPATCH_ESTIMATE_SHIPMENT_EXISTS/);
        assert.equal(await recordCount(order.id), 0); assert.equal(await protectedSnapshot(order.id), before);
      }
    });
    await test("processing without actual shipment and a physical gift redemption may get independent estimates", async () => {
      for (const options of [{ fulfillmentStatus: "PROCESSING" as const, shipment: { status: "PROCESSING" as const } }, { kind: "GIFT_REDEMPTION", payable: 0 }]) {
        const order = await fixture(options), before = await protectedSnapshot(order.id);
        assert.equal((await save(order.orderNo, { startDate: plusDays(10), endDate: plusDays(10), expectedRevision: 0 }, admin.id)).dispatchEstimate.revision, 1);
        assert.equal(await protectedSnapshot(order.id), before);
      }
    });
    await test("only active current admins or owners can mutate the independent estimate table", async () => {
      const order = await fixture();
      for (const actorId of [buyer.id, disabled.id, "missing-qa-admin"]) await assert.rejects(save(order.orderNo, { startDate: plusDays(10), endDate: plusDays(10), expectedRevision: 0 }, actorId), /ADMIN_REQUIRED/);
      assert.equal(await recordCount(order.id), 0); assert.equal(await auditCount(order.id), 0);
    });
    await test("historical past dates remain readable as OVERDUE and are never silently clamped or rewritten", async () => {
      const order = await fixture(), past = plusDays(-5), before = await protectedSnapshot(order.id);
      await prisma.$executeRaw`INSERT INTO order_dispatch_estimates (order_id, start_date, end_date, revision, updated_by) VALUES (${order.id}, ${plusDays(-10)}::date, ${past}::date, 7, ${owner.id})`;
      const estimate = await userGet(order.id, buyer.id); assert(estimate); assert.equal(estimate.status, "OVERDUE"); assert.equal(estimate.startDate, plusDays(-10)); assert.equal(estimate.endDate, past); assert.equal(estimate.revision, 7);
      assert.deepEqual((await adminGet(order.orderNo))?.dispatchEstimate, estimate); assert.equal(await auditCount(order.id), 0); assert.equal(await protectedSnapshot(order.id), before);
    });
    await test("missing new storage is explicitly unavailable instead of inventing UNSET and cannot affect original orders", async () => {
      const order = await fixture(), before = await protectedSnapshot(order.id);
      await prisma.$executeRaw`ALTER TABLE order_dispatch_estimates RENAME TO qa_dispatch_estimates_temporarily_absent`;
      try {
        await assert.rejects(adminGet(order.orderNo), /DISPATCH_ESTIMATE_SCHEMA_REQUIRED/);
        await assert.rejects(userGet(order.id, buyer.id), /DISPATCH_ESTIMATE_SCHEMA_REQUIRED/);
        await assert.rejects(save(order.orderNo, { startDate: plusDays(10), endDate: plusDays(10), expectedRevision: 0 }, owner.id), /DISPATCH_ESTIMATE_SCHEMA_REQUIRED/);
        assert.equal(await auditCount(order.id), 0); assert.equal(await protectedSnapshot(order.id), before);
      } finally { await prisma.$executeRaw`ALTER TABLE qa_dispatch_estimates_temporarily_absent RENAME TO order_dispatch_estimates`; }
    });
    await test("customer route is owner-only, accepts its payment alias and returns private no-store updated DTO", async () => {
      const order = await fixture(); const saved = await save(order.orderNo, { startDate: plusDays(10), endDate: plusDays(10), expectedRevision: 0 }, owner.id);
      const buyerToken = createSessionToken(), strangerToken = createSessionToken(), expires = new Date(Date.now() + 60_000);
      await persistSessionToken(buyerToken, expires, { userId: buyer.id, role: "customer" }); await persistSessionToken(strangerToken, expires, { userId: stranger.id, role: "customer" });
      for (const orderNo of [order.orderNo, order.paymentIntents[0].merchantOrderNo]) {
        const context = { params: Promise.resolve({ orderNo }) };
        const response = await customerGet(new Request("https://store.invalid/api/account/orders/qa/dispatch-estimate", { headers: { authorization: "Bearer " + buyerToken } }), context);
        assert.equal(response.status, 200); assert.match(response.headers.get("cache-control") || "", /private, no-store/); assert.deepEqual((await response.json()).dispatchEstimate, saved.dispatchEstimate);
        const forbidden = await customerGet(new Request("https://store.invalid/api/account/orders/qa/dispatch-estimate", { headers: { authorization: "Bearer " + strangerToken } }), context);
        assert.equal(forbidden.status, 404); assert.deepEqual(await forbidden.json(), { ok: false, error: "ORDER_NOT_FOUND" });
      }
      const absent = await customerGet(new Request("https://store.invalid/api/account/orders/qa/dispatch-estimate", { headers: { authorization: "Bearer invalid" } }), { params: Promise.resolve({ orderNo: order.orderNo }) });
      assert.equal(absent.status, 401); assert.equal(await userGet(order.id, stranger.id), null); assert.equal(await auditCount(order.id), 1);
    });
    await test("a shipment committed while estimate edit waits on the order lock is rechecked and blocks the late edit", async () => {
      const order = await fixture(), lock = new Client({ connectionString: process.env.DATABASE_URL }); await lock.connect();
      let outcome: Promise<unknown> | undefined;
      try {
        await lock.query("BEGIN"); await lock.query("SELECT id FROM orders WHERE id = $1 FOR UPDATE", [order.id]);
        let finished = false;
        outcome = save(order.orderNo, { startDate: plusDays(10), endDate: plusDays(10), expectedRevision: 0 }, owner.id).then(value => { finished = true; return value; }, error => { finished = true; return error; });
        await delay(100); assert.equal(finished, false);
        await lock.query("INSERT INTO shipments (id, order_id, status, tracking_no, tracking_company, shipped_at, updated_at) VALUES ($1,$2,'SHIPPED',$3,$4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)", [randomUUID(), order.id, "QA-COMMITTED-SHIPMENT", "QA-CARRIER"]);
        await lock.query("UPDATE orders SET fulfillment_status = 'SHIPPED', updated_at = CURRENT_TIMESTAMP WHERE id = $1", [order.id]);
        await lock.query("COMMIT");
        const before = await protectedSnapshot(order.id), error = await outcome;
        assert(error instanceof Error); assert.match(error.message, /DISPATCH_ESTIMATE_ORDER_ALREADY_DISPATCHED/);
        assert.equal(await recordCount(order.id), 0); assert.equal(await auditCount(order.id), 0); assert.equal(await protectedSnapshot(order.id), before);
      } finally { await lock.query("ROLLBACK").catch(() => undefined); await lock.end(); await outcome; }
    });
    await test("estimate edit that already holds the order lock commits before a normal shipment without reverse-lock deadlock", async () => {
      const order = await fixture({ shipment: { status: "PROCESSING" } });
      await save(order.orderNo, { startDate: plusDays(10), endDate: plusDays(10), expectedRevision: 0 }, owner.id);
      const financialBefore = JSON.stringify({ payment: await prisma.paymentIntent.findMany({ where: { orderId: order.id } }), items: await prisma.orderItem.findMany({ where: { orderId: order.id } }), sku: await prisma.productSku.findUnique({ where: { id: product.skus[0].id } }) });
      const lock = new Client({ connectionString: process.env.DATABASE_URL }); await lock.connect();
      let edit: Promise<unknown> | undefined, ship: Promise<unknown> | undefined;
      try {
        const lockerPid = (await lock.query("SELECT pg_backend_pid() AS pid")).rows[0].pid as number;
        await lock.query("BEGIN"); await lock.query("SELECT order_id FROM order_dispatch_estimates WHERE order_id = $1 FOR UPDATE", [order.id]);
        edit = save(order.orderNo, { startDate: plusDays(11), endDate: plusDays(11), expectedRevision: 1 }, owner.id).catch(error => error);
        let writerPid = 0;
        for (let attempt = 0; attempt < 20; attempt++) {
          // Activity query/state are cached by this long-running observer
          // transaction even while wait_event_type changes. Refresh that
          // snapshot before observing the real QA-only lock dependency.
          await lock.query("SELECT pg_stat_clear_snapshot()");
          const rows = await lock.query("SELECT pid FROM pg_stat_activity WHERE datname = 'vk_dispatch_estimate_smoke_20261018' AND wait_event_type = 'Lock' AND query LIKE '%INSERT INTO order_dispatch_estimates%' AND $1 = ANY(pg_blocking_pids(pid))", [lockerPid]);
          if (rows.rows.length > 0) { writerPid = rows.rows[0].pid; break; }
          await delay(50);
        }
        assert(writerPid > 0, "Estimate writer should own the order lock and wait on this connection's isolated estimate row");
        let shipFinished = false;
        ship = performAdminOrderAction(order.orderNo, { action: "ship", trackingCompany: "QA-CARRIER", trackingNo: "QA-NORMAL-SHIP-" + randomUUID() }, owner.id)
          .then(value => { shipFinished = true; return value; }, error => { shipFinished = true; return error; });
        let shipmentWaitingOnWriter = false;
        for (let attempt = 0; attempt < 20; attempt++) {
          await lock.query("SELECT pg_stat_clear_snapshot()");
          const rows = await lock.query("SELECT pid FROM pg_stat_activity WHERE datname = 'vk_dispatch_estimate_smoke_20261018' AND wait_event_type = 'Lock' AND pid <> $1 AND $1 = ANY(pg_blocking_pids(pid))", [writerPid]);
          if (rows.rows.length > 0) { shipmentWaitingOnWriter = true; break; }
          await delay(50);
        }
        assert.equal(shipmentWaitingOnWriter, true, "Normal shipment must wait on the estimate writer's existing order lock");
        assert.equal(shipFinished, false);
        await lock.query("COMMIT");
        const [editResult, shipResult] = await Promise.all([edit, ship]);
        assert(!(editResult instanceof Error), String(editResult)); assert(!(shipResult instanceof Error), String(shipResult));
        assert.equal((await adminGet(order.orderNo))?.dispatchEstimate.revision, 2); assert.equal((await adminGet(order.orderNo))?.dispatchEstimate.startDate, plusDays(11));
        assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).fulfillmentStatus, "SHIPPED");
        const financialAfter = JSON.stringify({ payment: await prisma.paymentIntent.findMany({ where: { orderId: order.id } }), items: await prisma.orderItem.findMany({ where: { orderId: order.id } }), sku: await prisma.productSku.findUnique({ where: { id: product.skus[0].id } }) });
        assert.equal(financialAfter, financialBefore);
      } finally { await lock.query("ROLLBACK").catch(() => undefined); await lock.end(); await Promise.allSettled([edit, ship].filter((value): value is Promise<unknown> => !!value)); }
    });
  } finally { await prisma.$disconnect(); globalThis.fetch = originalFetch; }
}
main().catch(error => { console.error(error instanceof Error ? error.stack : "DISPATCH_ESTIMATE_QA_FAILED"); process.exitCode = 1; });

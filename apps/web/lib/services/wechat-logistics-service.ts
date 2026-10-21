import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { appConfig } from "@/lib/config";
import { getWeChatShippingOrder, resolveWeChatCarrier, weChatShippingRequest } from "@/lib/providers/wechat-shipping";
import { logisticsFingerprint, normalizeLogisticsRule, prepareLogisticsRegistration, registerLogisticsCandidate,
  type LogisticsBindingState, type LogisticsCandidate, type LogisticsRule } from "@/lib/commerce/wechat-logistics-contract";

const RULE_KEY = "wechatLogisticsRule";
const disabledRule: LogisticsRule = { enabled: false, activatedAt: null };
const featureConfig = { appId: appConfig.WECHAT_MINIPROGRAM_APP_ID, merchantId: appConfig.WECHAT_PAY_MCH_ID, baseUrl: appConfig.APP_BASE_URL };
const candidateInclude = { order: { include: { user: { include: { wechatIdentities: true } },
  items: { include: { product: { include: { images: { orderBy: { sortOrder: "asc" as const }, take: 3 } } } } },
  paymentIntents: { where: { provider: "WECHAT_PAY" as const, status: "PAID" as const } } } } } as const;
type Candidate = Prisma.ShipmentGetPayload<{ include: typeof candidateInclude }>;
type Binding = { id: string; shipmentId: string; orderId: string; buyerUserId: string; appId: string; buyerOpenId: string;
  trackingFingerprint: string; state: LogisticsBindingState; waybillToken: string | null;
  errorCode: string | null; updatedAt: Date; registeredAt: Date | null };

export async function getLogisticsRule(): Promise<LogisticsRule> {
  if (appConfig.COMMERCE_STORAGE !== "prisma") return { ...disabledRule };
  const row = await prisma.siteSetting.findUnique({ where: { key: RULE_KEY } });
  return normalizeLogisticsRule(row?.value);
}

async function storageReady() {
  const rows = await prisma.$queryRaw<Array<{ name: string | null }>>`SELECT to_regclass('public.wechat_logistics_bindings')::text AS "name"`;
  return !!rows[0]?.name;
}

// Enabling is an explicit OWNER action. The API never creates its own schema,
// changes old shipment rows, or backfills shipments from before activation.
export async function setLogisticsRule(enabled: boolean, actorUserId: string): Promise<LogisticsRule> {
  if (appConfig.COMMERCE_STORAGE !== "prisma") throw Error("WECHAT_LOGISTICS_DATABASE_REQUIRED");
  const actor = await prisma.user.findFirst({ where: { id: actorUserId, role: "OWNER", status: "ACTIVE" }, select: { id: true } });
  if (!actor) throw Error("OWNER_REQUIRED");
  if (enabled && !await storageReady()) throw Error("WECHAT_LOGISTICS_SCHEMA_REQUIRED");
  return prisma.$transaction(async tx => {
    // Serialize toggles so two enable requests retain one activation boundary.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(87432, 64016)`;
    const row = await tx.siteSetting.findUnique({ where: { key: RULE_KEY } });
    const before = normalizeLogisticsRule(row?.value);
    const rule: LogisticsRule = { enabled, activatedAt: enabled && !before.enabled ? new Date().toISOString() : before.activatedAt };
    await tx.siteSetting.upsert({ where: { key: RULE_KEY }, create: { key: RULE_KEY, value: rule }, update: { value: rule } });
    await tx.auditLog.create({ data: { actorId: actorUserId, actorType: "admin", action: "wechat.logistics.rule.updated",
      targetType: "setting", targetId: RULE_KEY, detail: { before, after: rule } } });
    return rule;
  });
}

async function readBindings(shipmentIds: string[]) {
  if (!shipmentIds.length) return [];
  // Pass an array value, not an interpolated SQL list.
  return prisma.$queryRaw<Binding[]>`SELECT id, shipment_id AS "shipmentId", order_id AS "orderId",
    buyer_user_id AS "buyerUserId", app_id AS "appId", buyer_open_id AS "buyerOpenId",
    tracking_fingerprint AS "trackingFingerprint", state, waybill_token AS "waybillToken",
    error_code AS "errorCode", updated_at AS "updatedAt", registered_at AS "registeredAt"
    FROM wechat_logistics_bindings WHERE shipment_id = ANY(${shipmentIds}::text[])`;
}

export async function getAdminOrderLogistics(orderNo: string) {
  const rule = await getLogisticsRule();
  if (appConfig.COMMERCE_STORAGE !== "prisma") return { ...rule, storageReady: false, shipments: [] };
  const order = await prisma.order.findUnique({ where: { orderNo }, include: { shipments: true,
    user: { include: { wechatIdentities: true } }, items: { include: { product: { include: { images: { orderBy: { sortOrder: "asc" }, take: 3 } } } } },
    paymentIntents: { where: { provider: "WECHAT_PAY", status: "PAID" } } } });
  if (!order) return null;
  // A disabled installation must work even before the additive migration exists.
  const ready = rule.activatedAt ? await storageReady() : false;
  const bindings = ready ? await readBindings(order.shipments.map(shipment => shipment.id)) : [];
  return { ...rule, storageReady: ready, shipments: order.shipments.map(shipment => {
    const fingerprint = shipment.trackingCompany && shipment.trackingNo ? logisticsFingerprint(shipment.trackingCompany, shipment.trackingNo) : null;
    const binding = bindings.find(row => row.shipmentId === shipment.id && row.trackingFingerprint === fingerprint && row.orderId === order.id);
    const eligibility = prepareLogisticsRegistration({ ...shipment, order } as LogisticsCandidate, rule, featureConfig);
    return { shipmentId: shipment.id, trackingCompany: shipment.trackingCompany, trackingNo: shipment.trackingNo,
      state: !rule.activatedAt ? "DISABLED" : !ready ? "SCHEMA_REQUIRED" : binding?.state ?? (rule.enabled ? "NOT_REGISTERED" : "DISABLED"),
      errorCode: binding?.errorCode ?? null, updatedAt: binding?.updatedAt ?? null, registeredAt: binding?.registeredAt ?? null,
      reason: !rule.activatedAt ? "DISABLED" : !ready ? "SCHEMA_REQUIRED" : binding ? null : eligibility.eligible ? "PENDING" : eligibility.reason };
  }) };
}

async function claim(shipment: LogisticsCandidate, prepared: Extract<ReturnType<typeof prepareLogisticsRegistration>, { eligible: true }>, rule: LogisticsRule) {
  const id = randomUUID(), activated = new Date(rule.activatedAt!);
  const claimed = await prisma.$queryRaw<Array<{ id: string }>>`INSERT INTO wechat_logistics_bindings
    (id, shipment_id, order_id, buyer_user_id, app_id, buyer_open_id, transaction_id, tracking_fingerprint,
      tracking_company, tracking_no, activation_at, state)
    SELECT ${id}, s.id, o.id, o.user_id, ${featureConfig.appId!}, ${prepared.openId}, ${prepared.transactionId}, ${prepared.fingerprint},
      ${shipment.trackingCompany!.trim()}, ${shipment.trackingNo!.trim()}, ${activated}, 'SENDING'
    FROM shipments s JOIN orders o ON o.id = s.order_id JOIN site_settings cfg ON cfg.key = ${RULE_KEY}
    WHERE s.id = ${shipment.id} AND o.id = ${shipment.orderId} AND o.user_id = ${shipment.order.userId}
      AND BTRIM(s.tracking_company) = ${shipment.trackingCompany!.trim()} AND BTRIM(s.tracking_no) = ${shipment.trackingNo!.trim()}
      AND s.status = 'SHIPPED' AND s.wechat_synced_at IS NOT NULL AND s.shipped_at >= ${activated}
      AND o.kind = 'STANDARD' AND o.source = 'MINIPROGRAM'
      AND o.status = 'CONFIRMED' AND o.payment_status = 'PAID' AND o.fulfillment_status = 'SHIPPED'
      AND cfg.value->>'enabled' = 'true' AND cfg.value->>'activatedAt' = ${rule.activatedAt}
    ON CONFLICT (shipment_id, tracking_fingerprint) DO NOTHING RETURNING id`;
  return claimed[0]?.id ?? null;
}

async function stillCurrent(shipment: LogisticsCandidate, prepared: Extract<ReturnType<typeof prepareLogisticsRegistration>, { eligible: true }>, rule: LogisticsRule) {
  const [current, liveRule] = await Promise.all([
    prisma.shipment.findUnique({ where: { id: shipment.id }, include: candidateInclude }), getLogisticsRule(),
  ]);
  if (!current || !liveRule.enabled || liveRule.activatedAt !== rule.activatedAt) return false;
  const latest = prepareLogisticsRegistration(current, liveRule, featureConfig);
  return latest.eligible && latest.fingerprint === prepared.fingerprint && latest.openId === prepared.openId && latest.transactionId === prepared.transactionId;
}

async function finish(id: string, state: LogisticsBindingState, token: string | null, errorCode: string | null) {
  const count = await prisma.$executeRaw`UPDATE wechat_logistics_bindings SET state = ${state}, waybill_token = ${token},
    error_code = ${errorCode}, registered_at = ${state === "BOUND" ? new Date() : null}, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id} AND state = 'SENDING'`;
  if (count !== 1) throw Error("WECHAT_LOGISTICS_PERSISTENCE_CONFLICT");
}

export async function syncPendingWeChatLogistics({ orderId }: { orderId?: string } = {}) {
  const rule = await getLogisticsRule();
  const report = { inspected: 0, registered: 0, failed: 0, unknown: 0, skipped: 0, disabled: !rule.enabled };
  if (!rule.enabled || !rule.activatedAt) return report;
  if (!await storageReady()) throw Error("WECHAT_LOGISTICS_SCHEMA_REQUIRED");
  // A crash can leave an accepted request without a saved token. Quarantine it;
  // neither a timer nor a second web request may automatically resend it.
  report.unknown = await prisma.$executeRaw`UPDATE wechat_logistics_bindings SET state = 'UNKNOWN',
    error_code = 'WECHAT_LOGISTICS_ACCEPTANCE_UNKNOWN', updated_at = CURRENT_TIMESTAMP
    WHERE state = 'SENDING' AND attempt_started_at < ${new Date(Date.now() - 10 * 60 * 1000)}`;
  const activated = new Date(rule.activatedAt);
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`SELECT s.id FROM shipments s JOIN orders o ON o.id = s.order_id
    WHERE (${orderId ?? null}::text IS NULL OR o.id = ${orderId ?? null})
      AND s.status = 'SHIPPED' AND s.wechat_synced_at IS NOT NULL AND s.shipped_at >= ${activated}
      AND o.kind = 'STANDARD' AND o.source = 'MINIPROGRAM'
      AND o.status = 'CONFIRMED' AND o.payment_status = 'PAID' AND o.fulfillment_status = 'SHIPPED'
      AND s.tracking_company IS NOT NULL AND s.tracking_no IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM wechat_logistics_bindings b WHERE b.shipment_id = s.id
        AND b.tracking_company = BTRIM(s.tracking_company) AND b.tracking_no = BTRIM(s.tracking_no))
    ORDER BY s.shipped_at, s.id LIMIT 50`;
  if (!ids.length) return report;
  const candidates: Candidate[] = await prisma.shipment.findMany({ where: { id: { in: ids.map(row => row.id) } }, include: candidateInclude, orderBy: [{ shippedAt: "asc" }, { id: "asc" }] });
  report.inspected = candidates.length;
  for (const shipment of candidates) {
    try {
      const outcome = await registerLogisticsCandidate(shipment, rule, featureConfig, { claim, remoteOrder: getWeChatShippingOrder,
        resolveCarrier: resolveWeChatCarrier, stillCurrent,
        follow: payload => weChatShippingRequest("/cgi-bin/express/delivery/open_msg/follow_waybill", payload), finish });
      report[outcome.outcome]++;
    } catch {
      // Do not log a token, phone, raw URL/access_token or provider response. A
      // claimed request remains SENDING and will become UNKNOWN without retry.
      report.failed++;
    }
  }
  return report;
}

type UserLogistics = { available: false; reason: string } | { available: true; waybillToken: string; status: number | null };
const traceCache = new Map<string, { expiresAt: number; request: Promise<{ status: number | null; mismatch: boolean }> }>();
async function readTrace(binding: Binding, trackingNo: string) {
  const key = binding.id;
  const cached = traceCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.request;
  if (traceCache.size >= 500) traceCache.clear();
  const request = (async () => {
    try {
      const response = await weChatShippingRequest("/cgi-bin/express/delivery/open_msg/query_follow_trace", { waybill_token: binding.waybillToken, openid: binding.buyerOpenId });
      const info = response.waybill_info as { waybill_id?: unknown; status?: unknown } | undefined;
      if (typeof info?.waybill_id === "string" && info.waybill_id !== trackingNo) return { status: null, mismatch: true };
      return { status: Number.isInteger(info?.status) && Number(info?.status) >= 0 && Number(info?.status) <= 6 ? Number(info?.status) : null, mismatch: false };
    } catch { return { status: null, mismatch: false }; }
  })();
  traceCache.set(key, { request, expiresAt: Date.now() + 30_000 });
  return request;
}

// This read never registers a waybill or updates the order's delivery status.
// The route resolves the authenticated order first; repeat ownership here so
// future callers cannot turn an order number into another buyer's token.
export async function getUserOrderLogistics(orderId: string, userId: string): Promise<UserLogistics> {
  const rule = await getLogisticsRule();
  if (!rule.activatedAt) return { available: false, reason: "DISABLED" };
  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, include: { user: { include: { wechatIdentities: true } },
    shipments: { orderBy: [{ shippedAt: "desc" }, { createdAt: "desc" }] } } });
  if (!order) return { available: false, reason: "ORDER_NOT_FOUND" };
  if (order.kind !== "STANDARD" || order.source !== "MINIPROGRAM") return { available: false, reason: "UNSUPPORTED_ORDER" };
  const shipment = order.shipments[0];
  if (!shipment?.trackingCompany || !shipment.trackingNo) return { available: false, reason: "NOT_SHIPPED" };
  if (!await storageReady()) return { available: false, reason: "SCHEMA_REQUIRED" };
  const identity = order.user.wechatIdentities.find(item => item.appId === featureConfig.appId);
  const fingerprint = logisticsFingerprint(shipment.trackingCompany, shipment.trackingNo);
  const bindings = await readBindings([shipment.id]);
  const binding = bindings.find(row => row.orderId === order.id && row.buyerUserId === userId && row.appId === featureConfig.appId &&
    row.buyerOpenId === identity?.openId && row.trackingFingerprint === fingerprint);
  if (!binding) {
    // First reads stay read-only. Report the known blocker without claiming a
    // token exists, promising a successful registration, or sending a message.
    if (!rule.enabled) return { available: false, reason: "DISABLED" };
    if (!shipment.shippedAt || shipment.shippedAt.getTime() < Date.parse(rule.activatedAt)) return { available: false, reason: "BEFORE_ACTIVATION" };
    if (!shipment.wechatSyncedAt) return { available: false, reason: "SHIPPING_SYNC_PENDING" };
    return { available: false, reason: "NOT_REGISTERED" };
  }
  if (binding.state !== "BOUND" || !binding.waybillToken) return { available: false, reason: binding.state };
  const trace = await readTrace(binding, shipment.trackingNo.trim());
  if (trace.mismatch) return { available: false, reason: "TRACKING_MISMATCH" };
  // The read-only gateway call can take several seconds. Do not return the old
  // token if staff corrected the tracking number while that query was running.
  const unchanged = await prisma.shipment.findFirst({ where: { id: shipment.id, orderId: order.id,
    trackingNo: shipment.trackingNo, trackingCompany: shipment.trackingCompany, order: { userId } }, select: { id: true } });
  if (!unchanged) return { available: false, reason: "TRACKING_CHANGED" };
  return { available: true, waybillToken: binding.waybillToken, status: trace.status };
}

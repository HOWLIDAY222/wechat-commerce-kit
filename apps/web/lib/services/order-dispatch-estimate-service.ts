import { prisma } from "@/lib/db/prisma";
import { appConfig } from "@/lib/config";
import { beijingCalendarDate, dispatchEstimateDto, dispatchEstimateEditBlocker, parseDispatchEstimateInput,
  type DispatchEstimateInput, type DispatchEstimateRecord } from "@/lib/commerce/order-dispatch-estimate";
import type { Prisma } from "@prisma/client";

const orderInclude = { shipments: { select: { status: true, trackingNo: true, trackingCompany: true, shippedAt: true, deliveredAt: true } },
  refunds: { select: { refundStatus: true, refundAmountCents: true } } } as const;
type Reader = Pick<Prisma.TransactionClient, "$queryRaw">;

async function storageReady() {
  const rows = await prisma.$queryRaw<Array<{ name: string | null }>>`SELECT to_regclass('public.order_dispatch_estimates')::text AS name`;
  return !!rows[0]?.name;
}
async function readEstimate(orderId: string, reader: Reader = prisma) {
  const rows = await reader.$queryRaw<DispatchEstimateRecord[]>`SELECT to_char(start_date, 'YYYY-MM-DD') AS "startDate", to_char(end_date, 'YYYY-MM-DD') AS "endDate",
    revision, updated_at AS "updatedAt" FROM order_dispatch_estimates WHERE order_id = ${orderId}`;
  return rows[0] ?? null;
}

export async function getAdminOrderDispatchEstimate(orderNo: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") throw Error("DISPATCH_ESTIMATE_DATABASE_REQUIRED");
  const order = await prisma.order.findUnique({ where: { orderNo }, include: orderInclude });
  if (!order) return null;
  if (!await storageReady()) throw Error("DISPATCH_ESTIMATE_SCHEMA_REQUIRED");
  const reason = dispatchEstimateEditBlocker(order);
  return { dispatchEstimate: dispatchEstimateDto(await readEstimate(order.id)), editable: reason === null, reason };
}

export async function getUserOrderDispatchEstimate(orderId: string, userId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") throw Error("DISPATCH_ESTIMATE_DATABASE_REQUIRED");
  // Resolve again by owner even when a route has already looked up the order.
  const order = await prisma.order.findFirst({ where: { id: orderId, userId }, select: { id: true } });
  if (!order) return null;
  if (!await storageReady()) throw Error("DISPATCH_ESTIMATE_SCHEMA_REQUIRED");
  return dispatchEstimateDto(await readEstimate(order.id));
}

export async function setOrderDispatchEstimate(orderNo: string, input: DispatchEstimateInput, actorUserId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") throw Error("DISPATCH_ESTIMATE_DATABASE_REQUIRED");
  const parsed = parseDispatchEstimateInput(input);
  if (!parsed) throw Error("INVALID_DISPATCH_ESTIMATE");
  const actor = await prisma.user.findFirst({ where: { id: actorUserId, status: "ACTIVE", role: { in: ["ADMIN", "OWNER"] } }, select: { id: true } });
  if (!actor) throw Error("ADMIN_REQUIRED");
  if (!await storageReady()) throw Error("DISPATCH_ESTIMATE_SCHEMA_REQUIRED");
  return prisma.$transaction(async tx => {
    // Lock only the existing order row, never update it. Shipment reads below
    // take no row lock, so the existing shipment -> order update sequence has
    // no inverse lock dependency. A committed shipment is rechecked here.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM orders WHERE order_no = ${orderNo} FOR UPDATE`;
    if (!locked.length) throw Error("ORDER_NOT_FOUND");
    const order = await tx.order.findUnique({ where: { id: locked[0].id }, include: orderInclude });
    if (!order) throw Error("ORDER_NOT_FOUND");
    const blocker = dispatchEstimateEditBlocker(order);
    if (blocker) throw Error(blocker);
    if (parsed.endDate !== null && parsed.endDate < beijingCalendarDate()) throw Error("DISPATCH_ESTIMATE_DATE_IN_PAST");
    const before = await readEstimate(order.id, tx);
    if ((before?.revision ?? 0) !== parsed.expectedRevision) throw Error("DISPATCH_ESTIMATE_REVISION_CONFLICT");
    const revision = (before?.revision ?? 0) + 1;
    const rows = await tx.$queryRaw<DispatchEstimateRecord[]>`INSERT INTO order_dispatch_estimates
      (order_id, start_date, end_date, revision, updated_by) VALUES (${order.id}, ${parsed.startDate}::date, ${parsed.endDate}::date, ${revision}, ${actorUserId})
      ON CONFLICT (order_id) DO UPDATE SET start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date, revision = EXCLUDED.revision,
        updated_by = EXCLUDED.updated_by, updated_at = CURRENT_TIMESTAMP
      RETURNING to_char(start_date, 'YYYY-MM-DD') AS "startDate", to_char(end_date, 'YYYY-MM-DD') AS "endDate", revision, updated_at AS "updatedAt"`;
    const after = rows[0];
    if (!after) throw Error("DISPATCH_ESTIMATE_SAVE_FAILED");
    await tx.auditLog.create({ data: { actorId: actorUserId, actorType: "admin", action: "order.dispatch_estimate.updated",
      targetType: "order", targetId: order.id, detail: { before: { startDate: before?.startDate ?? null, endDate: before?.endDate ?? null, revision: before?.revision ?? 0 }, after: { startDate: after.startDate, endDate: after.endDate, revision: after.revision } } } });
    return { dispatchEstimate: dispatchEstimateDto(after), editable: true, reason: null };
  }, { maxWait: 5_000, timeout: 10_000 });
}

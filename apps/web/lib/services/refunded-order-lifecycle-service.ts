import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { isRetryableRefundTransaction, planRefundLifecycle } from "@/lib/commerce/refunded-order-lifecycle";

type Context = { source: "VERIFIED_REFUND" | "AFTER_SALES_TRANSITION"; actorId?: string };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
async function releaseProvenReservations(tx: Prisma.TransactionClient, order: { id: string; orderNo: string; kind: string; items: Array<{ skuId: string; quantity: number }> }, actorId?: string) {
  if (order.kind !== "STANDARD") return;
  const quantities = new Map<string, number>();
  for (const item of order.items) quantities.set(item.skuId, (quantities.get(item.skuId) ?? 0) + item.quantity);
  for (const [skuId, quantity] of [...quantities].sort(([a], [b]) => a.localeCompare(b))) {
    const note = `Refund closed order ${order.orderNo}`;
    const logs = await tx.inventoryLog.findMany({ where: { skuId, OR: [{ action: "RESERVE", note: `Order ${order.orderNo}` }, { action: "DEDUCT", note: `Paid order ${order.orderNo}` }, { action: "RELEASE", note: { in: [`Cancel order ${order.orderNo}`, note] } }] }, select: { action: true, quantity: true } });
    const sum = (action: string) => logs.filter(log => log.action === action).reduce((total, log) => total + log.quantity, 0);
    const remaining = sum("RESERVE") - sum("DEDUCT") - sum("RELEASE");
    if (!Number.isSafeInteger(remaining) || remaining < 0 || remaining > quantity) throw Error("REFUND_INVENTORY_EVIDENCE_INVALID");
    if (!remaining) continue;
    const updated = await tx.productSku.updateMany({ where: { id: skuId, reservedQuantity: { gte: remaining } }, data: { reservedQuantity: { decrement: remaining } } });
    if (updated.count !== 1) throw Error("REFUND_INVENTORY_RESERVATION_INVALID");
    await tx.inventoryLog.create({ data: { id: "refund-release-" + hash(order.id + ":" + skuId), skuId, action: "RELEASE", quantity: remaining, note, actorId } });
  }
}

export async function reconcileRefundedOrderLifecycle(orderId: string, context: Context) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
        const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true, shipments: true, refunds: true, afterSalesRequests: { include: { refunds: true } } } });
        const plan = planRefundLifecycle(order);
        if (plan.closeOrder && !plan.shipped && !["CLOSED", "CANCELLED"].includes(order.status)) await releaseProvenReservations(tx, order, context.actorId);
        for (const id of plan.completeIds) {
          const changed = await tx.afterSalesRequest.updateMany({ where: { id, status: { notIn: ["COMPLETED", "REJECTED", "CANCELLED"] } }, data: { status: "COMPLETED", completedAt: new Date() } });
          if (!changed.count) continue;
          await tx.afterSalesMessage.create({ data: { afterSalesId: id, senderType: "SYSTEM", senderId: "system", message: "退款及所需退货已确认，售后已结束。" } });
          await tx.auditLog.create({ data: { actorId: context.actorId, actorType: context.actorId ? "admin" : "system", action: "after_sales.status.completed", targetType: "after_sales_request", targetId: id, detail: { orderId, source: context.source, wholeOrderRefunded: plan.full } } });
        }
        if (plan.closeOrder && !["CLOSED", "CANCELLED"].includes(order.status)) {
          await tx.order.update({ where: { id: orderId }, data: { status: "CLOSED" } });
          await tx.auditLog.create({ data: { actorId: context.actorId, actorType: context.actorId ? "admin" : "system", action: "order.refund.closed", targetType: "order", targetId: orderId, detail: { source: context.source, shipped: plan.shipped } } });
        }
        return { ...plan, deferred: false };
      }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 30_000 });
    } catch (error) {
      if (attempt >= 3 || !isRetryableRefundTransaction(error)) throw error;
      await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
}

// Financial settlement and receipt confirmation commit first. A stock anomaly
// must never undo a real refund; a later verified sweep retries this work.
export async function tryReconcileRefundedOrderLifecycle(orderId: string, context: Context) {
  try { return await reconcileRefundedOrderLifecycle(orderId, context); }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    const code = /^[A-Z][A-Z0-9_]{1,110}$/.test(message) ? message : "REFUND_LIFECYCLE_RETRY_REQUIRED";
    console.error("order.refund.lifecycle.deferred", { orderId, code });
    try { await prisma.auditLog.upsert({ where: { id: "refund-lifecycle-deferred-" + hash(orderId + ":" + code) }, create: { id: "refund-lifecycle-deferred-" + hash(orderId + ":" + code), actorType: "system", action: "order.refund.lifecycle_deferred", targetType: "order", targetId: orderId, detail: { source: context.source, code } }, update: {} }); } catch { /* Keep the committed payment or receipt even if diagnostics cannot persist. */ }
    return { deferred: true as const, code };
  }
}

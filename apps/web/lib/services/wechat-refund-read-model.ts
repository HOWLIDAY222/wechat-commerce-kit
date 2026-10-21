import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

type Reader = Pick<Prisma.TransactionClient, "order" | "refund" | "paymentNotification" | "afterSalesRequest">;
export type OrderRefundSummary = {
  paidAmountCents: number;
  succeededAmountCents: number;
  processingAmountCents: number;
  requestedAmountCents: number;
  unlinkedSucceededCents: number;
  unlinkedProcessingCents: number;
  succeededCount: number;
  processingCount: number;
  state: "NONE" | "REQUESTED" | "PROCESSING" | "PARTIAL" | "REFUNDED";
  fullyRefunded: boolean;
  partiallyRefunded: boolean;
  requiresAfterSalesReview: boolean;
  lastVerifiedAt: string | null;
};

export async function getOrderRefundSummaryByOrderNo(orderNo: string, reader: Reader = prisma): Promise<OrderRefundSummary | null> {
  const order = await reader.order.findUnique({ where: { orderNo }, select: { id: true } });
  return order ? getOrderRefundSummary(order.id, reader) : null;
}

// This is a read model only. Callers retain their existing order/session access
// checks; neither missing history nor an unlinked refund changes a sale here.
export async function getOrderRefundSummary(orderId: string, reader: Reader = prisma): Promise<OrderRefundSummary> {
  const [order, refunds, latest, openAfterSales] = await Promise.all([
    reader.order.findUniqueOrThrow({ where: { id: orderId }, select: { payableAmountCents: true } }),
    reader.refund.findMany({ where: { orderId }, select: { refundAmountCents: true, refundStatus: true, afterSalesId: true } }),
    reader.paymentNotification.findFirst({ where: { orderId, verified: true, processedAt: { not: null }, status: { startsWith: "REFUND." } }, orderBy: { processedAt: "desc" }, select: { processedAt: true } }),
    reader.afterSalesRequest.count({ where: { orderId, type: { in: ["RETURN_REFUND", "REFUND_ONLY", "QUALITY_ISSUE"] }, status: { notIn: ["CANCELLED", "REJECTED", "REFUNDED", "COMPLETED"] } } }),
  ]);
  const succeeded = refunds.filter(refund => refund.refundStatus === "SUCCEEDED"), processing = refunds.filter(refund => refund.refundStatus === "PROCESSING");
  const sum = (rows: typeof refunds) => rows.reduce((total, refund) => total + refund.refundAmountCents, 0);
  const succeededAmountCents = sum(succeeded), processingAmountCents = sum(processing);
  const requestedAmountCents = sum(refunds.filter(refund => ["CREATED", "MANUAL_MARKED"].includes(refund.refundStatus)));
  const unlinkedSucceededCents = sum(succeeded.filter(refund => !refund.afterSalesId));
  const unlinkedProcessingCents = sum(processing.filter(refund => !refund.afterSalesId));
  const fullyRefunded = order.payableAmountCents > 0 && succeededAmountCents >= order.payableAmountCents;
  const partiallyRefunded = succeededAmountCents > 0 && !fullyRefunded;
  const state: OrderRefundSummary["state"] = fullyRefunded ? "REFUNDED" : partiallyRefunded ? "PARTIAL" : processingAmountCents > 0 ? "PROCESSING" : requestedAmountCents > 0 ? "REQUESTED" : "NONE";
  return { paidAmountCents: order.payableAmountCents, succeededAmountCents, processingAmountCents, requestedAmountCents, unlinkedSucceededCents, unlinkedProcessingCents, succeededCount: succeeded.length, processingCount: processing.length, state, fullyRefunded, partiallyRefunded, requiresAfterSalesReview: (unlinkedSucceededCents > 0 || unlinkedProcessingCents > 0) && openAfterSales > 0, lastVerifiedAt: latest?.processedAt?.toISOString() ?? null };
}

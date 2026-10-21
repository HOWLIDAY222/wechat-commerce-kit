type ReturnObligation = { type: string; status: string; receivedAt: Date | string | null; returnAddress?: string | null; returnTrackingNo?: string | null };
type LifecycleRequest = ReturnObligation & { id: string; refundAmountCents: number; refunds: Array<{ refundStatus: string; refundAmountCents: number }> };
type ShippingEvidence = { fulfillmentStatus: string; shipments: Array<{ status: string; trackingNo?: string | null; shippedAt?: Date | string | null; deliveredAt?: Date | string | null }> };
function errorRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function isRetryableRefundTransaction(error: unknown) {
  const item = errorRecord(error);
  if (!item) return false;
  if (item.code === "P2034") return true;
  const retryCode = (code: unknown) => code === "40001" || code === "40P01";
  if (item.code !== "P2010") return retryCode(item.code) && item.severity === "ERROR";
  const meta = errorRecord(item.meta);
  if (!meta) return false;
  if (typeof meta.code === "string") return retryCode(meta.code);
  const adapter = errorRecord(meta.driverAdapterError), cause = errorRecord(adapter?.cause);
  return adapter?.name === "DriverAdapterError" && !!cause
    && (cause.kind === "postgres" || cause.kind === "TransactionWriteConflict")
    && retryCode(cause.originalCode) && (cause.code === undefined || cause.code === cause.originalCode);
}
export function hasActualShipment(order: ShippingEvidence) {
  return ["SHIPPED", "DELIVERED", "RETURNED"].includes(order.fulfillmentStatus)
    || order.shipments.some(shipment => ["SHIPPED", "DELIVERED", "RETURNED"].includes(shipment.status) || !!shipment.trackingNo?.trim() || !!shipment.shippedAt || !!shipment.deliveredAt);
}
export function requiresReturnReceipt(request: ReturnObligation, shipped: boolean) {
  if (!shipped) return false;
  if (request.type === "RETURN_REFUND") return true;
  return request.type === "QUALITY_ISSUE" && (!!request.returnAddress?.trim() || !!request.returnTrackingNo?.trim() || !!request.receivedAt
    || ["WAITING_RETURN", "RETURN_IN_TRANSIT", "RECEIVED", "INSPECTING"].includes(request.status));
}
export function planRefundLifecycle(order: ShippingEvidence & { payableAmountCents: number; refunds: Array<{ refundStatus: string; refundAmountCents: number }>; afterSalesRequests: LifecycleRequest[] }) {
  const shipped = hasActualShipment(order);
  const full = order.payableAmountCents > 0 && order.refunds.filter(refund => refund.refundStatus === "SUCCEEDED").reduce((sum, refund) => sum + refund.refundAmountCents, 0) >= order.payableAmountCents;
  const refundable = order.afterSalesRequests.filter(request => ["RETURN_REFUND", "REFUND_ONLY", "QUALITY_ISSUE"].includes(request.type) && !["CANCELLED", "REJECTED"].includes(request.status));
  const received = (request: LifecycleRequest) => !requiresReturnReceipt(request, shipped) || !!request.receivedAt;
  const covered = (request: LifecycleRequest) => full || request.refundAmountCents > 0 && request.refunds.filter(refund => refund.refundStatus === "SUCCEEDED").reduce((sum, refund) => sum + refund.refundAmountCents, 0) >= request.refundAmountCents;
  const completeIds = refundable.filter(request => request.status !== "COMPLETED" && received(request) && covered(request)).map(request => request.id);
  const otherOpen = order.afterSalesRequests.some(request => !["RETURN_REFUND", "REFUND_ONLY", "QUALITY_ISSUE"].includes(request.type) && !["CANCELLED", "REJECTED", "COMPLETED"].includes(request.status));
  // A legacy COMPLETED status never substitutes for a return receipt. A shipped
  // order without any refund resolution also has no evidence of waived returns.
  const closeOrder = full && !otherOpen && (!shipped || refundable.length > 0 && refundable.every(received));
  return { full, shipped, completeIds, closeOrder };
}

export const afterSalesStatuses = [
  "submitted",
  "reviewing",
  "approved",
  "rejected",
  "waiting_return",
  "return_in_transit",
  "received",
  "inspecting",
  "refund_processing",
  "refunded",
  "exchange_shipping",
  "reshipped",
  "completed",
  "cancelled",
] as const;

export type AfterSalesStatus = (typeof afterSalesStatuses)[number];

export const afterSalesTypes = [
  "return_refund",
  "exchange",
  "refund_only",
  "reship",
  "quality_issue",
] as const;

export type AfterSalesType = (typeof afterSalesTypes)[number];

const commonTransitions: Record<AfterSalesStatus, AfterSalesStatus[]> = {
  submitted: ["reviewing", "cancelled"],
  reviewing: ["approved", "rejected"],
  approved: [],
  rejected: [],
  waiting_return: ["return_in_transit", "cancelled"],
  return_in_transit: ["received"],
  received: ["inspecting"],
  inspecting: [],
  refund_processing: [],
  refunded: ["completed"],
  exchange_shipping: ["completed"],
  reshipped: ["completed"],
  completed: [],
  cancelled: [],
};

const resolutionTransitions: Record<AfterSalesType, Partial<Record<AfterSalesStatus, AfterSalesStatus[]>>> = {
  return_refund: {
    approved: ["waiting_return"],
    inspecting: ["refund_processing"],
    refunded: ["received", "completed"],
  },
  exchange: {
    approved: ["waiting_return"],
    inspecting: ["exchange_shipping"],
  },
  refund_only: {
    approved: ["refund_processing"],
  },
  reship: {
    approved: ["reshipped"],
  },
  quality_issue: {
    approved: ["waiting_return", "refund_processing", "exchange_shipping", "reshipped"],
    inspecting: ["refund_processing", "exchange_shipping", "reshipped"],
    refunded: ["received", "completed"],
  },
};

export function getAfterSalesNextStatuses(from: AfterSalesStatus, type: AfterSalesType) {
  return resolutionTransitions[type][from] ?? commonTransitions[from] ?? [];
}

export function canTransitionAfterSales(from: AfterSalesStatus, to: AfterSalesStatus, type: AfterSalesType) {
  return getAfterSalesNextStatuses(from, type).includes(to);
}

export function assertAfterSalesTransition(from: AfterSalesStatus, to: AfterSalesStatus, type: AfterSalesType) {
  if (!canTransitionAfterSales(from, to, type)) {
    throw new Error(`AFTER_SALES_INVALID_TRANSITION:${type}:${from}->${to}`);
  }
}

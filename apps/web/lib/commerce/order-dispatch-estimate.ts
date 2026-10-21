export type DispatchEstimate = {
  status: "UNSET" | "SCHEDULED" | "OVERDUE";
  startDate: string | null;
  endDate: string | null;
  timeZone: "Asia/Shanghai";
  label: string;
  updatedAt: string | null;
  revision: number;
};
export type DispatchEstimateInput = { startDate: string | null; endDate: string | null; expectedRevision: number };
export type DispatchEstimateRecord = { startDate: string | null; endDate: string | null; updatedAt: Date; revision: number };
export type DispatchEstimateOrder = {
  kind: string; status: string; paymentStatus: string; fulfillmentStatus: string; payableAmountCents: number;
  shipments: Array<{ status: string; trackingNo: string | null; trackingCompany: string | null; shippedAt: Date | null; deliveredAt: Date | null }>;
  refunds: Array<{ refundStatus: string; refundAmountCents: number }>;
};

export function isDispatchDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function beijingCalendarDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Shanghai", calendar: "gregory", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part("year").padStart(4, "0")}-${part("month")}-${part("day")}`;
}

export function parseDispatchEstimateInput(value: unknown): DispatchEstimateInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).length !== 3 || !Object.hasOwn(input, "startDate") || !Object.hasOwn(input, "endDate") || !Object.hasOwn(input, "expectedRevision")) return null;
  if ((input.startDate === null) !== (input.endDate === null)) return null;
  if (input.startDate !== null && (!isDispatchDate(input.startDate) || !isDispatchDate(input.endDate) || input.startDate > input.endDate)) return null;
  if (typeof input.expectedRevision !== "number" || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision > 2147483646) return null;
  return { startDate: input.startDate as string | null, endDate: input.endDate as string | null, expectedRevision: input.expectedRevision };
}

export function dispatchEstimateDto(record: DispatchEstimateRecord | null, now = new Date()): DispatchEstimate {
  const startDate = record?.startDate ?? null, endDate = record?.endDate ?? null;
  const status = endDate === null ? "UNSET" : endDate < beijingCalendarDate(now) ? "OVERDUE" : "SCHEDULED";
  const format = (date: string) => { const [year, month, day] = date.split("-"); return `${year}年${Number(month)}月${Number(day)}日`; };
  return { status, startDate, endDate, timeZone: "Asia/Shanghai", revision: record?.revision ?? 0, updatedAt: record?.updatedAt.toISOString() ?? null,
    // Both endpoints are Beijing calendar dates, inclusive through the end of
    // endDate. Never substitute a product's current sale/dispatch window.
    label: status === "UNSET" ? "预计发货日期待安排" : `预计发货日期 ${format(startDate!)}-${format(endDate!)}` };
}

export function dispatchEstimateEditBlocker(order: DispatchEstimateOrder): string | null {
  if (order.kind === "GIFT_PURCHASE") return "DISPATCH_ESTIMATE_DIGITAL_GIFT_UNSUPPORTED";
  if (!["STANDARD", "GIFT_REDEMPTION"].includes(order.kind)) return "DISPATCH_ESTIMATE_ORDER_KIND_UNSUPPORTED";
  if (order.status !== "CONFIRMED") return "DISPATCH_ESTIMATE_ORDER_NOT_CONFIRMED";
  const refunded = order.refunds.filter(item => item.refundStatus === "SUCCEEDED").reduce((sum, item) => sum + item.refundAmountCents, 0);
  if (order.paymentStatus === "REFUNDED" || order.payableAmountCents > 0 && refunded >= order.payableAmountCents) return "DISPATCH_ESTIMATE_ORDER_REFUNDED";
  if (order.paymentStatus !== "PAID") return "DISPATCH_ESTIMATE_ORDER_NOT_PAID";
  if (!["PENDING", "PROCESSING"].includes(order.fulfillmentStatus)) return "DISPATCH_ESTIMATE_ORDER_ALREADY_DISPATCHED";
  if (order.shipments.some(item => item.trackingNo?.trim() || item.trackingCompany?.trim() || item.shippedAt || item.deliveredAt || ["SHIPPED", "DELIVERED", "RETURNED"].includes(item.status))) return "DISPATCH_ESTIMATE_SHIPMENT_EXISTS";
  return null;
}

// The existing admin proxy preserves Host while the app itself receives HTTP.
// Compare hosts rather than schemes; never trust an arbitrary forwarded host.
export function hasSameHostDispatchEstimateOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const parsed = new URL(origin), host = request.headers.get("host");
    return !!host && ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password &&
      parsed.pathname === "/" && !parsed.search && !parsed.hash && parsed.host.toLowerCase() === host.toLowerCase();
  } catch { return false; }
}

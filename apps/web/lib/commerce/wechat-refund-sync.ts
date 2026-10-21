import { createHash } from "node:crypto";

export type LocalRefundStatus = "CREATED" | "MANUAL_MARKED" | "PROCESSING" | "SUCCEEDED" | "FAILED";
export type WeChatRefundObservation = {
  outRefundNo: string;
  providerRefundId: string;
  merchantOrderNo: string;
  transactionId: string;
  refundAmountCents: number;
  totalAmountCents: number;
  currency: "CNY";
  status: "PROCESSING" | "SUCCEEDED" | "FAILED";
};
type RefundResource = {
  out_refund_no: string;
  refund_id: string;
  out_trade_no?: string;
  transaction_id?: string;
  refund_status: string;
  amount: { refund: number; total: number; currency?: string };
};
function identifier(value: unknown, required = true) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 256 || /[\u0000-\u001f\u007f]/.test(value)) throw Error("WECHAT_PAY_REFUND_IDENTITY_INVALID");
  return value;
}
export function normalizeVerifiedRefund(resource: RefundResource): WeChatRefundObservation {
  const statuses: Record<string, WeChatRefundObservation["status"]> = { SUCCESS: "SUCCEEDED", PROCESSING: "PROCESSING", CLOSED: "FAILED", ABNORMAL: "FAILED", CHANGE: "FAILED", FAIL: "FAILED" };
  const status = Object.hasOwn(statuses, resource.refund_status) ? statuses[resource.refund_status] : undefined;
  if (!status) throw Error("WECHAT_PAY_REFUND_STATUS_INVALID");
  if (resource.amount.currency !== undefined && resource.amount.currency !== "CNY") throw Error("WECHAT_PAY_CURRENCY_MISMATCH");
  if (!Number.isSafeInteger(resource.amount.refund) || !Number.isSafeInteger(resource.amount.total) || resource.amount.refund <= 0 || resource.amount.total <= 0 || resource.amount.refund > resource.amount.total || resource.amount.total > 2_000_000_000) throw Error("WECHAT_PAY_REFUND_AMOUNT_INVALID");
  return { outRefundNo: identifier(resource.out_refund_no), providerRefundId: identifier(resource.refund_id), merchantOrderNo: identifier(resource.out_trade_no, false), transactionId: identifier(resource.transaction_id, false), refundAmountCents: resource.amount.refund, totalAmountCents: resource.amount.total, currency: "CNY", status };
}
export function refundObservationFingerprint(observation: WeChatRefundObservation) {
  return createHash("sha256").update(JSON.stringify(observation)).digest("hex");
}
export function nextObservedRefundStatus(current: LocalRefundStatus, observed: WeChatRefundObservation["status"]) {
  return current === "SUCCEEDED" ? "SUCCEEDED" : observed;
}
export function assertRefundPaymentIdentity(payment: { provider: string; status: string; merchantOrderNo: string; gatewayTradeNo: string | null; amountCents: number; currency: string }, observation: WeChatRefundObservation) {
  if (payment.provider !== "WECHAT_PAY" || payment.status !== "PAID") throw Error("WECHAT_PAID_PAYMENT_NOT_FOUND");
  if (payment.currency !== "CNY" || observation.currency !== "CNY") throw Error("WECHAT_PAY_CURRENCY_MISMATCH");
  if (observation.merchantOrderNo && payment.merchantOrderNo !== observation.merchantOrderNo) throw Error("WECHAT_PAY_ORDER_NO_MISMATCH");
  if (observation.transactionId && (!payment.gatewayTradeNo || payment.gatewayTradeNo !== observation.transactionId)) throw Error("WECHAT_PAY_TRANSACTION_ID_MISMATCH");
  if (payment.amountCents !== observation.totalAmountCents) throw Error("WECHAT_PAY_REFUND_AMOUNT_MISMATCH");
}

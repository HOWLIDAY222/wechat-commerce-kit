import { createHash } from "node:crypto";

export type LogisticsRule = { enabled: boolean; activatedAt: string | null };
export type LogisticsBindingState = "SENDING" | "BOUND" | "FAILED" | "UNKNOWN";
export type LogisticsConfig = { appId?: string; merchantId?: string; baseUrl: string };
export type LogisticsCandidate = {
  id: string; orderId: string; status: string; trackingCompany: string | null; trackingNo: string | null;
  shippedAt: Date | null; wechatSyncedAt: Date | null;
  order: {
    id: string; orderNo: string; userId: string; kind: string; source: string | null; status: string;
    paymentStatus: string; fulfillmentStatus: string; createdAt: Date; customerPhone: string;
    payableAmountCents: number; currency: string;
    user: { wechatIdentities: Array<{ appId: string; openId: string }> };
    items: Array<{ productName: string; color: string; size: string; quantity: number; image?: string | null;
      product?: { image: string | null; images?: Array<{ imageUrl: string }> } }>;
    paymentIntents: Array<{ provider: string; status: string; amountCents: number; currency: string;
      gatewayTradeNo: string | null; merchantOrderNo: string; rawResponse: unknown }>;
  };
};
export type FollowWaybillPayload = {
  openid: string; receiver_phone: string; waybill_id: string; trans_id: string; order_detail_path: string;
  goods_info: { detail_list: Array<{ goods_name: string; goods_img_url: string; goods_desc?: string }> };
  delivery_id?: string;
};
export type PreparedLogistics = {
  eligible: true; fingerprint: string; openId: string; transactionId: string; merchantOrderNo: string;
  payload: FollowWaybillPayload;
} | { eligible: false; reason: string };

export function normalizeLogisticsRule(value: unknown): LogisticsRule {
  const input = record(value);
  const activatedAt = typeof input.activatedAt === "string" && Number.isFinite(Date.parse(input.activatedAt))
    ? new Date(input.activatedAt).toISOString() : null;
  return { enabled: input.enabled === true && activatedAt !== null, activatedAt };
}

export function logisticsFingerprint(company: string, trackingNo: string) {
  return createHash("sha256").update(JSON.stringify([company.trim(), trackingNo.trim()])).digest("hex");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function httpsImage(raw: string | null | undefined, baseUrl: string) {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim(), baseUrl);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function boundedText(value: string, length: number) {
  return Array.from(value.replace(/[\u0000-\u001f\u007f]/g, " ").trim()).slice(0, length).join("");
}

// The first physical shipment must occur after activation; the purchase may
// already exist. Historic shipments are not enrolled or inferred from reads.
export function prepareLogisticsRegistration(shipment: LogisticsCandidate, rule: LogisticsRule, config: LogisticsConfig): PreparedLogistics {
  const reject = (reason: string): PreparedLogistics => ({ eligible: false, reason });
  if (!rule.enabled || !rule.activatedAt) return reject("DISABLED");
  const activatedAt = Date.parse(rule.activatedAt), order = shipment.order;
  if (!Number.isFinite(activatedAt) || !shipment.shippedAt || shipment.shippedAt.getTime() < activatedAt) return reject("BEFORE_ACTIVATION");
  if (order.kind !== "STANDARD") return reject("GIFT_ORDER_UNSUPPORTED");
  if (order.source !== "MINIPROGRAM") return reject("MINIPROGRAM_PURCHASE_REQUIRED");
  if (order.status !== "CONFIRMED" || order.paymentStatus !== "PAID" || order.fulfillmentStatus !== "SHIPPED" || shipment.status !== "SHIPPED") return reject("PAID_SHIPPED_ORDER_REQUIRED");
  if (!shipment.wechatSyncedAt) return reject("SHIPPING_SYNC_PENDING");
  if (!config.appId || !config.merchantId) return reject("WECHAT_CONFIGURATION_REQUIRED");
  const identity = order.user.wechatIdentities.find(item => item.appId === config.appId);
  if (!identity?.openId) return reject("BUYER_IDENTITY_MISSING");
  const payments = order.paymentIntents.filter(payment => payment.provider === "WECHAT_PAY" && payment.status === "PAID");
  if (payments.length !== 1 || !payments[0].gatewayTradeNo) return reject("PAID_TRANSACTION_REQUIRED");
  const payment = payments[0], transaction = record(payment.rawResponse), amount = record(transaction.amount), payer = record(transaction.payer);
  if (transaction.appid !== config.appId || transaction.mchid !== config.merchantId || transaction.trade_state !== "SUCCESS" ||
    transaction.transaction_id !== payment.gatewayTradeNo || transaction.out_trade_no !== payment.merchantOrderNo || payer.openid !== identity.openId ||
    amount.total !== payment.amountCents || payment.amountCents !== order.payableAmountCents || payment.amountCents < 1 ||
    payment.currency !== "CNY" || order.currency !== "CNY" || amount.currency !== "CNY") return reject("PAYMENT_SNAPSHOT_MISMATCH");
  const trackingCompany = shipment.trackingCompany?.trim(), trackingNo = shipment.trackingNo?.trim();
  if (!trackingCompany || !trackingNo || trackingCompany.length > 80 || trackingNo.length > 120 || /[\u0000-\u001f\u007f]/.test(trackingCompany + trackingNo)) return reject("TRACKING_REQUIRED");
  const phone = order.customerPhone.replace(/[\s-]/g, "");
  if (!/^\+?\d{7,20}$/.test(phone)) return reject("RECEIVER_PHONE_REQUIRED");
  if (!order.items.length) return reject("GOODS_REQUIRED");
  const detailList: FollowWaybillPayload["goods_info"]["detail_list"] = [];
  for (const item of order.items) {
    const image = httpsImage(item.image, config.baseUrl) || httpsImage(item.product?.image, config.baseUrl) ||
      item.product?.images?.map(candidate => httpsImage(candidate.imageUrl, config.baseUrl)).find(Boolean);
    const name = boundedText(item.productName, 60);
    if (!image || !name || !Number.isSafeInteger(item.quantity) || item.quantity < 1) return reject("GOODS_IMAGE_OR_NAME_REQUIRED");
    detailList.push({ goods_name: name, goods_img_url: image,
      goods_desc: boundedText(`${item.color} ${item.size} ×${item.quantity}`, 40) });
  }
  return { eligible: true, fingerprint: logisticsFingerprint(trackingCompany, trackingNo), openId: identity.openId,
    transactionId: payment.gatewayTradeNo!, merchantOrderNo: payment.merchantOrderNo,
    payload: { openid: identity.openId, receiver_phone: phone, waybill_id: trackingNo, trans_id: payment.gatewayTradeNo!,
      order_detail_path: `pages/order-detail/index?orderNo=${encodeURIComponent(order.orderNo)}`, goods_info: { detail_list: detailList } } };
}

export function logisticsFailureCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return /^WECHAT_(?:LOGISTICS|SHIPPING|DELIVERY|ACCESS|MINIPROGRAM)_[A-Z0-9_-]+$/.test(message) ? message : "WECHAT_LOGISTICS_REQUEST_FAILED";
}
export function logisticsFailureState(error: unknown, followStarted: boolean): LogisticsBindingState {
  const code = logisticsFailureCode(error);
  // An explicit non-zero API response rejects this request. A timeout, broken
  // response, process crash, or failed local persistence may hide acceptance.
  return !followStarted || /^WECHAT_SHIPPING_API_-?\d+$/.test(code) ? "FAILED" : "UNKNOWN";
}

export type RegistrationDependencies = {
  claim: (shipment: LogisticsCandidate, prepared: Extract<PreparedLogistics, { eligible: true }>, rule: LogisticsRule) => Promise<string | null>;
  remoteOrder: (transactionId: string) => Promise<{ openid: string; merchant_trade_no: string; order_state: number }>;
  resolveCarrier: (company: string) => Promise<string>;
  stillCurrent: (shipment: LogisticsCandidate, prepared: Extract<PreparedLogistics, { eligible: true }>, rule: LogisticsRule) => Promise<boolean>;
  follow: (payload: FollowWaybillPayload) => Promise<Record<string, unknown>>;
  finish: (id: string, state: LogisticsBindingState, token: string | null, errorCode: string | null) => Promise<void>;
};

export async function registerLogisticsCandidate(shipment: LogisticsCandidate, rule: LogisticsRule, config: LogisticsConfig, deps: RegistrationDependencies) {
  const prepared = prepareLogisticsRegistration(shipment, rule, config);
  if (!prepared.eligible) return { outcome: "skipped" as const, reason: prepared.reason };
  const id = await deps.claim(shipment, prepared, rule);
  if (!id) return { outcome: "skipped" as const, reason: "ALREADY_CLAIMED_OR_CHANGED" };
  let followStarted = false;
  try {
    const remote = await deps.remoteOrder(prepared.transactionId);
    if (remote.openid !== prepared.openId || remote.merchant_trade_no !== prepared.merchantOrderNo || remote.order_state === 5) throw Error("WECHAT_LOGISTICS_PAYMENT_MISMATCH");
    const carrier = await deps.resolveCarrier(shipment.trackingCompany!.trim());
    if (!await deps.stillCurrent(shipment, prepared, rule)) throw Error("WECHAT_LOGISTICS_TRACKING_OR_RULE_CHANGED");
    followStarted = true;
    const response = await deps.follow({ ...prepared.payload, delivery_id: carrier });
    const token = response.waybill_token;
    if (typeof token !== "string" || !token.length || token.length > 8192 || /[\s\u0000-\u001f\u007f]/.test(token)) throw Error("WECHAT_LOGISTICS_INVALID_RESPONSE");
    await deps.finish(id, "BOUND", token, null);
    return { outcome: "registered" as const, reason: null };
  } catch (error) {
    const state = logisticsFailureState(error, followStarted), errorCode = logisticsFailureCode(error);
    await deps.finish(id, state, null, errorCode);
    return { outcome: state === "UNKNOWN" ? "unknown" as const : "failed" as const, reason: errorCode };
  }
}

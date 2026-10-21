export type WeChatShipmentStatus = {
  status: string;
  wechatSyncedAt?: string | Date | null;
  wechatSyncError?: string | null;
  wechatRetryAt?: string | Date | null;
};

type ShippingStatusOrder = {
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  paymentIntents?: Array<{ provider?: string; status?: string }>;
  shipments?: WeChatShipmentStatus[];
};

export type WeChatShippingState = "NOT_REQUIRED" | "NOT_SHIPPED" | "PENDING" | "FAILED" | "SYNCED";

export function getWeChatShippingState(order: ShippingStatusOrder): WeChatShippingState {
  const paidViaWeChat = order.paymentIntents?.some(payment => payment.provider === "WECHAT_PAY" && payment.status === "PAID");
  if (!paidViaWeChat || order.paymentStatus.toUpperCase() !== "PAID" || order.status.toUpperCase() !== "CONFIRMED") return "NOT_REQUIRED";
  if (!["SHIPPED", "DELIVERED"].includes(order.fulfillmentStatus.toUpperCase())) return "NOT_SHIPPED";
  const shipments = order.shipments?.filter(shipment => ["SHIPPED", "DELIVERED"].includes(shipment.status.toUpperCase())) ?? [];
  if (shipments.some(shipment => !shipment.wechatSyncedAt && shipment.wechatSyncError)) return "FAILED";
  if (!shipments.length || shipments.some(shipment => !shipment.wechatSyncedAt)) return "PENDING";
  return "SYNCED";
}

export function needsWeChatShippingSync(order: ShippingStatusOrder) {
  return ["PENDING", "FAILED"].includes(getWeChatShippingState(order));
}

export const weChatShippingLabels: Record<WeChatShippingState, string> = {
  NOT_REQUIRED: "无需同步", NOT_SHIPPED: "发货后自动同步", PENDING: "等待同步微信", FAILED: "微信同步异常", SYNCED: "已同步微信",
};

export function weChatShippingErrorMessage(code: string) {
  if (code === "WECHAT_SHIPPING_DATA_MISSING") return "缺少物流或微信支付关联信息，请核对订单。";
  if (code === "WECHAT_DELIVERY_COMPANY_UNKNOWN") return "物流公司未匹配到微信支持的承运商，请更正物流公司名称。";
  if (code === "WECHAT_SHIPPING_REMOTE_CONFLICT") return "微信已有不同的发货记录，请核对两边的物流信息，避免重复发货。";
  if (code === "WECHAT_SHIPPING_ORDER_MISMATCH") return "微信交易与本订单的关联信息不一致，需要核对支付记录。";
  if (code === "WECHAT_SHIPPING_ORDER_REFUNDED") return "微信侧交易已退款，请先核对退款状态。";
  if (/CONFIGURED|ACCESS_TOKEN|API_40001|API_40014|API_42001/.test(code)) return "微信连接暂不可用，系统会自动重试；持续失败时请检查微信配置。";
  return "本次报送未完成，系统会自动重试。请保留现有运单，无需重复确认发货。";
}

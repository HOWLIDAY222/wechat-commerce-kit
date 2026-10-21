const consumerErrorMessages: Record<string, string> = {
  MINIPROGRAM_PURCHASE_REQUIRED: "国内站请通过微信小程序购买，网页不再提供结算与支付。",
  AUTH_REQUIRED: "请先登录后再继续。",
  COMMERCE_PAUSED: "购买服务暂未开放，请稍后再试。",
  COMMERCE_SHOWCASE_ONLY: "当前仅开放商品浏览，暂不可购买。",
  INSUFFICIENT_INVENTORY: "当前规格库存不足，请调整数量或选择其他规格。",
  INVALID_QUANTITY: "商品数量不符合要求，请重新选择。",
  ORDER_ALREADY_PAID: "该订单已完成支付，请前往订单中心查看。",
  ORDER_NOT_FOUND: "未找到对应订单，请前往订单中心核对。",
  PAYMENT_ALREADY_CANCELLED: "该笔支付已取消，请返回订单中心重新发起。",
  PAYMENT_AMOUNT_MISMATCH: "订单金额发生变化，请返回订单中心重新确认。",
  PAYMENT_NOT_AVAILABLE: "当前支付方式暂不可用，请稍后再试。",
  PRODUCT_SALE_NOT_STARTED: "该商品尚未开放购买。",
  PRODUCT_SALE_PAUSED: "该商品购买入口暂未开放。",
  PRODUCT_SHOWCASE_ONLY: "该商品当前仅供浏览。",
  PRODUCT_QUANTITY_LIMIT_EXCEEDED: "已超过该款的选购数量上限，请调整购物袋。",
  SHIPPING_FEE_CONFIGURATION_REQUIRED: "配送费用正在确认，请稍后再试。",
  SHIPPING_PROVINCE_UNSUPPORTED: "当前仅支持中国大陆地区配送，请重新选择收货省区。",
  SKU_NOT_FOUND: "当前规格已下架，请重新选择。",
};

export function getConsumerErrorMessage(error: string | undefined, fallback: string) {
  if (!error) return fallback;
  return consumerErrorMessages[error] ?? fallback;
}

const adminErrorMessages: Record<string, string> = {
  PRODUCT_STYLE_IN_USE: "购物袋仍在使用这个款式，不能删除。请保留款式，暂停销售请使用上下架操作。",
  STYLE_BASE_PRICE_MISMATCH: "尺码基础单价须与常规款单价一致，请在款式价格处统一修改。",
  INVALID_QUANTITY_PRICING: "价格方案无效，请核对条数、单价和组合总价。",
  ADMIN_UNAUTHORIZED: "后台登录已失效，请重新登录后再操作。",
  ADMIN_FORBIDDEN: "当前账号没有执行此操作的权限，请联系店铺负责人。",
  ADMIN_OWNER_REQUIRED: "只有店铺负责人可以修改管理员角色或状态。",
  ADMIN_OWNER_REQUIRED_FOR_REAL_REFUND: "真实资金退款仅允许店铺负责人执行，请联系负责人复核退款单。",
  ADMIN_SELF_LOCKOUT_FORBIDDEN: "不能在这里停用自己或修改自己的管理员角色。",
  CURRENT_PASSWORD_REQUIRED: "这个账号已经设置密码，请先填写当前密码。",
  CURRENT_PASSWORD_INVALID: "当前密码不正确，请重新输入。",
  USER_NOT_FOUND: "用户记录不存在或已发生变化，请刷新页面。",
  ORDER_NOT_FOUND: "订单不存在或已发生变化，请刷新页面。",
  PAYMENT_NOT_FOUND: "支付记录不存在或已发生变化，请刷新页面。",
  REFUND_RECONCILIATION_REQUIRED: "订单已有商户平台退款，请先核对售后关联，勿再次退款。",
  REFUND_NOT_FOUND: "退款记录不存在或已发生变化，请刷新页面。",
  RESHIPMENT_NOT_FOUND: "补发记录不存在或已发生变化，请刷新页面。",
  AFTER_SALES_NOT_FOUND: "售后记录不存在或已发生变化，请刷新页面。",
  ORDER_NOT_DELIVERED_AFTER_SALES_FORBIDDEN: "实物商品尚未签收，当前只能申请仅退款；退货、换货、补发和质量问题请在签收后处理。",
  PRODUCT_NOT_FOUND: "商品不存在或已发生变化，请返回商品列表刷新。",
  SKU_NOT_FOUND: "商品规格不存在或已发生变化，请重新选择。",
  ORDER_STATUS_ACTION_NOT_AVAILABLE: "订单状态已经变化，请刷新详情后重新判断下一步。",
  ORDER_STATUS_ACTION_NOT_ALLOWED: "当前订单状态不能执行这个动作，请刷新详情。",
  ORDER_ACTION_NOT_SUPPORTED: "当前订单不支持这个动作，请返回详情查看可执行操作。",
  UNPAID_ORDER_SHIPMENT_FORBIDDEN: "订单尚未确认支付，不能安排发货。",
  CLOSED_ORDER_SHIPMENT_FORBIDDEN: "订单已经关闭，不能安排发货。",
  ORDER_CONFIRMATION_REQUIRED_BEFORE_SHIPMENT: "订单必须先确认，才能安排发货。",
  SHIPMENT_TRACKING_REQUIRED: "确认发货前必须填写物流公司和运单号。",
  FULFILLMENT_STATUS_ACTION_NOT_ALLOWED: "履约状态已经变化，请刷新当前订单。",
  REJECT_REASON_REQUIRED: "拒绝售后申请时必须填写明确原因。",
  AFTER_SALES_INVALID_TRANSITION: "售后状态已经变化，请刷新详情后重新选择下一步。",
  AFTER_SALES_REFUND_NOT_PROCESSING: "这笔售后尚未进入退款处理中，请返回售后详情核对流程。",
  REFUND_SUCCESS_REQUIRED: "支付服务尚未确认退款成功，不能关闭这笔售后。",
  RESHIPMENT_DELIVERY_REQUIRED: "替换商品尚未全部签收，不能关闭这笔售后。",
  RESHIPMENT_TRACKING_REQUIRED: "确认补发出库前必须填写物流公司和运单号。",
  RESHIPMENT_ACTION_NOT_ALLOWED: "补发状态已经变化，请刷新详情后重新操作。",
  REFUND_STATUS_NOT_EXECUTABLE: "当前退款状态不能再次执行，请刷新详情核对结果。",
  REFUND_AMOUNT_INVALID: "退款金额无效，请核对售后申请和订单金额。",
  REFUND_AMOUNT_EXCEEDS_PAYMENT: "退款金额超过原支付金额，请停止操作并核对订单。",
  ALIPAY_PAID_PAYMENT_NOT_FOUND: "没有找到可退款的支付宝成功记录，请先核对支付。",
  ALIPAY_REFUND_REQUIRES_PRISMA_STORAGE: "当前环境不允许执行真实退款，请联系技术负责人核对生产配置。",
  ALIPAY_REFUND_REQUIRES_ALIPAY_PROVIDER: "当前支付渠道不是支付宝，不能执行支付宝退款。",
  ALIPAY_REFUND_PROVIDER_NOT_CONFIGURED: "支付宝退款服务尚未配置，请联系技术负责人。",
  ALIPAY_QUERY_PROVIDER_NOT_CONFIGURED: "支付宝查单服务尚未配置，请联系技术负责人。",
  ALIPAY_QUERY_TRADE_NOT_PAID: "支付服务商暂未确认付款成功，请稍后再次查单。",
  PAYMENT_AMOUNT_MISMATCH: "支付金额与订单金额不一致，请停止操作并核对支付记录。",
  PRODUCT_IMAGE_REQUIRED_BEFORE_PUBLISH: "商品上架前必须至少上传一张有效商品图。",
  ACTIVE_SKU_PRICE_REQUIRED_BEFORE_PUBLISH: "商品上架前必须配置有效的销售规格和价格。",
  PRODUCT_SILHOUETTE_REQUIRED_BEFORE_SALE: "开放预售或现货前必须填写商品版型。",
  PRODUCT_RISE_REQUIRED_BEFORE_SALE: "开放预售或现货前必须填写商品腰位。",
  PRODUCT_FABRIC_REQUIRED_BEFORE_SALE: "开放预售或现货前必须按水洗标填写面料成分。",
  PRODUCT_CARE_REQUIRED_BEFORE_SALE: "开放预售或现货前必须填写洗护方式。",
  INVALID_INVENTORY_QUANTITY: "盘点可填 0；入库和报损必须填写正整数。",
  INVENTORY_BELOW_RESERVED: "调整后库存不能少于订单锁定数量，请先核对相关订单。",
  INVENTORY_CHANGED: "库存已被其他操作更新，请刷新核对后重新提交。",
  IDEMPOTENCY_CONFLICT: "该次操作内容已变化，请刷新核对记录后重新操作。",
  QUANTITY_PRICING_EXCEEDS_UNIT_PRICE: "组合价高于在售规格原价合计，请在组合优惠明细中一起调整。",
  TRACKING_CORRECTION_NOTE_REQUIRED: "更正运单需要完整物流信息及更正原因。",
  TRACKING_CORRECTION_NOT_ALLOWED: "仅已确认付款且已发货未签收的订单可更正运单。",
  INSUFFICIENT_INVENTORY: "可售库存不足，请核对锁定库存后再操作。",
  PRODUCT_ALREADY_EXISTS: "商品编码已经存在，请使用新的商品编码。",
  PAYMENT_STATUS_DIRECT_EDIT_FORBIDDEN_USE_PROVIDER_SYNC: "支付状态不能手工修改，请使用支付查单同步。",
  ORDER_STATUS_DIRECT_EDIT_FORBIDDEN: "订单状态不能手工修改，请使用详情页提供的状态动作。",
  RESHIPMENT_STATUS_DIRECT_EDIT_FORBIDDEN: "补发状态不能手工修改，请使用详情页提供的状态动作。",
  CONTENT_KEY_NOT_ALLOWED: "这个运营内容不允许在后台修改。",
  CONTENT_VALUE_INVALID: "内容格式不正确，请检查必填项和链接格式。",
  SETTINGS_KEY_NOT_ALLOWED: "这个设置不允许在后台修改。",
};

export function formatAdminActionError(code: string | undefined, status?: number, context = "操作") {
  const normalized = normalizeErrorCode(code);
  if (normalized && adminErrorMessages[normalized]) return adminErrorMessages[normalized];
  if (status === 401) return adminErrorMessages.ADMIN_UNAUTHORIZED;
  if (status === 403) return adminErrorMessages.ADMIN_FORBIDDEN;
  if (status === 404 || normalized.endsWith("_NOT_FOUND")) return "记录不存在或已发生变化，请刷新页面后重试。";
  if (status === 409 || normalized.includes("STATUS") || normalized.endsWith("_NOT_ALLOWED") || normalized.endsWith("_NOT_AVAILABLE")) {
    return "业务状态已经变化，请刷新详情后重新判断下一步。";
  }
  if (status === 429) return "操作过于频繁，请稍后再试。";
  if (status === 400 || status === 422 || normalized.startsWith("INVALID_") || normalized.endsWith("_REQUIRED")) {
    return "提交内容不完整或格式不正确，请检查标注的字段。";
  }
  if (status && status >= 500) return `${context}暂时失败，请稍后重试；如仍失败，请到审计日志核对。`;
  return `${context}失败，请刷新页面后重试；如状态已变化，请重新打开详情。`;
}

function normalizeErrorCode(code: string | undefined) {
  return (code ?? "").split(":", 1)[0].trim().toUpperCase();
}

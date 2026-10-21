const valueLabels: Record<string, string> = {
  CUSTOMER: "普通用户",
  ADMIN: "管理员",
  OWNER: "店铺负责人",
  ACTIVE: "启用",
  DISABLED: "禁用",
  HIDDEN: "隐藏",
  CREATED: "已创建",
  CONFIRMED: "已确认",
  CANCELLED: "已取消",
  CLOSED: "已关闭",
  NOT_STARTED: "未开始",
  PENDING: "待处理",
  PAID: "已支付",
  FAILED: "失败",
  REFUNDED: "已退款",
  PROCESSING: "处理中",
  SHIPPED: "已发货",
  DELIVERED: "已签收",
  RETURNED: "已退回",
  REQUIRES_REDIRECT: "待跳转支付",
  MOCK: "模拟支付",
  ALIPAY: "支付宝",
  RETURN_REFUND: "退货退款",
  EXCHANGE: "换货",
  REFUND_ONLY: "仅退款",
  RESHIP: "补发",
  QUALITY_ISSUE: "质量问题",
  SUBMITTED: "已提交",
  REVIEWING: "审核中",
  APPROVED: "已通过",
  REJECTED: "已拒绝",
  WAITING_RETURN: "待寄回",
  RETURN_IN_TRANSIT: "退回途中",
  RECEIVED: "已收货",
  INSPECTING: "质检中",
  REFUND_PROCESSING: "退款处理中",
  EXCHANGE_SHIPPING: "换货发货中",
  RESHIPPED: "已补发",
  COMPLETED: "已完成",
  MANUAL_MARKED: "人工标记",
  SUCCEEDED: "已成功",
  USER: "用户",
  SYSTEM: "系统",
  ADJUST: "盘点调整",
  RESERVE: "锁定库存",
  RELEASE: "释放库存",
  DEDUCT: "扣减库存",
  RESTOCK: "增加库存",
  TRADE_SUCCESS: "交易成功",
  TRADE_CLOSED: "交易关闭",
  TRADE_FINISHED: "交易完成",
  WAIT_BUYER_PAY: "等待买家付款",
};

const actionLabels: Record<string, string> = {
  "admin.content.list": "查看内容 SEO",
  "admin.after_sales.list": "查看售后列表",
  "admin.inventory.adjusted": "调整库存",
  "admin.order.updated": "更新订单",
  "admin.orders.list": "查看订单列表",
  "admin.payment.alipay.synced": "同步支付宝支付",
  "admin.payment.updated": "更新支付记录",
  "admin.payments.list": "查看支付记录",
  "admin.products.list": "查看商品列表",
  "admin.refund.alipay.failed": "支付宝退款失败",
  "admin.refund.alipay.processing": "发起支付宝退款",
  "admin.refund.alipay.succeeded": "支付宝退款成功",
  "admin.refund.updated": "更新退款",
  "admin.refunds.list": "查看退款列表",
  "admin.reshipment.updated": "更新补发",
  "admin.reshipments.list": "查看补发列表",
  "admin.settings.list": "查看系统设置",
  "admin.shipments.list": "查看发货中心",
  "admin.users.list": "查看用户列表",
  "auth.admin.login": "后台登录",
  "auth.user.login": "用户登录",
  "account.password.set": "设置登录密码",
  "account.password.updated": "修改登录密码",
  "after_sales.created": "创建售后申请",
  "after_sales.image.added": "补充售后凭证",
  "order.cancelled": "取消订单",
  "order.created": "创建订单",
  "order.payment.paid": "订单支付成功",
  "order.payment.pending": "订单待支付",
  "order.refund.succeeded": "订单退款成功",
  "order.reshipment.created": "创建补发记录",
  "payment.alipay.notify": "支付宝异步通知",
  "payment.alipay.notify.cancelled_order": "已取消订单收到支付宝通知",
  "payment.alipay.query.cancelled_order": "已取消订单同步到支付宝付款",
  "payment.alipay.query.paid": "支付宝主动查询确认付款",
  "payment.mock.notify": "模拟支付通知",
  "payment.mock.notify.duplicate": "重复模拟支付通知",
  "payment.user.cancelled": "用户取消支付",
};

const targetLabels: Record<string, string> = {
  after_sales: "售后申请",
  audit_log: "审计日志",
  order: "订单",
  payment: "支付记录",
  payment_notification: "支付通知",
  product: "商品",
  refund: "退款",
  reshipment: "补发",
  setting: "系统设置",
  shipment: "发货记录",
  sku: "SKU",
  user: "用户",
};

export function normalizeStatusKey(value: string | null | undefined) {
  return String(value ?? "").trim().replace(/\s+/g, "_").toUpperCase();
}

export function formatStatusLabel(value: string | null | undefined) {
  const key = normalizeStatusKey(value);
  return valueLabels[key] ?? fallbackLabel(value);
}

export function formatOrderStatusLabel(value: string | null | undefined, paymentStatus?: string | null) {
  if (normalizeStatusKey(value) === "CLOSED") return "订单已结束";
  if (normalizeStatusKey(paymentStatus) === "REFUNDED") return "已退款";
  const key = normalizeStatusKey(value);
  const labels: Record<string, string> = {
    CREATED: "待确认",
    CONFIRMED: "已确认",
    CANCELLED: "已取消",
    CLOSED: "已关闭",
  };
  return labels[key] ?? formatStatusLabel(value);
}

export function formatPaymentStatusLabel(value: string | null | undefined) {
  const key = normalizeStatusKey(value);
  const labels: Record<string, string> = {
    NOT_STARTED: "未支付",
    PENDING: "待付款",
    REQUIRES_REDIRECT: "待跳转支付",
    PAID: "已支付",
    FAILED: "支付失败",
    CANCELLED: "已取消支付",
    REFUNDED: "已退款",
  };
  return labels[key] ?? formatStatusLabel(value);
}

export function formatFulfillmentStatusLabel(value: string | null | undefined) {
  const key = normalizeStatusKey(value);
  const labels: Record<string, string> = {
    PENDING: "待发货",
    PROCESSING: "备货中",
    SHIPPED: "已发货",
    DELIVERED: "已签收",
    RETURNED: "已退回",
  };
  return labels[key] ?? formatStatusLabel(value);
}

export function formatOrderFulfillmentStatusLabel(order: {
  pickup?: {status:string;blocked?:boolean} | null;
  paymentStatus: string | null | undefined;
  fulfillmentStatus: string | null | undefined;
}) {
  if (normalizeStatusKey(order.paymentStatus) === "REFUNDED"
    && ["PENDING", "PROCESSING", "UNFULFILLED"].includes(normalizeStatusKey(order.fulfillmentStatus))) {
    return "未发货";
  }
  if (order.pickup) return order.pickup.status === 'COLLECTED' ? '已取货' : order.pickup.blocked ? '自提暂停' : order.pickup.status === 'READY' ? '待自提' : '待备货';
  return formatFulfillmentStatusLabel(order.fulfillmentStatus);
}

export function formatRoleLabel(value: string | null | undefined) {
  return formatStatusLabel(value);
}

export function formatAfterSalesTypeLabel(value: string | null | undefined) {
  return formatStatusLabel(value);
}

export function formatAfterSalesStatusLabel(value: string | null | undefined) {
  return normalizeStatusKey(value) === "COMPLETED" ? "售后已完成" : formatStatusLabel(value);
}

export function formatActionLabel(value: string | null | undefined) {
  const action = String(value ?? "").trim();
  if (action.startsWith("after_sales.status.")) {
    const status = action.slice("after_sales.status.".length);
    return `售后流转为 ${formatStatusLabel(status)}`;
  }
  return actionLabels[action] ?? fallbackLabel(value);
}

export function formatTargetTypeLabel(value: string | null | undefined) {
  const target = String(value ?? "").trim();
  return targetLabels[target] ?? fallbackLabel(value);
}

function fallbackLabel(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return "未知";
  return text.replace(/_/g, " ");
}

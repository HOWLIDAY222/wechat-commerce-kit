import { pickupOrderPresentation } from './pickup';
import { formatMoney } from '../utils/money';
import { resolveProductImage } from '../utils/url';

const orderStatusLabels = {
  CREATED: '待确认',
  CONFIRMED: '已确认',
  CANCELLED: '已取消',
  CLOSED: '已关闭',
};

const paymentStatusLabels = {
  NOT_STARTED: '待支付',
  PENDING: '支付确认中',
  PAID: '已支付',
  FAILED: '支付失败',
  CANCELLED: '支付已取消',
  PARTIALLY_REFUNDED: '部分退款',
  REFUNDED: '已退款',
};

const fulfillmentStatusLabels = {
  PENDING: '待备货',
  PROCESSING: '备货中',
  SHIPPED: '已发货',
  DELIVERED: '已签收',
  RETURNED: '已退回',
};

export function normalizeOrder(order) {
  const status = String(order?.status || '').toUpperCase();
  const paymentStatus = String(order?.paymentStatus || '').toUpperCase();
  const fulfillmentStatus = String(order?.fulfillmentStatus || '').toUpperCase();
  const isFullyRefunded = paymentStatus === 'REFUNDED'
    || (order?.refundSummary?.state === 'REFUNDED' && order.refundSummary.fullyRefunded === true);
  const history = Array.isArray(order?.afterSalesRequests) ? order.afterSalesRequests : [];
  const items = Array.isArray(order?.items)
    ? order.items.map((item) => ({
      ...item,
      ...afterSalesAvailability(item, history),
      ...(isFullyRefunded ? { refundableQuantity: 0 } : {}),
      thumbnail: resolveProductImage(typeof (item.productImage || item.image) === 'string' ? (item.productImage || item.image) : '', 256),
      lineTotal: formatMoney(item.unitPriceCents * item.quantity, order.currency),
      unitPrice: formatMoney(item.unitPriceCents, order.currency),
    }))
    : [];
  const pickup = pickupOrderPresentation(order);
  const shipments = Array.isArray(order?.shipments) ? order.shipments : [];
  const shipment = currentShipment(shipments);
  return {
    ...order,
    isFullyRefunded,
    isPickup: !!pickup,
    pickup,
    giftRedemption:order?.kind==='GIFT_REDEMPTION',
    items,
    totalQuantity: items.reduce((total, item) => total + (Number.isSafeInteger(item.quantity) && item.quantity > 0 ? item.quantity : 0), 0),
    delivery: pickup && !isFullyRefunded ? pickup : deliveryPresentation(order, items, status, paymentStatus, fulfillmentStatus, shipment, isFullyRefunded),
    createdAtLabel: formatDateTime(order?.createdAt),
    fulfillmentStatusLabel: pickup ? pickup.title : (isFullyRefunded && ['PENDING', 'PROCESSING'].includes(fulfillmentStatus))
      || (fulfillmentStatus === 'PENDING' && !['PAID', 'PARTIALLY_REFUNDED'].includes(paymentStatus))
      ? '未发货' : fulfillmentStatusLabels[fulfillmentStatus] || '配送状态待确认',
    orderStatusLabel: isFullyRefunded && status === 'CLOSED' ? '订单已结束' : orderStatusLabels[status] || '订单状态待确认',
    lifecycleLabel: isFullyRefunded && status === 'CLOSED' ? '订单已结束' : '',
    payableAmount: formatMoney(order?.payableAmountCents, order?.currency),
    paymentStatusLabel: isFullyRefunded ? '已退款' : paymentStatus === 'PAID' && items.some(item => item.refundAmountCents > 0)
      ? '部分退款' : paymentStatusLabels[paymentStatus] || paymentStatus,
    shippingFee: formatMoney(order?.shippingFeeCents, order?.currency),
    subtotal: formatMoney(order?.subtotalCents, order?.currency),
    discount: formatMoney(order?.discountCents || 0, order?.currency),
    shipment,
    wechatTransactionId: order?.paymentIntents?.find(item => item.provider === 'WECHAT_PAY' && item.status === 'PAID')?.gatewayTradeNo || '',
    trackingSummary: shipment?.trackingNo
      ? `${shipment.trackingCompany || '物流'} · ${shipment.trackingNo}`
      : '',
    canViewLogistics: !pickup && Boolean(shipment?.trackingNo) && ['SHIPPED', 'DELIVERED'].includes(fulfillmentStatus),
    canCancel: !isFullyRefunded && status === 'CREATED' && !['PAID', 'CANCELLED', 'REFUNDED'].includes(paymentStatus),
    canPay: !isFullyRefunded && ['CREATED', 'CONFIRMED'].includes(status) && ['NOT_STARTED', 'PENDING', 'FAILED'].includes(paymentStatus),
    canConfirmReceipt: !pickup && !isFullyRefunded && status === 'CONFIRMED' && paymentStatus === 'PAID' && fulfillmentStatus === 'SHIPPED',
    canRepurchase: items.length > 0 && order?.kind!=='GIFT_PURCHASE',
    canRequestAfterSales: !isFullyRefunded && ['PAID', 'PARTIALLY_REFUNDED'].includes(paymentStatus) && !['CANCELLED', 'CLOSED'].includes(status)
      && items.some(item => item.refundableQuantity > 0 && !item.afterSalesPending),
  };
}

function currentShipment(shipments) {
  // Match the logistics GET query: shippedAt DESC NULLS FIRST, then createdAt
  // DESC. Sort a separate list so normalized reads cannot reorder API data.
  return shipments.map((shipment, index) => ({ shipment, index })).sort((left, right) =>
    descendingShipmentDate(left.shipment?.shippedAt, right.shipment?.shippedAt) ||
    descendingShipmentDate(left.shipment?.createdAt, right.shipment?.createdAt) || left.index - right.index
  )[0]?.shipment || null;
}

function descendingShipmentDate(leftValue, rightValue) {
  const timestamp = value => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  };
  const left = timestamp(leftValue), right = timestamp(rightValue);
  if (left === null) return right === null ? 0 : -1;
  if (right === null) return 1;
  return right - left;
}

function deliveryPresentation(order, items, status, paymentStatus, fulfillmentStatus, shipment, isFullyRefunded) {
  const base = { showProgress: false, steps: [], shippedAtLabel: formatDateTime(shipment?.shippedAt) };
  if (isFullyRefunded) return { ...base, title: status === 'CLOSED' ? '订单已结束' : '已退款', copy: ['PENDING', 'PROCESSING'].includes(fulfillmentStatus)
    ? '此订单已全额退款，商品未发货。' : '此订单已全额退款，配送记录仍保留在下方。' };
  if (['CANCELLED', 'CLOSED'].includes(status)) return { ...base, title: status === 'CANCELLED' ? '订单已取消' : '订单已关闭', copy: '此订单已停止处理。相关付款或售后记录以下方信息为准。' };
  if (paymentStatus === 'PARTIALLY_REFUNDED' || items.some(item => Number(item.refundAmountCents) > 0)) return { ...base, title: '部分退款', copy: '请在售后记录中查看退款详情。商品配送状态以下方订单与物流信息为准。' };
  if (fulfillmentStatus === 'RETURNED') return { ...base, title: '商品已退回', copy: '订单配送状态已更新为退回。如需帮助，请联系客服。' };
  if (paymentStatus !== 'PAID') {
    const title = ({ NOT_STARTED: '等待付款', PENDING: '支付确认中', FAILED: '支付未完成', CANCELLED: '支付已取消' })[paymentStatus] || '支付状态待确认';
    return { ...base, title, copy: paymentStatus === 'PENDING' ? '正在确认支付结果。如已扣款，请勿重复付款。' : ['NOT_STARTED', 'FAILED'].includes(paymentStatus) ? '付款完成后，我们会按订单安排发货。' : '请刷新订单核对最新付款状态，如需帮助请联系客服。' };
  }
  const stage = fulfillmentStatus === 'DELIVERED' ? 3 : fulfillmentStatus === 'SHIPPED' ? 2 : fulfillmentStatus === 'PROCESSING' ? 1 : 0;
  const labels = [order?.kind === 'GIFT_REDEMPTION' ? '已兑换' : '已收到付款', '准备发货', '已发货', '已送达'];
  return {
    ...base,
    showProgress: true,
    title: stage === 3 ? '已送达' : stage === 2 ? '已发货' : stage === 1 ? '准备发货' : labels[0],
    copy: stage === 3 ? '此订单已完成收货确认。感谢你的选购。' : stage === 2 ? '商品已发出。快递运输进度以物流公司更新为准。' : stage === 1 ? '我们正在为你准备商品，发货后会及时更新物流信息。' : fulfillmentStatus === 'PENDING' ? (order?.kind === 'GIFT_REDEMPTION' ? '商品已兑换，很快就会开始为你备货。' : '我们已收到你的付款，很快就会开始为你备货。') : '配送状态正在确认，请稍后刷新订单。',
    steps: labels.map((label, index) => ({ key: ['paid', 'preparing', 'shipped', 'delivered'][index], label, complete: index < stage || index === 0 || (index === stage && stage >= 2), current: index === stage, lineComplete: index < stage, last: index === 3 })),
  };
}

// WeChat trace nodes are display-only. They never change merchant fulfillment,
// payment, receipt confirmation or after-sales permissions.
export function logisticsPresentation(logistics) {
  if (logistics?.available === true) {
    const labels = ['暂无揽收信息', '已揽件', '运输中', '派件中', '已签收', '物流异常', '代签收'];
    const validStatus = Number.isInteger(logistics.status) && logistics.status >= 0 && logistics.status < labels.length;
    if (!validStatus) return { logisticsState: 'unavailable', logisticsStatusLabel: '轨迹暂未更新', logisticsHint: '暂未获取到最新物流轨迹，可重试查看，或复制运单号查询。', logisticsTraceLabel: '' };
    return { logisticsState: logistics.status === 5 ? 'exception' : 'ready', logisticsStatusLabel: '已可查询', logisticsTraceLabel: labels[logistics.status], logisticsHint: logistics.status === 0 ? '暂未查询到揽收信息，请以快递公司后续更新为准。' : '以上为微信物流查询结果，实际运输进度以快递公司更新为准。' };
  }
  const reason = String(logistics?.reason || '');
  if (reason === 'BEFORE_ACTIVATION') return { logisticsState: 'unavailable', logisticsStatusLabel: '请使用运单号查询', logisticsHint: '此运单暂无微信物流轨迹，可复制运单号到快递公司查询。', logisticsTraceLabel: '' };
  if (reason === 'SHIPPING_SYNC_PENDING') return { logisticsState: 'preparing', logisticsStatusLabel: '发货信息同步中', logisticsHint: '发货信息正在同步到微信，请稍后再试；也可复制运单号查询。', logisticsTraceLabel: '' };
  if (['NOT_REGISTERED', 'NOT_BOUND', 'SENDING', 'PENDING', 'SHIPPING_SYNC_PENDING', 'TRACKING_CHANGED'].includes(reason)) {
    return { logisticsState: 'preparing', logisticsStatusLabel: '物流信息准备中', logisticsHint: '微信物流轨迹暂未就绪，可稍后再试，或复制运单号查询。', logisticsTraceLabel: '' };
  }
  if (['FAILED', 'UNKNOWN', 'TRACKING_MISMATCH'].includes(reason)) return { logisticsState: 'error', logisticsStatusLabel: '查询暂时不可用', logisticsHint: '物流查询暂时不可用，请稍后重试，或复制运单号查询。', logisticsTraceLabel: '' };
  return { logisticsState: 'unavailable', logisticsStatusLabel: '暂无微信物流轨迹', logisticsHint: '当前暂无法通过微信查看轨迹，可复制运单号到快递公司查询。', logisticsTraceLabel: '' };
}

function afterSalesAvailability(item, history) {
  let refundedQuantity = 0;
  let afterSalesPending = false;
  for (const request of history) {
    const line = request.items?.find(line => line.orderItemId === item.id);
    if (!line) continue;
    const state = String(request.status || '').toUpperCase();
    if (!['CANCELLED', 'REJECTED', 'COMPLETED'].includes(state)) afterSalesPending = true;
    if (state === 'REFUNDED' || request.refunds?.some(refund => String(refund.refundStatus).toUpperCase() === 'SUCCEEDED')) refundedQuantity += line.quantity;
  }
  const remaining = item.unitPriceCents * item.quantity - (item.discountShareCents || 0) - (item.refundAmountCents || 0);
  return { refundableQuantity: remaining > 0 ? Math.max(0, item.quantity - refundedQuantity) : 0, afterSalesPending };
}

export function normalizeQuote(quote) {
  return {
    ...quote,
    payableAmount: formatMoney(quote.payableAmountCents, quote.currency),
    shippingFee: formatMoney(quote.shippingFeeCents, quote.currency),
    subtotal: formatMoney(quote.subtotalCents, quote.currency),
    discount: formatMoney(quote.discountCents || 0, quote.currency),
  };
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ];
  return `${parts.join('-')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

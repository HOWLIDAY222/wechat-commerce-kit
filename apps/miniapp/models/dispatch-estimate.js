export function canShowDispatchEstimate(order) {
  if (!order || order.pickup || !['STANDARD', 'GIFT_REDEMPTION'].includes(String(order.kind || 'STANDARD').toUpperCase())) return false;
  if (String(order.status || '').toUpperCase() !== 'CONFIRMED') return false;
  if (String(order.paymentStatus || '').toUpperCase() !== 'PAID') return false;
  if (!['PENDING', 'PROCESSING'].includes(String(order.fulfillmentStatus || '').toUpperCase())) return false;
  if (order.items?.some(item => Number(item.refundAmountCents) > 0)) return false;
  const refunds = Array.isArray(order.refunds) ? order.refunds : [];
  const refundedCents = refunds.filter(refund => String(refund.refundStatus || '').toUpperCase() === 'SUCCEEDED').reduce((total, refund) => total + (Number.isSafeInteger(refund.refundAmountCents) && refund.refundAmountCents > 0 ? refund.refundAmountCents : 0), 0);
  if (Number(order.payableAmountCents) > 0 && refundedCents >= Number(order.payableAmountCents)) return false;
  const shipments = Array.isArray(order.shipments) ? order.shipments : [];
  return ![...shipments, order.shipment].filter(Boolean).some(shipment => shipment.shippedAt || shipment.deliveredAt ||
    (typeof shipment.trackingNo === 'string' && shipment.trackingNo.trim()) || (typeof shipment.trackingCompany === 'string' && shipment.trackingCompany.trim()) ||
    ['SHIPPED', 'DELIVERED', 'RETURNED'].includes(String(shipment.status || '').toUpperCase()));
}

export function isDispatchDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.slice(0, 4) === '0000') return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function normalizeDispatchEstimate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.timeZone !== 'Asia/Shanghai') throw new Error('INVALID_DISPATCH_ESTIMATE_RESPONSE');
  if (!isDispatchRange(value.startDate, value.endDate)) throw new Error('INVALID_DISPATCH_ESTIMATE_RESPONSE');
  if (value.updatedAt !== null && (typeof value.updatedAt !== 'string' || !value.updatedAt.trim() || !Number.isFinite(new Date(value.updatedAt).getTime()))) throw new Error('INVALID_DISPATCH_ESTIMATE_RESPONSE');
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) throw new Error('INVALID_DISPATCH_ESTIMATE_RESPONSE');
  // Status and label are server presentation hints. The client derives its own
  // calendar-day display, including after midnight in Beijing.
  return { startDate: value.startDate, endDate: value.endDate, updatedAt: value.updatedAt, revision: value.revision };
}

export function isDispatchRange(startDate, endDate) {
  return (startDate === null && endDate === null) || (isDispatchDate(startDate) && isDispatchDate(endDate) && startDate <= endDate);
}

export function dispatchEstimatePresentation(order, estimate, { state = 'ready', now = Date.now() } = {}) {
  const hidden = { visible: false, state: 'hidden', startDate: null, endDate: null, title: '', hint: '' };
  if (!canShowDispatchEstimate(order)) return hidden;
  if (state === 'loading') return { ...hidden, visible: true, state, title: '正在更新预计发货日期' };
  if (state === 'error') return { ...hidden, visible: true, state, title: '预计发货日期暂不可用', hint: '请稍后刷新，或联系客服了解发货安排。' };
  if (estimate?.startDate === null && estimate?.endDate === null) return { ...hidden, visible: true, state: 'unset', title: '预计发货日期待安排', hint: '商家安排后将在此更新。' };
  if (!isDispatchRange(estimate?.startDate, estimate?.endDate) || !Number.isFinite(now)) return dispatchEstimatePresentation(order, null, { state: 'error', now });
  const today = new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const overdue = today > estimate.endDate;
  const format = value => { const [year, month, day] = value.split('-').map(Number); return `${year}年${month}月${day}日`; };
  return { visible: true, state: overdue ? 'overdue' : 'scheduled', startDate: estimate.startDate, endDate: estimate.endDate,
    title: `预计发货日期 ${format(estimate.startDate)}-${format(estimate.endDate)}`,
    hint: overdue ? '预计日期已过，请联系商家了解进度。' : '发货后将更新实际物流信息。' };
}

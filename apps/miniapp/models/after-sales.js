import { config } from '../config/index';
import { formatMoney } from '../utils/money';

const typeLabels = {
  return_refund: '退货退款',
  exchange: '换货',
  refund_only: '仅退款',
  reship: '补发',
  quality_issue: '质量问题',
};

const statusLabels = {
  submitted: '申请已提交',
  reviewing: '申请审核中',
  approved: '申请已通过',
  rejected: '申请未通过',
  waiting_return: '等待寄回',
  return_in_transit: '退货运输中',
  received: '退货已收到',
  inspecting: '退货验收中',
  refund_processing: '退款处理中',
  exchange_shipping: '换货商品发出中',
  reshipped: '补发商品已发出',
  completed: '售后已完成',
  cancelled: '申请已取消',
};

const closedStatuses = new Set(['rejected', 'refunded', 'completed', 'cancelled']);
const endedStatuses = new Set(['rejected', 'completed', 'cancelled']);

export function normalizeAfterSales(item) {
  const status = String(item.status || '').toLowerCase();
  const type = String(item.type || '').toLowerCase();
  const stageLabel = status === 'refunded' ? (type === 'return_refund' ? '待确认退货' : '待结束售后') : '';
  const statusLabel = status === 'refunded' ? `退款已完成，${stageLabel}` : statusLabels[status] || '售后状态待确认';
  const imageUrls = Array.isArray(item.imageUrls) ? item.imageUrls.map(toAbsoluteUrl) : [];
  return {
    ...item,
    createdAtLabel: formatDate(item.createdAt),
    refundAmount: formatMoney(item.refundAmountCents),
    statusLabel,
    statusTitle: status === 'refunded' ? '已退款' : statusLabel,
    stageLabel,
    showRefundPendingNotice: Boolean(statusLabels[status]) && !closedStatuses.has(status) && !(item.refundSummary?.state === 'REFUNDED' && item.refundSummary?.fullyRefunded === true),
    isActive: !endedStatuses.has(status),
    typeLabel: typeLabels[type] || '售后申请',
    imageUrls,
    imageSlotsLeft: Math.max(0, 6 - imageUrls.length),
    canUploadEvidence: type === 'quality_issue' && !closedStatuses.has(status) && imageUrls.length < 6,
    canSubmitReturnShipment: status === 'waiting_return',
    canMessage: !closedStatuses.has(status),
    messages: Array.isArray(item.messages)
      ? item.messages.map((message) => ({
        ...message,
        senderLabel: message.senderType === 'user' ? '我' : message.senderType === 'admin' ? 'MerchantKit 客服' : '系统',
        createdAtLabel: formatDateTime(message.createdAt),
      }))
      : [],
    items: Array.isArray(item.items)
      ? item.items.map((orderItem) => ({
        ...orderItem,
        refundAmount: formatMoney(orderItem.refundAmountCents),
      }))
      : [],
  };
}

function toAbsoluteUrl(value) {
  if (!value || /^https?:\/\//i.test(value)) return value || '';
  return `${config.apiBaseUrl}${value.startsWith('/') ? '' : '/'}${value}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${formatDate(value)} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

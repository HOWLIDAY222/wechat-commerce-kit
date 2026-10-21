import { withTapFeedback } from '../../utils/tap-feedback';
import { createAfterSales } from '../../services/after-sales';
import { fetchOrder } from '../../services/orders';

const allTypes = [
  { label: '仅退款', value: 'refund_only' },
  { label: '退货退款', value: 'return_refund' },
  { label: '换货', value: 'exchange' },
  { label: '补发', value: 'reship' },
  { label: '质量问题', value: 'quality_issue' },
];

Page(withTapFeedback({
  data: {
    description: '',
    error: '',
    items: [],
    loading: true,
    order: null,
    reason: '',
    submitting: false,
    type: 'refund_only',
    types: [],
  },

  onLoad(options) {
    this.orderNo = options.orderNo || '';
    this.loadOrder();
  },

  async loadOrder() {
    if (!this.orderNo) {
      this.setData({ loading: false, error: '缺少订单编号。' });
      return;
    }
    try {
      const order = await fetchOrder(this.orderNo);
      const delivered = order.fulfillmentStatus === 'DELIVERED';
      const types = delivered ? allTypes : allTypes.filter((item) => item.value === 'refund_only');
      this.setData({
        order,
        types,
        type: types[0].value,
        items: order.items.filter(item => item.refundableQuantity > 0 && !item.afterSalesPending).map((item) => ({ ...item, selected: false, requestQuantity: 1 })),
      });
    } catch (_error) {
      this.setData({ error: '订单资料加载失败，请返回后重试。' });
    } finally {
      this.setData({ loading: false });
    }
  },

  chooseType(event) {
    this.setData({ type: event.currentTarget.dataset.value });
  },

  toggleItem(event) {
    const id = event.currentTarget.dataset.id;
    const index = this.data.items.findIndex((item) => item.id === id);
    if (index >= 0) this.setData({ [`items[${index}].selected`]: !this.data.items[index].selected });
  },

  changeQuantity(event) {
    const index = this.data.items.findIndex((item) => item.id === event.currentTarget.dataset.id);
    if (index < 0) return;
    const item = this.data.items[index];
    const next = Math.max(1, Math.min(item.refundableQuantity, item.requestQuantity + Number(event.currentTarget.dataset.delta)));
    this.setData({ [`items[${index}].requestQuantity`]: next });
  },

  updateReason(event) { this.setData({ reason: event.detail.value }); },
  updateDescription(event) { this.setData({ description: event.detail.value }); },

  async submit() {
    if (this.data.loading || this.data.submitting || !this.data.order?.canRequestAfterSales) return;
    const items = this.data.items.filter((item) => item.selected).map((item) => ({
      orderItemId: item.id,
      quantity: item.requestQuantity,
    }));
    if (!items.length) return this.setData({ error: '请至少选择一件商品。' });
    if (!this.data.reason.trim()) return this.setData({ error: '请填写售后原因。' });
    if (!this.data.description.trim()) return this.setData({ error: '请说明具体情况。' });

    this.setData({ submitting: true, error: '' });
    try {
      const result = await createAfterSales({
        orderNo: this.orderNo,
        type: this.data.type,
        reason: this.data.reason.trim(),
        description: this.data.description.trim(),
        items,
        imageUrls: [],
      });
      wx.redirectTo({ url: `/pages/after-sales-detail/index?afterSalesNo=${encodeURIComponent(result.afterSalesNo)}` });
    } catch (error) {
      this.setData({ error: afterSalesErrorMessage(error?.message) });
    } finally {
      this.setData({ submitting: false });
    }
  },
}, ["chooseType","toggleItem","changeQuantity","submit"]));

function afterSalesErrorMessage(code) {
  const messages = {
    ORDER_ITEM_AFTER_SALES_CONFLICT: '所选商品已有售后申请，请到售后列表查看进度。',
    DUPLICATE_AFTER_SALES_ITEM: '商品选择重复，请重新进入页面选择。',
    INVALID_AFTER_SALES_QUANTITY: '可申请数量已变化，请返回后重新选择。',
    AUTH_REQUIRED: '登录已过期，请到“我的”重新登录。',
    ORDER_ITEM_ALREADY_REFUNDED: '所选商品已完成退款，不能重复申请。',
    ORDER_NOT_DELIVERED_AFTER_SALES_FORBIDDEN: '该售后类型需要订单签收后申请。',
    UNPAID_ORDER_AFTER_SALES_FORBIDDEN: '未支付订单不能申请售后。',
  };
  return messages[code] || '售后申请提交失败，请检查信息后重试。';
}

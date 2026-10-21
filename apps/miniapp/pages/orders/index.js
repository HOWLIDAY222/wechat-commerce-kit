import { withTapFeedback } from '../../utils/tap-feedback';
import { fetchOrders } from '../../services/orders';
import { hasSession } from '../../stores/session';

const filters = [
  { label: '全部', value: 'all' },
  { label: '待支付', value: 'unpaid' },
  { label: '待发货', value: 'unshipped' },
  { label: '待收货', value: 'shipped' },
  { label: '配送进度', value: 'shipping' },
  { label: '已完成', value: 'completed' },
];
const PAGE_SIZE = 10;

Page(withTapFeedback({
  data: {
    activeFilter: 'all',
    error: '',
    filters,
    loading: true,
    loggedIn: false,
    orders: [],
    visibleOrders: [],
    matchedOrderCount: 0,
    hasMore: false,
  },

  onLoad(options = {}) {
    const activeFilter = filters.some(item => item.value === options.filter) ? options.filter : 'all';
    this.setData({ activeFilter });
  },

  onShow() {
    const loggedIn = hasSession();
    this.setData({ loggedIn });
    if (loggedIn) this.loadOrders();
    else this.setData({ loading: false });
  },

  onPullDownRefresh() {
    this.loadOrders();
  },

  onReachBottom() {
    this.renderNextPage();
  },

  async loadOrders() {
    this.setData({ loading: true, error: '' });
    try {
      const orders = await fetchOrders();
      this.setData({ orders, loggedIn: true });
      this.applyFilter(this.data.activeFilter, orders);
    } catch (error) {
      if (error?.statusCode === 401) this.setData({ loggedIn: false, orders: [], visibleOrders: [] });
      else this.setData({ error: '订单同步失败，请稍后重试。' });
    } finally {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },

  chooseFilter(event) {
    this.applyFilter(event.currentTarget.dataset.value, this.data.orders);
  },

  applyFilter(activeFilter, orders) {
    this.filteredOrders = orders.filter((order) => matchesOrder(order, activeFilter));
    this.setData({
      activeFilter,
      matchedOrderCount: this.filteredOrders.length,
      visibleOrders: this.filteredOrders.slice(0, PAGE_SIZE),
      hasMore: this.filteredOrders.length > PAGE_SIZE,
    });
  },

  renderNextPage() {
    if (!this.data.hasMore || !Array.isArray(this.filteredOrders)) return;
    const nextLength = Math.min(this.filteredOrders.length, this.data.visibleOrders.length + PAGE_SIZE);
    this.setData({
      visibleOrders: this.filteredOrders.slice(0, nextLength),
      hasMore: nextLength < this.filteredOrders.length,
    });
  },

  openOrder(event) {
    const orderNo = event.currentTarget.dataset.orderNo;
    if (orderNo) wx.navigateTo({ url: `/pages/order-detail/index?orderNo=${encodeURIComponent(orderNo)}` });
  },

  goLogin() {
    wx.switchTab({ url: '/pages/account/index' });
  },

  browseProducts() {
    wx.switchTab({ url: '/pages/products/index' });
  },
}, ["chooseFilter","goLogin","browseProducts","openOrder"]));

function matchesOrder(order, filter) {
  if (filter === 'all') return true;
  const paid = ['PAID', 'PARTIALLY_REFUNDED'].includes(order.paymentStatus);
  if (filter === 'unpaid') return !order.isFullyRefunded && order.canPay;
  if (filter === 'unshipped') return !order.isFullyRefunded && paid && order.status === 'CONFIRMED' && ['PENDING', 'PROCESSING'].includes(order.fulfillmentStatus);
  if (filter === 'shipped') return !order.isFullyRefunded && paid && order.status === 'CONFIRMED' && order.fulfillmentStatus === 'SHIPPED';
  if (filter === 'shipping') return order.fulfillmentStatus !== 'DELIVERED' && (order.canViewLogistics || (!order.isFullyRefunded && paid));
  return order.fulfillmentStatus === 'DELIVERED' || order.status === 'CLOSED';
}

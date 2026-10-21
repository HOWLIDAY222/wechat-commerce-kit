import { withTapFeedback } from '../../utils/tap-feedback';
import { fetchAfterSalesList } from '../../services/after-sales';
import { hasSession } from '../../stores/session';

Page(withTapFeedback({
  data: {
    error: '',
    items: [],
    visibleItems: [],
    activeFilter: 'all',
    activeCount: 0,
    loading: true,
    loggedIn: false,
  },

  onShow() {
    const loggedIn = hasSession();
    this.setData({ loggedIn });
    if (loggedIn) this.loadItems();
    else this.setData({ loading: false, items: [], visibleItems: [], activeCount: 0 });
  },

  onPullDownRefresh() {
    this.loadItems();
  },

  async loadItems() {
    this.setData({ loading: true, error: '' });
    try {
      const items = await fetchAfterSalesList();
      this.setData({ items, loggedIn: true, activeCount: items.filter(item => item.isActive).length });
      this.applyFilter(this.data.activeFilter, items);
    } catch (error) {
      if (error?.statusCode === 401) this.setData({ loggedIn: false, items: [], visibleItems: [], activeCount: 0 });
      else this.setData({ error: '售后记录同步失败，请稍后重试。' });
    } finally {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },

  chooseFilter(event) { this.applyFilter(event.currentTarget.dataset.value, this.data.items); },
  applyFilter(value, items) {
    const activeFilter = value === 'active' ? 'active' : 'all';
    this.setData({ activeFilter, visibleItems: activeFilter === 'active' ? items.filter(item => item.isActive) : items });
  },

  openItem(event) {
    const afterSalesNo = event.currentTarget.dataset.afterSalesNo;
    if (afterSalesNo) wx.navigateTo({ url: `/pages/after-sales-detail/index?afterSalesNo=${encodeURIComponent(afterSalesNo)}` });
  },

  openOrders() {
    wx.navigateTo({ url: '/pages/orders/index' });
  },

  goLogin() {
    wx.switchTab({ url: '/pages/account/index' });
  },
}, ["chooseFilter","goLogin","openOrders","openItem"]));

import { withTapFeedback } from '../../utils/tap-feedback';
import { deleteAddress, fetchAddresses, updateAddress } from '../../services/addresses';
import { hasSession } from '../../stores/session';

Page(withTapFeedback({
  data: {
    addresses: [],
    error: '',
    loading: true,
    loggedIn: false,
    selectMode: false,
  },

  onLoad(options) {
    this.setData({ selectMode: options.select === '1' });
    this.giftId=/^[A-Za-z0-9_-]{1,100}$/.test(options.gift||'')?options.gift:'';
  },

  onShow() {
    const loggedIn = hasSession();
    this.setData({ loggedIn });
    if (loggedIn) this.loadAddresses();
    else this.setData({ loading: false });
  },

  onPullDownRefresh() {
    this.loadAddresses();
  },

  async loadAddresses() {
    if (!hasSession()) {
      this.setData({ loggedIn: false, loading: false });
      wx.stopPullDownRefresh();
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      this.setData({ addresses: await fetchAddresses(), loggedIn: true });
    } catch (error) {
      if (error?.statusCode === 401) this.setData({ loggedIn: false, addresses: [] });
      else this.setData({ error: '地址同步失败，请稍后重试。' });
    } finally {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },

  addAddress() {
    wx.navigateTo({ url: '/pages/address-edit/index' });
  },

  editAddress(event) {
    const id = event.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: `/pages/address-edit/index?id=${encodeURIComponent(id)}` });
  },

  chooseAddress(event) {
    if (!this.data.selectMode) return;
    const address = this.data.addresses.find((item) => item.id === event.currentTarget.dataset.id);
    if (!address) return;
    wx.setStorageSync(this.giftId?`merchantkit.giftAddress.${this.giftId}`:'merchantkit.checkoutAddress', address);
    wx.navigateBack();
  },

  async setDefault(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    try {
      await updateAddress(id, { isDefault: true });
      await this.loadAddresses();
    } catch (_error) {
      this.setData({ error: '默认地址更新失败，请稍后重试。' });
    }
  },

  async removeAddress(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.showModal({
      title: '删除地址',
      content: '确定删除这个收货地址吗？',
      success: async (result) => {
        if (!result.confirm) return;
        try {
          await deleteAddress(id);
          await this.loadAddresses();
        } catch (_error) {
          this.setData({ error: '地址删除失败，请稍后重试。' });
        }
      },
    });
  },

  goLogin() {
    wx.switchTab({ url: '/pages/account/index' });
  },
}, ["goLogin","chooseAddress","setDefault","editAddress","removeAddress","addAddress"]));

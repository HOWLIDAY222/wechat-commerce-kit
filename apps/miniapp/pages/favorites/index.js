import { withTapFeedback } from '../../utils/tap-feedback';
import { fetchFavorites, removeFavorite } from '../../services/favorites';
import { hasSession } from '../../stores/session';

Page(withTapFeedback({
  data: {
    error: '',
    favorites: [],
    loading: true,
    loggedIn: false,
    removingSlug: '',
  },

  onShow() {
    const loggedIn = hasSession();
    this.setData({ loggedIn });
    if (loggedIn) this.loadFavorites();
    else this.setData({ loading: false });
  },

  onPullDownRefresh() {
    this.loadFavorites();
  },

  async loadFavorites() {
    if (!hasSession()) {
      this.setData({ loggedIn: false, loading: false });
      wx.stopPullDownRefresh();
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      this.setData({ favorites: await fetchFavorites(), loggedIn: true });
    } catch (error) {
      if (error?.statusCode === 401) this.setData({ loggedIn: false, favorites: [] });
      else this.setData({ error: '收藏同步失败，请稍后重试。' });
    } finally {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },

  openProduct(event) {
    const slug = event.detail?.slug;
    if (slug) wx.navigateTo({ url: `/pages/product-detail/index?slug=${encodeURIComponent(slug)}` });
  },

  async remove(event) {
    const slug = event.currentTarget.dataset.slug;
    if (!slug || this.data.removingSlug) return;
    this.setData({ removingSlug: slug });
    try {
      await removeFavorite(slug);
      this.setData({ favorites: this.data.favorites.filter((product) => product.slug !== slug) });
    } catch (_error) {
      this.setData({ error: '移除收藏失败，请稍后重试。' });
    } finally {
      this.setData({ removingSlug: '' });
    }
  },

  goLogin() {
    wx.switchTab({ url: '/pages/account/index' });
  },

  browseProducts() {
    wx.switchTab({ url: '/pages/products/index' });
  },
}, ["goLogin","browseProducts","remove"]));

import { withTapFeedback } from '../../utils/tap-feedback';
Component(withTapFeedback({
  properties: {
    back: {
      type: Boolean,
      value: false,
    },
    showSearch: {
      type: Boolean,
      value: true,
    },
    showBag: {
      type: Boolean,
      value: true,
    },
    showSubscription: {
      type: Boolean,
      value: false,
    },
  },

  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    capsuleInset: 96,
    homeLogoWidth: 159,
    logoFailed: false,
  },

  lifetimes: {
    attached() {
      try {
        const windowInfo = wx.getWindowInfo();
        const capsule = wx.getMenuButtonBoundingClientRect();
        const statusBarHeight = Number(windowInfo.statusBarHeight || 20);
        const capsuleTopGap = Math.max(0, Number(capsule.top || statusBarHeight) - statusBarHeight);
        const windowWidth = Number(windowInfo.windowWidth || 375);
        const capsuleInset = Math.max(88, windowWidth - Number(capsule.left || windowWidth - 95) + 6);
        this.setData({
          statusBarHeight,
          navigationBarHeight: Math.max(44, capsuleTopGap * 2 + Number(capsule.height || 32)),
          capsuleInset,
          // Equal side reservations keep the wordmark centered and clear of
          // both the search/subscription pill and WeChat's native capsule.
          homeLogoWidth: Math.max(72, Math.floor(windowWidth - 2 * Math.max(104, capsuleInset + 6))),
        });
      } catch (_error) {
        // Conservative defaults keep the header usable on older base libraries.
      }
    },
  },

  methods: {
    goBack() {
      wx.navigateBack({
        fail: () => wx.switchTab({ url: '/pages/home/home' }),
      });
    },
    goHome() {
      wx.switchTab({ url: '/pages/home/home' });
    },
    openSearch() {
      this.triggerEvent('search');
    },
    openSubscriptions() {
      this.triggerEvent('subscribe');
    },
    onLogoError() {
      this.setData({ logoFailed: true });
    },
    openBag() {
      wx.switchTab({ url: '/pages/cart/index' });
    },
  },
}, ["goBack","openSearch","openSubscriptions","goHome"], {"component":true}));

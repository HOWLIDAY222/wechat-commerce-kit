import { withTapFeedback } from '../../utils/tap-feedback';
import {currentMiniappVisit} from '../../utils/miniapp-visit';

Component(withTapFeedback({
  data: { visible: false, pointerLeft: 310 },
  lifetimes: {
    attached() {
      this.inView = true;
      this.refreshHint();
    },
    detached() {
      this.disposed = true;
      this.checkGeneration = (this.checkGeneration || 0) + 1;
    },
  },
  pageLifetimes: {
    show() {
      this.inView = true;
      this.refreshHint();
    },
    hide() {
      this.inView = false;
      this.checkGeneration = (this.checkGeneration || 0) + 1;
      this.setData({ visible: false });
    },
    resize() { this.updatePointer(); },
  },
  methods: {
    canShow() {
      return getApp().globalData.addMiniappHintSeenVisit !== currentMiniappVisit();
    },
    updatePointer() {
      try {
        const width = wx.getWindowInfo().windowWidth;
        const menu = wx.getMenuButtonBoundingClientRect();
        const target = menu.left + menu.width / 4;
        if (Number.isFinite(width) && Number.isFinite(target)) {
          this.setData({ pointerLeft: Math.max(16, Math.min(width - 16, target)) });
        }
      } catch { /* The hint remains usable when menu geometry is unavailable. */ }
    },
    refreshHint() {
      if (this.disposed || !this.inView || this.data.visible) return;
      this.updatePointer();
      if (!this.canShow()) return;
      const visit = currentMiniappVisit();
      const generation = this.checkGeneration = (this.checkGeneration || 0) + 1;
      const show = () => {
        if (this.disposed || !this.inView || generation !== this.checkGeneration || visit !== currentMiniappVisit() || !this.canShow()) return;
        getApp().globalData.addMiniappHintSeenVisit = visit;
        this.setData({ visible: true });
      };
      if (typeof wx.checkIsAddedToMyMiniProgram !== 'function') { show(); return; }
      try {
        wx.checkIsAddedToMyMiniProgram({
          success: result => { if (!result.added) show(); },
          fail: show,
        });
      } catch { show(); }
    },
    dismiss() {
      this.checkGeneration = (this.checkGeneration || 0) + 1;
      getApp().globalData.addMiniappHintSeenVisit = currentMiniappVisit();
      this.setData({ visible: false });
    },
  },
}, ["dismiss"], {"component":true}));

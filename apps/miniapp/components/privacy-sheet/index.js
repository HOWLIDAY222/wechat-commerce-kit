import { withTapFeedback } from '../../utils/tap-feedback';
import { registerPrivacyHost, showPrivacyHost, hidePrivacyHost, removePrivacyHost, openPrivacyDocument, decidePrivacySheet, isCurrentPrivacySheet } from '../../utils/privacy-flow';

function page() { try { const pages = getCurrentPages(); return pages[pages.length - 1]; } catch { return null; } }
function eventSerial(event) { const value = event?.currentTarget?.dataset?.privacySerial; return typeof value === 'number' && Number.isSafeInteger(value) ? value : typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : -1; }
Component(withTapFeedback({
  data: { visible: false, nativeRequired: false, serial: 0, busy: false, error: '' },
  lifetimes: {
    attached() { this.sheetAttached = true; this.privacyHost = registerPrivacyHost(page(), state => { if (this.sheetAttached) this.setData({ ...state, error: '', busy: false }); }); },
    detached() { this.sheetAttached = false; removePrivacyHost(this.privacyHost); this.privacyHost = null; },
  },
  pageLifetimes: {
    show() { if (this.privacyHost) showPrivacyHost(this.privacyHost, page()); },
    hide() { hidePrivacyHost(this.privacyHost); },
  },
  methods: {
    stopTouch() {},
    openPolicy(event) { openPrivacyDocument('privacy-policy', eventSerial(event), this.privacyHost); },
    openMiniPolicy(event) { openPrivacyDocument('miniprogram-privacy', eventSerial(event), this.privacyHost); },
    openNativePolicy(event) {
      if (!this.data.nativeRequired || this.data.busy || !isCurrentPrivacySheet(eventSerial(event), this.privacyHost)) return;
      if (typeof wx.openPrivacyContract === 'function') wx.openPrivacyContract({ fail: () => { if (this.sheetAttached) this.setData({ error: '微信隐私保护指引暂时无法打开。' }); } });
      else this.setData({ error: '请更新微信后查看隐私保护指引。' });
    },
    accept(event) { if (!this.data.nativeRequired) this.choose(true, false, eventSerial(event)); },
    acceptNative(event) { if (this.data.nativeRequired) this.choose(true, true, eventSerial(event)); },
    decline(event) { this.choose(false, false, eventSerial(event)); },
    choose(accepted, nativeAuthorized, serial) {
      if (this.data.busy || !isCurrentPrivacySheet(serial, this.privacyHost)) return;
      this.setData({ busy: true, error: '' });
      try { decidePrivacySheet(accepted, serial, nativeAuthorized, this.privacyHost); }
      catch { if (this.sheetAttached) this.setData({ error: '设置未保存，请重试。' }); }
      finally { if (this.sheetAttached) this.setData({ busy: false }); }
    },
  },
}, ["openPolicy","openMiniPolicy","openNativePolicy","accept","decline"], {"component":true}));

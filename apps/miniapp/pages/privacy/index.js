import { withTapFeedback } from '../../utils/tap-feedback';
import { documents } from '../../content/documents';
import { savePrivacyChoice } from '../../stores/privacy-consent';
import { cancelNativePrivacy, completePrivacyPage, needsNativePrivacy, privacyPageShown } from '../../utils/privacy-flow';

Page(withTapFeedback({
  data: { policyNodes: documents['privacy-policy'].nodes, miniNodes: documents['miniprogram-privacy'].nodes, nativeRequired: false, busy: false, error: '', statusBarHeight: 24 },
  onLoad(options = {}) { this.nativeMode = options.native === '1'; try { this.setData({ statusBarHeight: wx.getWindowInfo().statusBarHeight || 24 }); } catch {} },
  onShow() { privacyPageShown(); this.setData({ nativeRequired: needsNativePrivacy(), error: '' }); },
  onUnload() { if (this.nativeMode) cancelNativePrivacy(); },
  accept() { if (!this.data.nativeRequired) this.choose(true); },
  acceptNative() { this.choose(true); },
  decline() { this.choose(false); },
  choose(accepted) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: '' });
    try { if (!this.nativeMode) savePrivacyChoice(accepted ? 'accepted' : 'browse'); completePrivacyPage(accepted, { native: this.nativeMode }); }
    catch { this.setData({ error: '设置未保存，请重试。' }); }
    finally { this.setData({ busy: false }); }
  },
  openNativePolicy() { if (typeof wx.openPrivacyContract === 'function') wx.openPrivacyContract({ fail: () => this.setData({ error: '微信隐私保护指引暂时无法打开。' }) }); else this.setData({ error: '请更新微信后查看微信隐私保护指引。' }); },
}, ["openNativePolicy","accept","decline"]));

import { withTapFeedback } from '../../utils/tap-feedback';
import {
  fetchSubscriptions, saveSubscriptionReceipt, saveSubscriptionPreferences, requestNativeSubscriptions, subscriptionRequestId,
  subscriptionAccountId, loadPendingSubscriptionReceipt, persistPendingSubscriptionReceipt, clearPendingSubscriptionReceipt,
} from '../../services/subscriptions';
import { subscriptionPresentation, subscriptionReceiptFeedback, nativeReceipt, subscriptionError } from '../../models/subscriptions';
import { rememberMemberLoginReturn } from '../../stores/navigation';
import { rememberSubscriptionPhoneReturn } from '../../stores/subscription-phone-return';
import { isPrivacyAccepted } from '../../stores/privacy-consent';

const diagnosticVersion = '0.1.0', expectedRuntimeAppId = 'wx0000000000000000';
const diagnosticChannels = ['new_product', 'restock', 'campaign', 'order_shipped', 'after_sales'];
const safeVersion = value => typeof value === 'string' && value.length <= 32 && /^\d+(?:\.\d+)*$/.test(value) ? value : null;

Page(withTapFeedback({
  data: { loading: true, busy: false, error: '', notice: '', ...subscriptionPresentation(null), managementOpen: false, pendingReceipt: false, diagnosticAvailable: false },
  onLoad() { this.selection = {}; this.readVersion = 0; this.scopeOwner = ''; this.pending = null; this.pendingOwner = ''; this.settingsReadVersion = 0; this.settingsOpenVersion = 0; this.nativeSettings = null; this.receiveSettingsStatus = null; this.receiveSettingsPhase = 'not_read'; this.diagnosticVisible = true; },
  onShow() { this.unloaded = false; this.diagnosticVisible = true; this.restorePending(); if (!this.settingsOpening) this.load(); },
  onHide() { this.diagnosticVisible = false; this.clearDiagnostic(); },
  onUnload() { this.unloaded = true; this.readVersion++; this.settingsReadVersion++; this.settingsOpenVersion++; this.clearDiagnostic(); },
  onPullDownRefresh() { if (this.data.busy) { wx.stopPullDownRefresh(); return; } this.load(); },

  restorePending() {
    const owner = subscriptionAccountId();
    if (owner !== this.scopeOwner) {
      this.scopeOwner = owner; this.current = null; this.selection = {}; this.pending = null; this.pendingOwner = '';
      this.settingsReadVersion++; this.settingsOpenVersion++; this.nativeSettings = null; this.receiveSettingsStatus = null; this.receiveSettingsPhase = 'not_read'; this.clearDiagnostic();
      if (this.settingsOpening) { this.settingsOpening = false; this.setData({ busy: false }); }
      this.setData({ ...subscriptionPresentation(null), pendingReceipt: false, managementOpen: false, notice: '' });
    }
    if (owner && !this.pending) {
      const receipt = loadPendingSubscriptionReceipt(owner);
      if (receipt) { this.pending = receipt; this.pendingOwner = owner; this.pendingStored = true; this.setData({ pendingReceipt: true }); }
    }
  },
  async load() {
    if (this.data.busy) return;
    this.restorePending(); const owner = this.scopeOwner, version = ++this.readVersion;
    this.setData({ loading: true, error: '' });
    try {
      const result = await fetchSubscriptions();
      if (this.unloaded || version !== this.readVersion) return;
      if (owner !== subscriptionAccountId()) { this.restorePending(); return; }
      this.setCurrentSubscriptions(result);
      this.updatePresentation({ loading: false }); this.readReceiveSettings();
    } catch (error) {
      if (this.unloaded || version !== this.readVersion) return;
      if (['AUTH_REQUIRED', 'SESSION_CHANGED'].includes(error?.message) || owner !== subscriptionAccountId()) this.restorePending();
      this.setData({ loading: false, error: subscriptionError(error) });
    } finally {
      if (!this.unloaded && version === this.readVersion) this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },
  templateFingerprint() { return (this.current?.channels || []).map(row => `${row.key}:${row.templateId || ''}`).join('|'); },
  setCurrentSubscriptions(result) {
    const previousTemplates = this.templateFingerprint(); this.current = result;
    if (previousTemplates !== this.templateFingerprint()) { this.settingsReadVersion++; this.nativeSettings = null; this.clearDiagnostic(); }
  },
  needsReceiveSettings(group, rows = this.data.channels) {
    const selected = rows.filter(row => row.group === group && row.available && row.selected);
    return !!selected.length && (this.nativeSettings?.mainSwitch === false
      || selected.some(row => this.nativeSettings?.items?.[row.templateId] === 'reject'));
  },
  updatePresentation(extra = {}) {
    const presentation = subscriptionPresentation(this.current, this.selection);
    this.setData({ ...presentation, channelGroups: presentation.channelGroups.map(group => ({ ...group, actionLabel: this.needsReceiveSettings(group.key, presentation.channels) ? '微信接收设置' : group.buttonLabel })), ...extra });
  },
  readReceiveSettings() {
    if (!isPrivacyAccepted() || !this.current?.authenticated || !this.scopeOwner) return;
    if (typeof wx.getSetting !== 'function') { this.receiveSettingsStatus = 'unsupported'; this.receiveSettingsPhase = 'unsupported'; this.nativeSettings = null; this.updatePresentation(); this.refreshDiagnosticSettings(); return; }
    const owner = this.scopeOwner, templates = this.templateFingerprint(), version = ++this.settingsReadVersion;
    const ids = (this.current.channels || []).map(row => row.templateId).filter(Boolean);
    this.receiveSettingsStatus = null; this.receiveSettingsPhase = 'pending';
    const apply = (status, result) => {
        if (this.unloaded || version !== this.settingsReadVersion || owner !== subscriptionAccountId() || templates !== this.templateFingerprint() || !isPrivacyAccepted()) return;
        const settings = result?.subscriptionsSetting, items = {};
        for (const id of ids) {
          const value = settings?.itemSettings?.[id];
          if (['accept', 'reject', 'ban'].includes(value)) items[id] = value;
        }
        this.receiveSettingsStatus = status;
        this.receiveSettingsPhase = status === 'success' ? settings && typeof settings === 'object' ? 'success_with_subscriptions' : 'success_without_subscriptions' : 'fail';
        this.nativeSettings = status === 'success' ? { mainSwitch: typeof settings?.mainSwitch === 'boolean' ? settings.mainSwitch : null, items } : null;
        this.updatePresentation(); this.refreshDiagnosticSettings();
    };
    try { wx.getSetting({ withSubscriptions: true, success: result => apply('success', result), fail: () => apply('fail') }); }
    catch { apply('fail'); }
  },
  openReceiveSettings() {
    if (this.unloaded || this.data.busy || this.data.loading || this.pending || !isPrivacyAccepted()) return;
    const owner = subscriptionAccountId();
    if (!owner || owner !== this.scopeOwner) return;
    if (typeof wx.openSetting !== 'function') { this.showSubscriptionFeedback('当前微信版本暂不支持', owner); return; }
    const version = ++this.settingsOpenVersion; this.settingsReadVersion++; this.readVersion++;
    this.settingsOpening = true; this.setData({ busy: true, error: '', notice: '' });
    let finished = false;
    const finish = opened => {
      if (finished) return; finished = true;
      if (this.unloaded || version !== this.settingsOpenVersion || owner !== subscriptionAccountId() || owner !== this.scopeOwner) return;
      this.settingsOpening = false;
      if (opened) this.nativeSettings = null;
      this.setData({ busy: false });
      if (!opened) this.showSubscriptionFeedback('设置未打开，请重试', owner);
      // Settings are not a subscription grant. Refresh only; permission still needs another tap.
      this.load();
    };
    try { wx.openSetting({ withSubscriptions: true, success: () => finish(true), fail: () => finish(false) }); }
    catch { finish(false); }
  },
  clearDiagnostic() { this.diagnostic = null; this.diagnosticOwner = ''; this.diagnosticTemplateFingerprint = ''; this.setData({ diagnosticAvailable: false }); },
  diagnosticEnvironment() {
    try {
      const miniProgram = wx.getAccountInfoSync?.()?.miniProgram;
      if (!['develop', 'trial'].includes(miniProgram?.envVersion) || typeof miniProgram.appId !== 'string' || !/^wx[0-9a-f]{16}$/i.test(miniProgram.appId)) return null;
      let info = {}; try { info = wx.getSystemInfoSync?.() || {}; } catch {}
      return { appVersion: diagnosticVersion, platform: ['ios', 'android', 'devtools'].includes(info.platform) ? info.platform : 'unknown', SDKVersion: safeVersion(info.SDKVersion), wechatVersion: safeVersion(info.version), runtimeAppIdMatches: miniProgram.appId === expectedRuntimeAppId };
    } catch { return null; }
  },
  diagnosticSettings() {
    return { status: this.receiveSettingsStatus, settingPhase: this.receiveSettingsPhase, mainSwitch: this.nativeSettings?.mainSwitch ?? null,
      items: Object.fromEntries(diagnosticChannels.map(key => {
        const id = this.current?.channels.find(row => row.key === key)?.templateId;
        return [key, this.nativeSettings?.items?.[id] || 'unknown'];
      })) };
  },
  recordNativeDiagnostic(phase, result, channels, owner) {
    if (this.unloaded || this.diagnosticVisible === false || !isPrivacyAccepted() || !owner || owner !== subscriptionAccountId() || owner !== this.scopeOwner) return;
    if (channels.some(row => !this.current?.channels.some(current => current.key === row.key && current.templateId === row.templateId))) return;
    const environment = this.diagnosticEnvironment(); if (!environment) { this.clearDiagnostic(); return; }
    const states = {};
    for (const row of channels) if (diagnosticChannels.includes(row.key)) states[row.key] = ['accept', 'reject', 'ban', 'filter'].includes(result?.[row.templateId]) ? result[row.templateId] : 'unknown';
    this.diagnostic = { ...environment, settings: this.diagnosticSettings(), native: { phase, channels: states, errCode: Number.isSafeInteger(result?.errCode) && Math.abs(result.errCode) <= 999999 ? result.errCode : null, ok: result?.errMsg === 'requestSubscribeMessage:ok' } };
    this.diagnosticOwner = owner; this.diagnosticTemplateFingerprint = this.templateFingerprint(); this.setData({ diagnosticAvailable: true });
  },
  refreshDiagnosticSettings() {
    if (this.diagnostic && this.diagnosticTemplateFingerprint !== this.templateFingerprint()) { this.clearDiagnostic(); return; }
    if (this.diagnostic && !this.unloaded && this.diagnosticVisible !== false && this.diagnosticOwner === subscriptionAccountId() && isPrivacyAccepted()) this.diagnostic.settings = this.diagnosticSettings();
  },
  copyDiagnostic() {
    if (this.data.busy || this.data.loading) return;
    if (this.unloaded || this.diagnosticVisible === false || !this.data.diagnosticAvailable || !this.diagnostic || !this.diagnosticOwner || this.diagnosticOwner !== subscriptionAccountId() || this.diagnosticTemplateFingerprint !== this.templateFingerprint() || !isPrivacyAccepted()) { this.clearDiagnostic(); return; }
    if (!this.diagnosticEnvironment()) { this.clearDiagnostic(); return; }
    const owner = this.diagnosticOwner;
    try { wx.setClipboardData({ data: JSON.stringify(this.diagnostic), fail: () => this.showSubscriptionFeedback('复制失败，请重试', owner) }); }
    catch { this.showSubscriptionFeedback('复制失败，请重试', owner); }
  },
  selectChannel(event) {
    if (this.data.busy || this.data.loading || this.pending) return;
    const key = event.currentTarget.dataset.key, row = this.data.channels.find(item => item.key === key);
    if (!row?.available) return;
    this.selection[key] = !row.selected; this.updatePresentation();
  },
  toggleManagement() { if (!this.data.busy && !this.data.loading && !this.pending) this.setData({ managementOpen: !this.data.managementOpen }); },
  subscribeBrand() { this.subscribe('brand'); },
  subscribeOrder() { this.subscribe('order'); },
  subscribeSelectedGroup(event) { this.subscribe(event?.currentTarget?.dataset?.group); },
  subscribe(group) {
    if (this.data.busy || this.data.loading || this.pending || !['brand', 'order'].includes(group)) return;
    if (!this.data.loggedIn) { this.goLogin(); return; }
    if (!this.data.canSubscribe) { this.bindPhone(); return; }
    const owner = subscriptionAccountId();
    if (!owner) { this.goLogin(); return; }
    const channels = this.data.channels.filter(row => row.group === group && row.available && row.selected);
    if (!channels.length) { this.setData({ notice: '请先选择想接收的提醒。' }); return; }
    if (this.needsReceiveSettings(group)) { this.openReceiveSettings(); return; }
    const requestId = subscriptionRequestId(), expectedRevision = this.data.preferenceRevision;
    this.readVersion++; this.settingsReadVersion++; this.clearDiagnostic(); this.setData({ busy: true, error: '', notice: '' });
    // Keep the native permission call in the original user gesture.
    let nativeCompleted = false;
    requestNativeSubscriptions(channels.map(row => row.templateId)).then(async result => {
      nativeCompleted = true; this.recordNativeDiagnostic('success', result, channels, owner);
      const receipt = nativeReceipt(channels, result, requestId, expectedRevision);
      if (!receipt) { if (!this.unloaded) this.setData({ notice: '本次未开启提醒。' }); this.showSubscriptionFeedback('未开启提醒', owner); return; }
      const stored = persistPendingSubscriptionReceipt(owner, receipt);
      if (this.unloaded) return;
      if (owner !== subscriptionAccountId()) { this.restorePending(); this.setData({ error: subscriptionError(Error('SESSION_CHANGED')) }); return; }
      this.pending = receipt; this.pendingOwner = owner; this.pendingStored = stored;
      this.setData({ pendingReceipt: true }); await this.syncReceipt();
    }).catch(error => {
      if (!nativeCompleted) this.recordNativeDiagnostic('fail', error, channels, owner);
      if (!this.unloaded) this.setData({ error: subscriptionError(error) });
      const code = Number.isSafeInteger(error?.errCode) && Math.abs(error.errCode) <= 999999 ? error.errCode : null;
      const declined = /cancel|deny|reject/i.test(error?.errMsg || error?.message || '');
      this.showSubscriptionFeedback(declined ? '未开启提醒' : code === null ? '授权未完成' : `授权未完成（${code}）`, owner);
    })
      .finally(() => {
        if (!this.unloaded) this.setData({ busy: false });
        if (!this.unloaded && this.diagnosticVisible !== false && !this.settingsOpening && owner === this.scopeOwner && owner === subscriptionAccountId()) this.readReceiveSettings();
      });
  },
  showSubscriptionFeedback(title, owner) {
    if (this.unloaded || !owner || owner !== subscriptionAccountId()) return;
    try { wx.showToast({ title, icon: 'none', duration: 2200 }); } catch {}
  },
  async syncReceipt() {
    if (!this.pending) return;
    const receipt = this.pending, owner = this.pendingOwner;
    if (!owner || owner !== subscriptionAccountId()) { this.restorePending(); this.setData({ error: subscriptionError(Error('SESSION_CHANGED')) }); return; }
    try {
      const result = await saveSubscriptionReceipt(receipt);
      clearPendingSubscriptionReceipt(owner, receipt.requestId);
      if (this.unloaded || owner !== subscriptionAccountId() || this.pending?.requestId !== receipt.requestId) return;
      const feedback = subscriptionReceiptFeedback(receipt, result);
      this.pending = null; this.pendingOwner = ''; this.setCurrentSubscriptions(result);
      this.updatePresentation({ pendingReceipt: false, error: '', notice: feedback });
      const receiving = receipt.results.some(row => row.status === 'accept' && result.channels.some(channel => channel.key === row.channel && channel.available && channel.enabled && channel.remaining > 0));
      this.showSubscriptionFeedback(receiving ? '提醒已开启' : '未开启提醒', owner);
    } catch (error) {
      if (this.unloaded || this.pending?.requestId !== receipt.requestId) return;
      if (['SUBSCRIPTION_REVISION_CONFLICT', 'SUBSCRIPTION_TEMPLATE_CHANGED', 'SUBSCRIPTION_REQUEST_CONFLICT'].includes(error?.message)) {
        clearPendingSubscriptionReceipt(owner, receipt.requestId); this.pending = null; this.pendingOwner = '';
        this.setData({ pendingReceipt: false, error: subscriptionError(error) });
      } else if (['AUTH_REQUIRED', 'SESSION_CHANGED'].includes(error?.message) || owner !== subscriptionAccountId()) {
        this.restorePending(); this.setData({ error: subscriptionError(error) });
      } else this.setData({ pendingReceipt: true, error: this.pendingStored ? '微信授权结果暂未同步成功，请点击重试同步；无需再次授权。' : '本次授权暂未同步，且未能保存到本机。请留在本页重试同步；退出后请先重新读取设置核对。' });
      this.showSubscriptionFeedback(this.pending && receipt.results.some(row => row.status === 'accept') ? '授权待同步' : '未开启提醒', owner);
    }
  },
  async retryReceipt() {
    if (this.data.busy || this.data.loading || !this.pending) return;
    this.readVersion++; this.setData({ busy: true });
    try { await this.syncReceipt(); } finally { if (!this.unloaded) this.setData({ busy: false }); }
  },
  disableReminder(event) { return this.changeEnabled({ currentTarget: event.currentTarget, detail: { value: false } }); },
  async changeEnabled(event) {
    if (this.data.busy || this.data.loading || this.pending || typeof event.detail.value !== 'boolean') return;
    const key = event.currentTarget.dataset.key, row = this.data.channels.find(item => item.key === key), enabled = event.detail.value;
    if (!row || !row.available && (enabled || !row.enabled)) return;
    if (!this.data.loggedIn) { this.goLogin(); return; }
    if (enabled && !this.data.canSubscribe) { this.bindPhone(); return; }
    const owner = subscriptionAccountId();
    if (!owner) { this.goLogin(); return; }
    if (enabled && !row.remaining) { this.selection[key] = true; this.updatePresentation({ notice: '请点击开启提醒，在微信弹窗中确认。' }); return; }
    const selected = new Set(this.data.channels.filter(item => item.enabled).map(item => item.key)); enabled ? selected.add(key) : selected.delete(key);
    this.readVersion++; this.setData({ busy: true, error: '', notice: '' });
    try {
      const result = await saveSubscriptionPreferences([...selected], this.data.preferenceRevision);
      if (this.unloaded || owner !== subscriptionAccountId()) return;
      const updated = result.channels.find(item => item.key === key);
      const notice = !enabled && !updated?.enabled ? `已${row.canDisablePreference ? '移除' : '关闭'}：${row.shortTitle}。` : enabled && updated?.available && updated.enabled && updated.remaining > 0 ? `已开启：${row.shortTitle}。` : '未开启，请重新读取状态。';
      this.setCurrentSubscriptions(result); this.updatePresentation({ notice });
    } catch (error) {
      if (!this.unloaded) { if (owner !== subscriptionAccountId()) this.restorePending(); this.updatePresentation({ error: subscriptionError(error) }); }
    } finally { if (!this.unloaded) this.setData({ busy: false }); }
  },
  goLogin() { rememberMemberLoginReturn('/pages/subscriptions/index'); wx.switchTab({ url: '/pages/account/index' }); },
  bindPhone() { rememberSubscriptionPhoneReturn(); wx.switchTab({ url: '/pages/account/index' }); },
  openPrivacy() { wx.navigateTo({ url: '/pages/content/index?pageKey=miniprogram-privacy' }); },
}, ["load","goLogin","bindPhone","selectChannel","subscribeSelectedGroup","copyDiagnostic","retryReceipt","toggleManagement","disableReminder","openPrivacy"]));

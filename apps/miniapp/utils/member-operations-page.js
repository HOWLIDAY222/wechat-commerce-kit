import { fetchMemberOperations, memberOperation } from '../services/member-operations';
import { operationsPresentation, memberOperationsError } from '../models/member-operations';
import { hasSession, readStoredUser } from '../stores/session';
import { rememberMemberLoginReturn } from '../stores/navigation';

export function operationsPage({ route, initialize, loaded } = {}) {
  return {
    data: { overview: null, loading: false, busy: false, guest: false, syncFailed: false, error: '', notice: '' },
    onLoad(options = {}) { this.returnRoute = route; this.options = options; if (initialize) initialize.call(this, options); },
    onShow() { this.disposed = false; this.loadOperations(); },
    onUnload() { this.disposed = true; this.loadGeneration = (this.loadGeneration || 0) + 1; },
    onPullDownRefresh() { this.loadOperations().finally(() => wx.stopPullDownRefresh()); },
    async loadOperations() {
      if (this.disposed) return false;
      const generation = (this.loadGeneration || 0) + 1; this.loadGeneration = generation;
      if (!hasSession()) { this.setData({ overview: null, guest: true, loading: false, syncFailed: false, error: '' }); return false; }
      const identity = readStoredUser()?.id || '';
      if (this.overviewIdentity !== undefined && this.overviewIdentity !== identity) this.setData({ overview: null, postText: '', commentText: '', commentPostId: '', school: '', graduationYear: '', note: '', contactNote: '', answers: {}, confirmed: false, preparedShare: null, result: null });
      this.setData({ loading: true, guest: false, error: '' });
      try {
        const value = operationsPresentation(await fetchMemberOperations());
        if (this.disposed || this.loadGeneration !== generation) return false;
        if (identity !== (readStoredUser()?.id || '')) { this.setData({ overview: null, syncFailed: true, error: '账户已变化，请重新加载会员信息。' }); return false; }
        this.overviewIdentity = identity;
        this.setData({ overview: value, syncFailed: false });
        if (loaded) await loaded.call(this, value);
        return true;
      } catch (error) {
        if (!this.disposed && this.loadGeneration === generation) this.setData({ error: memberOperationsError(error), syncFailed: true });
        return false;
      } finally { if (!this.disposed && this.loadGeneration === generation) this.setData({ loading: false }); }
    },
    goLogin() { rememberMemberLoginReturn(this.returnRoute || route); wx.switchTab({ url: '/pages/account/index' }); },
    joinMember() { wx.navigateTo({ url: '/pages/member/index' }); },
    canOperate() { return !this.disposed && hasSession() && this.overviewIdentity === (readStoredUser()?.id || '') && !this.data.busy && !this.data.loading && !this.data.syncFailed && !this.data.guest && !!this.data.overview?.registered; },
    async performOperation(action, payload, notice) {
      if (!this.canOperate()) return null;
      this.lastOperationError = null;
      this.setData({ busy: true, error: '', notice: '' });
      try {
        const result = await memberOperation(action, payload);
        if (this.disposed) return result;

        const synced = await this.loadOperations();
        if (!this.disposed) this.setData({ notice: notice || '操作已保存。', ...(synced ? {} : { error: '操作已保存，列表暂未刷新，请重新加载核对。' }) });
        return result;
      } catch (error) { this.lastOperationError = error; if (!this.disposed) this.setData({ error: memberOperationsError(error) }); return null; }
      finally { if (!this.disposed) this.setData({ busy: false }); }
    },
    openRoute(event) {
      const url = event?.currentTarget?.dataset?.route;
      if (typeof url === 'string' && /^\/pages\/member-(?:earn|invite|lottery|student|surveys|community|profile)\/index(?:\?[^#]*)?$/.test(url)) wx.navigateTo({ url });
    },
    goShopping() { wx.switchTab({ url: '/pages/products/index' }); },
    openPoints() { wx.navigateTo({ url: '/pages/member/index?section=points' }); },
    openWallet() { wx.navigateTo({ url: '/pages/member/index?section=wallet' }); },
    openProfile() { wx.navigateTo({ url: '/pages/member-profile/index' }); },
  };
}

function pendingKey(kind) {
  const id = readStoredUser()?.id;
  return typeof id === 'string' && id.length > 0 && id.length <= 100 ? `merchantkit.member.pending.${kind}.${id}` : '';
}
export function readPendingMemberAction(kind) {
  const key = pendingKey(kind); if (!key) return null;
  try { const value = wx.getStorageSync(key); return value && typeof value.requestId === 'string' && typeof value.target === 'string' ? value : null; } catch { return null; }
}
export function savePendingMemberAction(kind, value) { const key = pendingKey(kind); if (key) { try { wx.setStorageSync(key, value); } catch { /* In-memory request still prevents duplicate retries on this page. */ } } }
export function clearPendingMemberAction(kind) { const key = pendingKey(kind); if (key) { try { wx.removeStorageSync(key); } catch { /* A replay uses the same request and cannot debit twice. */ } } }

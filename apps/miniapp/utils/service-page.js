import { withTapFeedback } from './tap-feedback';
import { hasSession, readAccessToken } from '../stores/session';
import { isPrivacyAccepted } from '../stores/privacy-consent';
import { rememberMemberLoginReturn } from '../stores/navigation';
import { fetchCurrentUser } from '../services/auth';

export function servicePage(route, definition, handlers = []) {
  return withTapFeedback({
    ...definition,
    data: { checking: true, authorized: false, accessError: '', ...definition.data },
    onLoad(options) { this.disposed = false; definition.onLoad?.call(this, options); },
    onShow() { return this.checkAccess(); },
    onHide() { this.invalidate(); definition.onHide?.call(this); },
    onUnload() { this.disposed = true; this.invalidate(); definition.onUnload?.call(this); },
    invalidate() {
      this.accessId = (this.accessId || 0) + 1;
      if (!this.disposed) { this.setData({ authorized: false }); definition.onInvalidate?.call(this); }
    },
    hasAccess() { return hasSession() && isPrivacyAccepted(); },
    requestIsCurrent(id) { return !this.disposed && this.accessId === id && this.data.authorized; },
    ensureServiceAccess() {
      if (!this.data.authorized) return false;
      if (!this.hasAccess() || readAccessToken() !== this.identityToken) { this.requireLogin(); return false; }
      return true;
    },
    requireLogin() {
      this.invalidate(); this.setData({ checking: false, accessError: '' });
      rememberMemberLoginReturn(route);
      if (this.loginNavigating) return;
      this.loginNavigating = true;
      const fail = () => { if (!this.disposed) this.setData({ accessError: '登录页暂时无法打开，请重试。' }); };
      try { wx.switchTab({ url: '/pages/account/index', fail, complete: () => { this.loginNavigating = false; } }); }
      catch { this.loginNavigating = false; fail(); }
    },
    async checkAccess() {
      const id = (this.accessId || 0) + 1; this.accessId = id;
      definition.onInvalidate?.call(this);
      this.setData({ checking: true, authorized: false, accessError: '' });
      if (!this.hasAccess()) { this.requireLogin(); return; }
      const token = readAccessToken();
      try {
        await fetchCurrentUser();
        if (this.disposed || this.accessId !== id) return;
        if (!this.hasAccess() || readAccessToken() !== token) { this.requireLogin(); return; }
      } catch (error) {
        if (this.disposed || this.accessId !== id) return;
        if (!this.hasAccess() || error?.statusCode === 401 || error?.message === 'AUTH_REQUIRED') { this.requireLogin(); return; }
        this.setData({ checking: false, accessError: '暂时无法连接，请重试。' }); return;
      }
      this.identityToken = token; this.setData({ authorized: true, checking: false });
      return definition.onAuthorized?.call(this);
    },
  }, ['checkAccess', ...handlers]);
}

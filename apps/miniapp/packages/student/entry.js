import { withTapFeedback } from '../../utils/tap-feedback';
import { operationsPage } from '../../utils/member-operations-page';
import { hasSession, readStoredUser } from '../../stores/session';
import { createMemberRequestId } from '../../models/member-operations';
import { verifyStudentIdentity, studentVerificationError } from '../../services/member-student';
const lifecycle = operationsPage({ route: '/pages/member-student/index' });
Page(withTapFeedback({
  ...lifecycle,
  data: { ...lifecycle.data, showStudentVerifyDialog: false, hasCode: false },
  onLoad(options) { lifecycle.onLoad.call(this, options); this.checkPluginUpdate(); },
  loadOperations() {
    const owner = hasSession() ? readStoredUser()?.id || '' : '';
    if (owner !== this.studentOwner) { this.studentOwner = owner; this.studentGeneration = (this.studentGeneration || 0) + 1; this.activeCode = ''; this.requestId = ''; this.setData({ busy: false, hasCode: false, showStudentVerifyDialog: false, notice: '', error: '' }); }
    return lifecycle.loadOperations.call(this).then(loaded => {
      if (loaded && this.options.start === '1' && !this.autoStarted && this.canOperate()) { this.autoStarted = true; this.startVerification(); }
      return loaded;
    });
  },
  onUnload() { this.studentGeneration = (this.studentGeneration || 0) + 1; this.activeCode = ''; lifecycle.onUnload.call(this); },
  sameOwner(owner, generation) { return !this.disposed && hasSession() && owner === readStoredUser()?.id && generation === this.studentGeneration; },
  startVerification() {
    if (!this.canOperate()) return;
    if (this.activeCode && this.data.hasCode) { this.checkIdentity(); return; }
    this.activeCode = '';
    this.setData({ showStudentVerifyDialog: true, error: '', notice: '' });
  },
  onStudentVerifyAuth(event) {
    const code = event?.detail?.wx_studentcheck_code;
    if (!this.canOperate() || typeof code !== 'string' || !code || code.length > 1024 || /[\s\u0000-\u001f\u007f]/.test(code)) return;
    this.activeCode = code; this.codeAt = Date.now(); this.closeRetryCount = 0; this.requestId = createMemberRequestId(); this.setData({ hasCode: true }); this.checkIdentity();
  },
  onStudentVerifyClose() { this.setData({ showStudentVerifyDialog: false }); if (this.activeCode) { if (this.data.busy) this.checkAfterClose = true; else this.checkIdentity(); } },
  onStudentVerifyReject() { this.activeCode = ''; this.setData({ hasCode: false, showStudentVerifyDialog: false, notice: '未授权学生身份，仍可使用其他会员服务。' }); },
  async checkIdentity() {
    if (this.data.busy || !this.activeCode || !this.canOperate()) return;
    if (Date.now() - this.codeAt >= 2 * 3600000) { this.activeCode = ''; this.setData({ hasCode: false, error: '授权已过期，请重新验证。' }); return; }
    const owner = this.studentOwner, generation = this.studentGeneration;
    this.setData({ busy: true, error: '', notice: '' });
    let status = '';
    try {
      const result = await verifyStudentIdentity(this.activeCode, this.requestId);
      if (!this.sameOwner(owner, generation)) return;
      status = result.status;
      if (status === 'VERIFIED' || status === 'TEST_VERIFIED') {
        this.activeCode = ''; this.checkAfterClose = false; this.setData({ hasCode: false, showStudentVerifyDialog: false });
        wx.navigateBack({ fail: () => wx.redirectTo({ url: '/pages/member-student/index' }) });
      } else this.setData({ hasCode: status === 'PENDING', notice: status === 'PENDING' ? '微信正在审核，稍后可查询认证状态。' : status === 'UNBOUND' ? '尚未完成学生身份绑定，请在微信认证中继续。' : '微信核验结果：当前未通过学生身份验证。' });
    } catch (error) {
      if (!this.sameOwner(owner, generation)) return;
      if (error?.message === 'WECHAT_STUDENT_CODE_INVALID') { this.activeCode = ''; this.setData({ hasCode: false }); }
      this.setData({ error: studentVerificationError(error) });
    } finally {
      if (this.sameOwner(owner, generation)) {
        this.setData({ busy: false });
        if (this.checkAfterClose && this.activeCode && (this.closeRetryCount || 0) < 1) { this.checkAfterClose = false; this.closeRetryCount = (this.closeRetryCount || 0) + 1; this.checkIdentity(); }
        else this.checkAfterClose = false;
      }
    }
  },
  checkPluginUpdate() {
    if (typeof wx.getPluginUpdateManager !== 'function' || typeof wx.getUpdateManager !== 'function') return;
    try {
      const manager = wx.getPluginUpdateManager({ pluginId: 'wxa16657d57059e0f0' });
      manager.onUpdateReady(() => { if (!this.disposed && !this.data.busy && !this.activeCode && !this.data.showStudentVerifyDialog) wx.getUpdateManager().applyUpdate(); });
      manager.onUpdateFailed(() => { if (!this.disposed) this.setData({ error: '认证组件更新失败，请重新进入后再试。' }); });
    } catch { /* Older WeChat versions can still display the provider's upgrade prompt. */ }
  },
}, ["goLogin","joinMember","startVerification"]));

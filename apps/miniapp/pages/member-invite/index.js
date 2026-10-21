import { withTapFeedback } from '../../utils/tap-feedback';
import { operationsPage } from '../../utils/member-operations-page';
import { capturePendingReferral, maybeBindPendingReferral, pendingReferralStatus } from '../../utils/member-referral';
import { memberOperation } from '../../services/member-operations';
import { hasSession, readStoredUser } from '../../stores/session';

const inviteShareImage = '/assets/brand/member-invite-share.jpg';
const validCode = value => typeof value === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(value);
const currentTask = overview => { const tasks = (overview?.tasks || []).filter(task => task?.key === 'INVITE'); return tasks.length === 1 ? tasks[0] : null; };
const invitePage = operationsPage({ route: '/pages/member-invite/index', initialize(options) {
  this.incomingCode = validCode(options.referralCode) ? options.referralCode : '';
  this.returnRoute = '/pages/member-invite/index' + (this.incomingCode ? '?referralCode=' + encodeURIComponent(this.incomingCode) : '');
  if (this.incomingCode) this.showReferralStatus(capturePendingReferral(this.incomingCode));
  this.setData({ incomingInvitation: !!this.incomingCode });
}, loaded(overview) { const task=currentTask(overview),summary=overview.referral?.rewardSummary;
  this.setData({ inviteTask: task, inviteReady: validCode(overview.referral?.code), inviteBenefitsVisible:!!(task?.enabled&&summary?.enabled),
    registrationRewardCount:Number.isSafeInteger(summary?.registrationRewardCount)?summary.registrationRewardCount:0,
    registrationRewardLimit:Number.isSafeInteger(summary?.registrationRewardLimit)?summary.registrationRewardLimit:0,
    purchaseCouponCount:Number.isSafeInteger(summary?.purchaseCouponCount)?summary.purchaseCouponCount:0 }); } });

Page(withTapFeedback({
  ...invitePage,
  data: { overview: null, loading: false, busy: false, guest: false, syncFailed: false, error: '', notice: '', inviteTask: null,
    incomingInvitation: false, inviteReady: false, preparingInvite: false, invitePrepareFailed: false, autoProcessing: false, referralText: '', referralError: '', referralCanRetry: false,
    inviteBenefitsVisible:false,registrationRewardCount:0,registrationRewardLimit:0,purchaseCouponCount:0 },
  sameInviteAccount(owner) { try { return !this.disposed && hasSession() && !!owner && owner === readStoredUser()?.id && owner === this.overviewIdentity; } catch { return false; } },
  async loadOperations() {
    const loaded = await invitePage.loadOperations.call(this);
    if (!loaded) return false;
    if (this.inviteFlowRunning) {
      if (this.overviewIdentity !== this.inviteFlowOwner && !validCode(this.data.overview?.referral?.code)) this.setData({ invitePrepareFailed: true });
      return true;
    }
    const owner = this.overviewIdentity;
    this.inviteFlowRunning = true; this.inviteFlowOwner = owner; this.setData({ autoProcessing: true });
    try {
      const wasBound = this.data.overview?.referral?.bound;
      const result = await maybeBindPendingReferral();
      if (!this.sameInviteAccount(owner)) return false;
      this.showReferralStatus(result);
      if (['bound', 'already_bound'].includes(result.status) && !wasBound) await invitePage.loadOperations.call(this);
      if (this.sameInviteAccount(owner)) await this.prepareOwnInvitation();
      return true;
    } finally { this.inviteFlowRunning = false; if (!this.disposed) this.setData({ autoProcessing: false }); }
  },
  async prepareOwnInvitation() {
    if (!this.canOperate() || currentTask(this.data.overview)?.enabled !== true) return;
    if (validCode(this.data.overview.referral?.code)) { this.setData({ inviteReady: true, invitePrepareFailed: false }); return; }
    const owner = this.overviewIdentity;
    if (this.preparationTriedIdentity === owner) return;
    this.preparationTriedIdentity = owner;
    this.setData({ busy: true, preparingInvite: true, invitePrepareFailed: false, error: '' });
    try {
      const result = await memberOperation('create_referral');
      if (!this.sameInviteAccount(owner)) return;
      if (!validCode(result.code)) throw Error('INVALID_MEMBER_OPERATION_RESPONSE');
      const synced = await invitePage.loadOperations.call(this);
      if (this.sameInviteAccount(owner) && (!synced || !validCode(this.data.overview?.referral?.code))) this.setData({ inviteReady: false, invitePrepareFailed: true, error: '' });
    } catch {
      if (this.sameInviteAccount(owner)) this.setData({ inviteReady: false, invitePrepareFailed: true });
    } finally { if (!this.disposed) this.setData({ busy: false, preparingInvite: false }); }
  },
  async retryInvitePreparation() {
    if (this.data.busy || this.data.loading || this.inviteFlowRunning) return;
    this.preparationTriedIdentity = ''; await this.loadOperations();
  },
  showReferralStatus(result) {
    const messages = { bound: '邀请关系已建立。', already_bound: '已保留原邀请关系。' };
    const errors = { retry: '邀请暂未绑定，请重试。', ineligible: '当前账户不符合新会员邀请条件。', invalid: '这份邀请无法使用。', account_changed: '账户已更换，原邀请未绑定。', storage_failed: '邀请未保存，请留在本页重试。' };
    this.setData({ referralText: messages[result.status] || '', referralError: errors[result.status] || '', referralCanRetry: ['retry', 'storage_failed'].includes(result.status) });
  },
  async retryReferral() {
    if (this.data.busy || this.data.loading || this.inviteFlowRunning) return;
    this.setData({ busy: true });
    const owner = readStoredUser()?.id;
    try { const result = await maybeBindPendingReferral({ retry: true, allowMemory: true }); if (!this.disposed && owner === readStoredUser()?.id) this.showReferralStatus(result); }
    finally { if (!this.disposed) this.setData({ busy: false }); }
    if (!this.disposed) await this.loadOperations();
  },
  goLogin() {
    if (pendingReferralStatus().status === 'storage_failed') this.showReferralStatus({ status: 'storage_failed' });
    invitePage.goLogin.call(this);
  },
  joinMember() {
    if (pendingReferralStatus().status === 'storage_failed') this.showReferralStatus({ status: 'storage_failed' });
    invitePage.joinMember.call(this);
  },
  onShareAppMessage() {
    const tasks = this.data.overview?.tasks;
    const inviteTasks = Array.isArray(tasks) ? tasks.filter(task => task?.key === 'INVITE') : [];
    const task = inviteTasks.length === 1 ? inviteTasks[0] : null;
    const candidate = this.data.overview?.referral?.code;
    const code = this.canOperate() && typeof this.overviewIdentity === 'string' && this.overviewIdentity.length > 0
      && task?.enabled === true && ['AVAILABLE', 'PENDING', 'COMPLETED', 'LIMIT_REACHED'].includes(task.state)
      && typeof candidate === 'string' && /^[A-Za-z0-9_-]{6,80}$/.test(candidate) ? candidate : '';
    return { title: code ? '邀请你加入 MerchantKit 会员' : 'MerchantKit', imageUrl: inviteShareImage,
      path: code ? '/pages/member-invite/index?referralCode=' + encodeURIComponent(code) : '/pages/home/home' };
  },
}, ["goLogin","loadOperations","retryReferral","joinMember","retryInvitePreparation"]));

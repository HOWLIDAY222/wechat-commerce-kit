import { withTapFeedback } from '../../utils/tap-feedback';
import { fetchMember, memberAction } from '../../services/member';
import { hasSession } from '../../stores/session';
import { rememberMemberLoginReturn } from '../../stores/navigation';
import { maybeBindPendingReferral } from '../../utils/member-referral';

Page(withTapFeedback({
  data: {
    loading: true, error: '', overview: null, busy: false, syncFailed: false,
    activeTab: 'wallet', walletFilter: 'current', accepted: false, walletOnly: false,
    fromNewcomer:false, fromCheckout: false, showWallet: true, showClaim: false, showPoints: false,
    showRules: false, showLedger: false, showAllEntries: false, notice: '',
  },
  onLoad(options = {}) {
    const activeTab = ['wallet', 'claim', 'points'].includes(options.section) ? options.section : 'wallet';
    this.setMemberView(null, { activeTab, walletOnly: options.section === 'wallet', fromNewcomer:options.section==='newcomer', fromCheckout: options.from === 'checkout' });
  },
  onShow() { this.loadMember(); },
  onPullDownRefresh() { this.loadMember().finally(() => wx.stopPullDownRefresh()); },
  setMemberView(overview = this.data.overview, patch = {}) {
    const state = { ...this.data, ...patch };
    this.setData({ ...patch, overview, ...memberPresentation(overview, state) });
  },
  async loadMember() {
    if (!hasSession()) {
      rememberMemberLoginReturn(`/pages/member/index?section=${this.data.fromNewcomer?'newcomer':this.data.activeTab}${this.data.fromCheckout ? '&from=checkout' : ''}`);
      this.setMemberView(null, { loading: false });
      wx.switchTab({ url: '/pages/account/index' });
      return false;
    }
    const loadId = (this.loadId || 0) + 1; this.loadId = loadId;
    this.setData({ loading: true, error: '' });
    try {
      const overview = await fetchMember();
      if (this.loadId !== loadId) return false;
      this.setMemberView(overview, { syncFailed: false });
      return true;
    } catch (error) {
      if (this.loadId === loadId) this.setData({ error: memberError(error?.message), syncFailed: true });
      return false;
    } finally { if (this.loadId === loadId) this.setData({ loading: false }); }
  },
  toggleConsent(event) { this.setData({ accepted: event.detail.value.includes('accepted') }); },
  changeTab(event) { this.selectTab(event.currentTarget.dataset.tab); },
  selectTab(activeTab) {
    if (!['wallet', 'claim', 'points'].includes(activeTab)) return;
    this.setMemberView(this.data.overview, { activeTab, notice: '' });
  },
  openWallet() { this.setMemberView(this.data.overview, {activeTab:'wallet',walletFilter:'current',notice:''}); wx.pageScrollTo?.({ scrollTop: 0, duration: 160 }); },
  openPoints() { this.selectTab('points'); wx.pageScrollTo?.({ scrollTop: 0, duration: 160 }); },
  changeWalletFilter(event) { this.setMemberView(this.data.overview, { walletFilter: event.currentTarget.dataset.filter }); },
  toggleRules() { this.setData({ showRules: !this.data.showRules }); },
  toggleLedger() { this.setData({ showLedger: !this.data.showLedger }); },
  toggleAllEntries() { this.setMemberView(this.data.overview, { showAllEntries: !this.data.showAllEntries }); },
  async claimNewcomer(){if(this.data.overview?.newcomer?.claimed){this.openWallet();return;}await this.perform('newcomer');},
  async join() { if (this.data.accepted) await this.perform('join'); },
  async claim(event) {
    const id = event.currentTarget.dataset.id;
    if (this.data.overview?.available?.find(item => item.templateId === id)?.claimed) { this.openWallet(); return; }
    await this.perform('claim', id);
  },
  async redeem(event) {
    if (this.data.busy || this.data.loading || this.data.syncFailed) return;
    const id = event.currentTarget.dataset.id, reward = this.data.overview?.rewards?.find(item => item.templateId === id);
    if (!reward || !this.data.overview.member || reward.claimed || reward.soldOut || !reward.eligible || !reward.canAfford) return;
    if (this.pendingRedemption && this.pendingRedemption.templateId !== id) { this.setData({ error: '上次兑换结果尚未确认，请先刷新我的券核对。' }); return; }
    this.setData({ busy: true, error: '', notice: '' });
    try {
      const decision = await new Promise((resolve, reject) => wx.showModal({ title: '确认兑换优惠券', content: `扣除 ${reward.pointsCost} 积分，兑换「${reward.title}」。优惠券将存入「我的券」。${reward.longTerm?'长期有效，每单一张，不抵运费、不找零。':'到期不退积分。'}`, confirmText: '确认兑换', success: resolve, fail: reject }));
      if (!decision.confirm) return;
      this.pendingRedemption ||= { templateId: id, requestId: createRequestId() };
      await memberAction('redeem', id, this.pendingRedemption.requestId);
      this.pendingRedemption = null;
      await this.showActionResult('兑换成功，优惠券已存入「我的券」。', '兑换已完成，卡包暂未刷新。请重新加载后查看，勿重复兑换。');
    } catch (error) { this.setData({ error: memberError(error?.message) }); }
    finally { this.setData({ busy: false }); }
  },
  async perform(action, id) {
    if (this.data.busy || this.data.loading || this.data.syncFailed) return;
    this.setData({ busy: true, error: '', notice: '' });
    try {
      await memberAction(action, id);
      if (action === 'join') void maybeBindPendingReferral().catch(() => {});
      await this.showActionResult(action==='newcomer'?'新客礼已到账，优惠券和积分可在会员中心查看。':action === 'join' ? '欢迎加入品牌会员，已到账权益可在下方查看。' : '领取成功，优惠券已存入「我的券」。', '操作已完成，权益暂未刷新。请重新加载后核对。');
    } catch (error) { this.setData({ error: memberError(error?.message) }); }
    finally { this.setData({ busy: false }); }
  },
  async showActionResult(notice, refreshError) {
    const synced = await this.loadMember();
    if (!synced) { this.setData({ error: refreshError }); return; }
    this.setMemberView(this.data.overview, { activeTab: 'wallet', walletFilter: 'current', notice });
    wx.pageScrollTo?.({ scrollTop: 0, duration: 160 });
  },
  goAccount() { wx.switchTab({ url: '/pages/account/index' }); },
  openGifts() { wx.navigateTo({url:'/pages/gifts/index'}); },
  goShopping() {
    if(this.data.busy || this.data.loading)return;
    if (this.data.fromCheckout) {
      const pages = getCurrentPages();
      if (pages.length > 1 && pages[pages.length - 2].route === 'pages/checkout/index') { wx.navigateBack({ delta: 1 }); return; }
      wx.navigateTo({ url: '/pages/checkout/index' }); return;
    }
    wx.switchTab({ url: '/pages/products/index' });
  },
  openOrder(event) { wx.navigateTo({ url: `/pages/order-detail/index?orderNo=${encodeURIComponent(event.currentTarget.dataset.no)}` }); },
}, ["goShopping","openGifts","loadMember","claimNewcomer","openWallet","openPoints","join","changeTab","changeWalletFilter","openOrder","claim","redeem","toggleLedger","toggleAllEntries","toggleRules","goAccount"]));

function memberPresentation(overview, state) {
  const wallet = overview?.wallet || [], available = overview?.available || [], rewards = overview?.rewards || [];
  const current = wallet.filter(c => ['AVAILABLE', 'HELD'].includes(c.status));
  const history = wallet.filter(c => !['AVAILABLE', 'HELD'].includes(c.status));
  const walletItems = state.walletFilter === 'history' ? history : current;
  const rewardItems = rewards.filter(c => !c.claimed);
  const entries = overview?.points?.entries || [];
  return {
    showWallet: state.activeTab === 'wallet', showClaim: state.activeTab === 'claim', showPoints: state.activeTab === 'points',
    walletItems, walletEmpty: walletItems.length === 0, walletCurrentCount: current.length, walletHistoryCount: history.length,
    walletCurrent: state.walletFilter !== 'history', walletHistory: state.walletFilter === 'history',
    claimItems: available, claimsEmpty: available.length === 0, rewardItems, rewardsEmpty: rewardItems.length === 0,
    hasRedeemedRewards: rewards.some(c => c.claimed), pointsPaused: overview?.points?.rule?.enabled !== true,
    ledgerItems: (state.showAllEntries ? entries : entries.slice(0, 5)).map(e => ({ ...e, deltaLabel: e.delta > 0 ? `+${e.delta}` : String(e.delta), dateLabel: e.createdAt ? String(e.createdAt).slice(0, 10) : '' })),
    ledgerEmpty: entries.length === 0, ledgerHasMore: entries.length > 5, ledgerCount: entries.length,
  };
}

function memberError(code) {
  return ({ AUTH_REQUIRED: '请返回个人中心重新登录。', SESSION_CHANGED: '账户已变化，请重新进入会员中心。',
    MEMBER_PHONE_REQUIRED: '请先到个人中心绑定手机号，再加入会员。', MEMBERSHIP_REQUIRED: '请先加入会员。',
    COUPON_UNAVAILABLE: '这张券暂时无法领取，请刷新查看。', COUPON_NEWCOMER_ONLY: '这张券仅限没有成功支付记录的会员。',
    NEWCOMER_UNAVAILABLE:'新客活动暂未开放，请稍后查看。',NEWCOMER_ALREADY_CLAIMED:'此手机号已经领取过新客礼，请查看原账号权益。',COUPON_MEMBER_LIMIT:'此券已达到每人兑换上限，请刷新查看。',COUPON_SOLD_OUT: '这张券已领完，请看看其他权益。', POINTS_INSUFFICIENT: '积分不足，请刷新余额。', MEMBER_REQUEST_CHANGED: '兑换资料已变化，请刷新我的券核对结果。', COUPON_DELIVERY_FORBIDDEN: '此券无法通过该方式领取。', MEMBER_CUSTOMER_REQUIRED: '当前账户暂不能办理顾客会员权益，请联系客服。',
  })[code] || '暂时无法同步会员信息，请稍后重试。';
}
function createRequestId() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16); }); }

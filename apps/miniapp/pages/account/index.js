import { withTapFeedback } from '../../utils/tap-feedback';
import {fetchMember,fetchMemberPromotions} from '../../services/member';
import {
  fetchCurrentUser,
  getCachedUser,
  linkPhoneToAccount,
  linkWeChatPhone,
  loginWithWeChat,
  logout,
  sendPhoneLinkCode,
} from '../../services/auth';
import { hasSession } from '../../stores/session';
import { config } from '../../config/index';
import { syncGuestCart } from '../../services/guest-sync';
import { consumeMemberLoginReturn } from '../../stores/navigation';
import { navigateToManagedPage } from '../../utils/navigation';
import { consumeProfileAccountReturn, fetchMemberProfile } from '../../services/member-profile';
import { downloadMemberAvatar } from '../../services/member-avatar';
import { fetchMemberOperations } from '../../services/member-operations';
import { operationsPresentation, safeQrImage } from '../../models/member-operations';
import { consumeSubscriptionPhoneReturn, clearSubscriptionPhoneReturn } from '../../stores/subscription-phone-return';
import { enterpriseContact } from '../../config/enterprise-contact';
import { maybeBindPendingReferral } from '../../utils/member-referral';
import { isPrivacyAccepted } from '../../stores/privacy-consent';
import { openPrivacyPage, requireNativePrivacy } from '../../utils/privacy-flow';

const accountEntries = [
  { label: '包裹服务', description: '尺码、洗护、会员与售后', route: '/pages/package-service/index' },
  { label: '会员资料', description: '管理姓名、生日与个人资料', route: '/pages/member-profile/index' },
  { label: '消息订阅', description: '按需接收上新、补货与活动提醒', route: '/pages/subscriptions/index' },
  { label: '商品礼品卡', description: '赠送心意，领取后选尺码与地址', route: '/pages/gifts/index' },
  { label: '我的尺码档案', description: '身体数据与穿着偏好，两端同步', route: '/pages/fit-profile/index' },

  { label: '收藏商品', description: '查看心仪的商品', route: '/pages/favorites/index' },
  { label: '收货地址', description: '管理常用收货地址', route: '/pages/addresses/index' },

];

Page(withTapFeedback({
  data: {
    accountEntries,
    newcomerOffer: null,
    promotions: null,
    memberDisplayName: '',
    memberAvatarPath: '',
    memberPoints: '—',
    memberCouponCount: '—',
    memberSummaryLoaded: false,
    operations: null,
    enterpriseContactConfigured: enterpriseContact.enabled && /^[a-f0-9]{32}$/.test(enterpriseContact.configId),
    memberBanner: config.apiBaseUrl + '/assets/catalog/x1-air-white/vk-20261014/product-front-750.webp',
    memberEarnBanner: config.apiBaseUrl + '/assets/catalog/x1-air-white/vk-20261014/mesh-panel-750.webp',
    memberStudentBanner: config.apiBaseUrl + '/assets/catalog/x1-air-white/vk-20261014/fabric-texture-750.webp',
    accountEnabled: config.accountEnabled,
    privacyAccepted: false,
    consented: false,
    crossBorderConsented: false,
    error: '',
    loading: false,
    phoneAuthorizing: false,
    phoneConsent: false,
    realtimePhoneSupported: typeof wx.canIUse === 'function' && wx.canIUse('button.open-type.getRealtimePhoneNumber'),
    loggedIn: false,
    refreshing: false,
    user: null,
    phoneLinkOpen: false,
    otherLoginOpen: false,
    loginOpen: false,
    loginReturnHint: '',
    phone: '',
    smsCode: '',
    smsSending: false,
    smsVerifying: false,
    smsSent: false,
    devCode: '',
    isLocalPreview: config.isDevelopment,
  },

  showLogin() { if (!isPrivacyAccepted()) { openPrivacyPage(); return; } this.setData({ loginOpen: true }); wx.pageScrollTo({ selector: '.login-card', duration: 250 }); },
  startMemberRegistration() { this.loginReturnRoute = '/pages/member-profile/index'; this.setData({ loginReturnHint: '登录后继续完善会员资料。' }); this.showLogin(); },
  openProfile() { wx.navigateTo({ url: '/pages/member-profile/index' }); },
  openXiaohongshu() { wx.navigateTo({ url: '/pages/member-community/index?tab=follow' }); },
  onMemberAvatarError() { this.setData({ memberAvatarPath: '' }); },
  openMemberOperation(event) { const route = event.currentTarget.dataset.route; if (/^\/pages\/member-(?:earn|invite|lottery|student|surveys|community)\/index$/.test(route)) wx.navigateTo({ url: route }); },
  openAccountQr(event) { const key=event.currentTarget.dataset.key;if(!['officialAccount','enterpriseContact'].includes(key))return;const value=this.data.operations?.[key];if(value?.enabled&&safeQrImage(value.qrImageUrl))wx.previewImage({current:value.qrImageUrl,urls:[value.qrImageUrl]}); },
  async loadMemberSummary() {
    const loadId = this.memberSummaryLoadId = (this.memberSummaryLoadId || 0) + 1;
    if (!hasSession()) { this.setData({memberDisplayName:'',memberAvatarPath:'',memberPoints:'—',memberCouponCount:'—',memberSummaryLoaded:false,operations:null}); return; }
    const identity = getCachedUser()?.id;
    if (this.memberAvatarOwner !== identity) { this.memberAvatarOwner = identity; this.setData({ memberAvatarPath: '' }); }
    const results = await Promise.allSettled([fetchMember(), fetchMemberProfile(), fetchMemberOperations()]);
    if (loadId !== this.memberSummaryLoadId || !hasSession() || identity !== getCachedUser()?.id) return;
    const patch = {};
    if (results[0].status === 'fulfilled') { const value=results[0].value;patch.memberPoints=Number.isSafeInteger(value?.points?.balance)&&value.points.balance>=0?value.points.balance:'—';patch.memberCouponCount=Number.isSafeInteger(value?.availableCount)?value.availableCount:'—';patch.memberSummaryLoaded=true; }
    else { patch.memberPoints='—';patch.memberCouponCount='—';patch.memberSummaryLoaded=false; }
    patch.memberDisplayName = results[1].status === 'fulfilled' ? results[1].value.profile.displayName : '';
    patch.operations = results[2].status === 'fulfilled' ? operationsPresentation(results[2].value) : null;
    this.setData(patch);
    if (results[1].status === 'fulfilled') {
      try {
        const memberAvatarPath = await downloadMemberAvatar(results[1].value.avatar);
        if (loadId === this.memberSummaryLoadId && hasSession() && identity === getCachedUser()?.id) this.setData({ memberAvatarPath });
      } catch { if (loadId === this.memberSummaryLoadId && identity === getCachedUser()?.id) this.setData({ memberAvatarPath: '' }); }
    } else this.setData({ memberAvatarPath: '' });
  },
  openMember() { this.openMemberSection('wallet'); },
  openMemberBenefit(event) { this.openMemberSection(event.currentTarget.dataset.section); },
  openNewcomer() { this.openMemberSection('newcomer'); },
  openMemberSection(section) {
    if (!['wallet','claim','points','newcomer'].includes(section)) return;
    const route = '/pages/member/index?section=' + section;
    if (!this.data.loggedIn) {
      this.loginReturnRoute = route;
      this.setData({loginReturnHint: section === 'newcomer' ? '登录后继续领取新客礼。' : section === 'points' ? '登录后查看积分与兑换权益。' : section === 'claim' ? '登录后继续领取优惠券。' : '登录后查看我的优惠券。'});
      this.showLogin(); return;
    }
    wx.navigateTo({url:route});
  },
  async loadMemberPromotions() {
    const loadId = this.promotionsLoadId = (this.promotionsLoadId || 0) + 1;
    try {
      const result = await fetchMemberPromotions();
      if (this.promotionsLoadId === loadId) this.setData({newcomerOffer:result.newcomer,promotions:result.promotions});
    } catch {
      if (this.promotionsLoadId === loadId) this.setData({newcomerOffer:null,promotions:null});
    }
  },
  clearSubscriptionPhoneNavigation() {
    clearSubscriptionPhoneReturn(); this.subscriptionPhoneReturnOwner = undefined;
    if (this.loginReturnRoute === '/pages/subscriptions/index') { this.loginReturnRoute = ''; this.profileReturnAfterPhone = false; }
  },
  finishMemberLogin() {
    if (!this.loginReturnRoute || !hasSession()) return;
    if (this.profileReturnAfterPhone && !this.data.user?.phone) { if (this.data.loggedIn && !this.data.phoneLinkOpen) this.openPhoneLink(); return; }
    const route = this.loginReturnRoute; this.loginReturnRoute = ''; this.profileReturnAfterPhone = false;
    this.subscriptionPhoneReturnOwner = undefined; clearSubscriptionPhoneReturn(); wx.navigateTo({url:route});
  },
  toggleOtherLogin() { this.setData({ otherLoginOpen: !this.data.otherLoginOpen }); },


  onShow() {
    this.setData({ privacyAccepted: isPrivacyAccepted() });
    this.loadMemberPromotions();
    const loggedIn = hasSession();
    this.setData({ loggedIn, user: loggedIn ? getCachedUser() : null, error: '' });
    this.loadMemberSummary();
    if (this.subscriptionPhoneReturnOwner && this.subscriptionPhoneReturnOwner !== String(getCachedUser()?.id || '')) this.clearSubscriptionPhoneNavigation();
    const returnRoute = consumeMemberLoginReturn();
    if(returnRoute){this.loginReturnRoute=returnRoute;this.setData({loginReturnHint:returnRoute.startsWith('/pages/checkout/index')?'登录后继续结算，所选商品会保留。':''});}
    const profileIntent = consumeProfileAccountReturn();
    if(profileIntent){this.loginReturnRoute='/pages/member-profile/index';this.profileReturnAfterPhone=profileIntent==='phone';this.setData({loginReturnHint:'登录后继续完善会员资料。'});}
    const subscriptionPhoneIntent = consumeSubscriptionPhoneReturn();
    if(subscriptionPhoneIntent){this.loginReturnRoute='/pages/subscriptions/index';this.profileReturnAfterPhone=true;this.subscriptionPhoneReturnOwner=subscriptionPhoneIntent.ownerId;this.setData({loginReturnHint:'登录并验证手机号后继续设置订阅提醒。'});}
    if(loggedIn){this.loadAccount();if(this.profileReturnAfterPhone&&!this.data.user?.phone)this.openPhoneLink();this.finishMemberLogin();}
    else if(this.loginReturnRoute)this.showLogin();
  },

  onPullDownRefresh() {
    this.loadMemberPromotions();
    this.loadMemberSummary();
    if (!hasSession()) {
      wx.stopPullDownRefresh();
      return;
    }
    this.loadAccount(true);
  },

  toggleConsent(event) {
    this.setData({ consented: event.detail.value.includes('accepted') });
  },

  toggleCrossBorderConsent(event) {
    this.setData({ crossBorderConsented: event.detail.value.includes('accepted') });
  },

  openMiniPrivacy() {
    wx.navigateTo({ url: '/pages/content/index?pageKey=miniprogram-privacy' });
  },

  async signIn() {
    if (!isPrivacyAccepted()) { openPrivacyPage(); return; }
    if (!this.data.consented || !this.data.crossBorderConsented || this.data.loading || this.data.phoneAuthorizing) return;
    this.setData({ loading: true, error: '' });
    try {
      await requireNativePrivacy();
      const user = await loginWithWeChat({ privacyConsent: this.data.consented, crossBorderConsent: this.data.crossBorderConsented });
      this.setData({ loggedIn: true, user });
      void maybeBindPendingReferral().catch(() => {});
      this.loadMemberPromotions();
      this.loadMemberSummary();
      wx.showToast({ title: '登录成功', icon: 'success' });
      try { await syncGuestCart(); this.finishMemberLogin(); } catch {
        this.setData({ error: '已登录，本机购物袋尚未同步。请到购物袋调整商品或重试，所选商品仍保留在本机。' });
      }
    } catch (error) {
      this.setData({ error: loginErrorMessage(error?.message) });
    } finally {
      this.setData({ loading: false });
    }
  },

  togglePhoneConsent(event) {
    this.setData({ phoneConsent: event.detail.value.includes('accepted') });
  },

  async authorizePhone(event) {
    if (!isPrivacyAccepted()) { openPrivacyPage(); return; }
    if (this.data.phoneAuthorizing || this.data.loading || this.data.smsVerifying) return;
    const signedIn = hasSession();
    if ((!signedIn && (!this.data.consented || !this.data.crossBorderConsented)) || (signedIn && !this.data.phoneConsent)) return;
    const code = event.detail?.code;
    if (!code) {
      const cancelled = /deny|cancel/i.test(event.detail?.errMsg || '');
      this.setData({ error: cancelled ? '已取消手机号授权，您仍可使用微信登录。' :
        event.detail?.errno === 1400001 ? '手机号授权暂不可用，可使用微信登录或短信验证码绑定。' : '手机号授权未完成，请重试或使用短信验证码。' });
      return;
    }
    this.setData({ phoneAuthorizing: true, error: '' });
    try {
      let user = signedIn ? getCachedUser() : await loginWithWeChat({ privacyConsent: true, crossBorderConsent: true });
      this.setData({ loggedIn: true, user });
      // Finish uncertain guest imports before an account merge changes the owner.
      await syncGuestCart();
      if (!user?.phone) user = await linkWeChatPhone(code);
      this.setData({ user, phoneLinkOpen: false, phoneConsent: false, phone: '', smsCode: '', smsSent: false });
      void maybeBindPendingReferral().catch(() => {});
      this.loadMemberPromotions();
      this.loadMemberSummary();
      wx.showToast({ title: '登录成功', icon: 'success' });
      this.finishMemberLogin();
    } catch (error) {
      this.setData({ error: phoneAuthorizationError(error?.message) });
    } finally {
      this.setData({ phoneAuthorizing: false });
    }
  },

  async loadAccount(isRefresh = false) {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true, ...(isRefresh ? { error: '' } : {}) });
    try {
      const user = await fetchCurrentUser();
      this.setData({ loggedIn: true, user });
      void maybeBindPendingReferral().catch(() => {});
      if (this.profileReturnAfterPhone && user.phone) this.finishMemberLogin();
    } catch (error) {
      if (error?.statusCode === 401 || error?.message === 'AUTH_REQUIRED') {
        this.setData({ loggedIn: false, user: null });
      } else if (isRefresh) {
        this.setData({ error: '账户资料同步失败，请稍后重试。' });
      }
    } finally {
      this.setData({ refreshing: false });
      wx.stopPullDownRefresh();
    }
  },

  openEntry(event) {
    const route = event.currentTarget.dataset.route;
    if (!route || !/^\/pages\//.test(route)) return;
    wx.navigateTo({ url: route });
  },

  openPrivacy() {
    wx.navigateTo({ url: '/pages/content/index?pageKey=privacy-policy' });
  },

  openTerms() {
    wx.navigateTo({ url: '/pages/content/index?pageKey=terms' });
  },

  openStory() {
    navigateToManagedPage('about');
  },

  openContact() {
    wx.navigateTo({ url: '/pages/contact/index' });
  },

  openPhoneLink() {
    this.setData({ phoneLinkOpen: true, error: '', smsCode: '', smsSent: false, devCode: '' });
    wx.pageScrollTo({ selector: '.phone-link-card', duration: 250 });
  },

  closePhoneLink() {
    if (!this.data.smsSending && !this.data.smsVerifying) { this.setData({ phoneLinkOpen: false, error: '' }); if(this.profileReturnAfterPhone){this.profileReturnAfterPhone=false;this.loginReturnRoute='';} if(this.subscriptionPhoneReturnOwner !== undefined)this.clearSubscriptionPhoneNavigation(); }
  },

  onPhoneInput(event) {
    this.setData({ phone: event.detail.value.replace(/\D/g, '').slice(0, 11) });
  },

  onSmsCodeInput(event) {
    this.setData({ smsCode: event.detail.value.replace(/\D/g, '').slice(0, 6) });
  },

  async sendSmsCode() {
    if (!/^1[3-9]\d{9}$/.test(this.data.phone) || this.data.smsSending) {
      this.setData({ error: '请输入正确的中国大陆手机号。' });
      return;
    }
    this.setData({ smsSending: true, error: '', devCode: '' });
    try {
      const result = await sendPhoneLinkCode(this.data.phone);
      this.setData({ smsSent: true, devCode: result.devCode || '' });
      wx.showToast({ title: '验证码已发送', icon: 'success' });
    } catch (error) {
      this.setData({ error: phoneLinkErrorMessage(error?.message) });
    } finally {
      this.setData({ smsSending: false });
    }
  },

  async verifyPhoneLink() {
    if (this.data.phoneAuthorizing) return;
    if (!/^\d{6}$/.test(this.data.smsCode) || this.data.smsVerifying) {
      this.setData({ error: '请输入 6 位短信验证码。' });
      return;
    }
    this.setData({ smsVerifying: true, error: '' });
    try {
      await syncGuestCart();
      const user = await linkPhoneToAccount(this.data.phone, this.data.smsCode);
      this.setData({ user, phoneLinkOpen: false, phone: '', smsCode: '', smsSent: false, devCode: '' });
      void maybeBindPendingReferral().catch(() => {});
      this.loadMemberPromotions();
      this.loadMemberSummary();
      wx.showToast({ title: '统一账户已关联', icon: 'success' });
      this.finishMemberLogin();
    } catch (error) {
      this.setData({ error: phoneLinkErrorMessage(error?.message) });
    } finally {
      this.setData({ smsVerifying: false });
    }
  },

  async signOut() {
    if (this.data.phoneAuthorizing || this.data.smsVerifying) return;
    const result = await wx.showModal({ title: '退出登录', content: '退出后本机将删除登录凭证，购物袋和订单仍保存在统一账户中。' });
    if (!result.confirm) return;
    await logout();
    if(this.subscriptionPhoneReturnOwner !== undefined)this.clearSubscriptionPhoneNavigation();else clearSubscriptionPhoneReturn();
    this.memberSummaryLoadId = (this.memberSummaryLoadId || 0) + 1;
    this.setData({ loggedIn: false, user: null, consented: false, crossBorderConsented: false, error: '', newcomerOffer:null,promotions:null,memberDisplayName:'',memberPoints:'—',memberCouponCount:'—',memberSummaryLoaded:false,operations:null });
    this.loadMemberPromotions();
  },
}, ["startMemberRegistration","openProfile","openMemberBenefit","openMember","openPrivacy","openMiniPrivacy","openTerms","toggleOtherLogin","signIn","openEntry","openNewcomer","openMemberOperation","openXiaohongshu","openAccountQr","openPhoneLink","sendSmsCode","verifyPhoneLink","closePhoneLink","openStory","openContact","signOut"], {"tabBar":true}));

function phoneAuthorizationError(message) {
  const messages = {
    WECHAT_PHONE_CODE_INVALID: '授权已过期或已使用，请重新点击手机号授权。',
    WECHAT_PHONE_NETWORK_UNAVAILABLE: '授权结果暂未确认，请刷新账户；仍未绑定时重新授权。',
    WECHAT_PHONE_REGION_UNSUPPORTED: '目前仅支持中国大陆手机号，您仍可使用微信账号登录。',
    WECHAT_PHONE_ALREADY_LINKED: '账户已绑定手机号，请刷新账户查看。',
    WECHAT_PHONE_RATE_LIMITED: '操作较频繁，请稍后重试。',
    WECHAT_LOGIN_RATE_LIMITED: '操作较频繁，请稍后重试。',
    WECHAT_PHONE_AUTHORIZATION_FAILED: '微信手机号授权暂不可用，请重试或使用短信验证码。',
    WECHAT_PHONE_INVALID_RESPONSE: '手机号授权校验未通过，请重新授权。',
    WECHAT_PHONE_LINK_FAILED: '手机号绑定未完成，请刷新账户确认后重试。',
  };
  return messages[message] || phoneLinkErrorMessage(message);
}

function loginErrorMessage(code) {
  const messages = { ACCOUNT_NOT_READY: '登录暂未开放，您可以先浏览商品和保存购物袋。',
    WECHAT_PRIVACY_REQUIRED: '请先同意微信隐私授权，再登录。',
    MINIPROGRAM_AUTH_REQUIRES_PRISMA: '商城账户服务尚未启用。',
    PRIVACY_CONSENT_REQUIRED: '请先阅读并同意隐私政策与服务条款。',
    USER_DISABLED: '该账户当前不可用，请联系 MerchantKit。',
    WECHAT_LOGIN_CODE_INVALID: '微信登录凭证已失效，请重试。',
    WECHAT_LOGIN_FREQUENCY_LIMITED: '登录请求过于频繁，请稍后再试。',
    WECHAT_LOGIN_RATE_LIMITED: '登录尝试次数过多，请稍后再试。',
    WECHAT_MINIPROGRAM_NOT_CONFIGURED: '微信登录服务尚未完成配置。',
  };
  return messages[code] || '登录暂时失败，请检查网络后重试。';
}

function phoneLinkErrorMessage(code) {
  const messages = {
    ACCOUNT_MERGE_CART_LIMIT_EXCEEDED: '两个账户的购物袋合计超过购买数量限制，请先调整商品数量后重新验证。',
    WECHAT_APP_IDENTITY_CONFLICT: '该手机号已关联另一个微信账户，请联系客服处理。',
    CART_SYNC_ACCOUNT_CHANGED: '请先使用原账户完成本机购物袋同步。',
    INVALID_PHONE: '请输入正确的中国大陆手机号。',
    SMS_CODE_EXPIRED: '验证码已过期，请重新发送。',
    SMS_CODE_MISMATCH: '验证码不正确，请重新输入。',
    SMS_CODE_NOT_FOUND: '验证码不存在或已经使用，请重新发送。',
    SMS_SEND_COOLDOWN: '发送过于频繁，请稍后再试。',
    SMS_PHONE_HOURLY_LIMIT: '该手机号发送次数过多，请稍后再试。',
    WECHAT_ACCOUNT_LINK_ROLE_FORBIDDEN: '该手机号对应的账户类型不能在小程序中合并。',
    WECHAT_IDENTITY_NOT_FOUND: '当前微信身份关联已失效，请退出后重新登录。',
  };
  return messages[code] || '统一账户关联失败，请稍后重试。';
}

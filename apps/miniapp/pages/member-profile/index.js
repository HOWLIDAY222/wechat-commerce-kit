import { withTapFeedback } from '../../utils/tap-feedback';
import { hasSession } from '../../stores/session';
import { getCachedUser } from '../../services/auth';
import { fetchMemberProfile, rememberProfileAccountReturn, saveMemberProfile } from '../../services/member-profile';
import { downloadMemberAvatar, uploadMemberAvatar, removeMemberAvatar } from '../../services/member-avatar';
import { emptyMemberAvatar, memberAvatarError } from '../../models/member-avatar';
import { maybeBindPendingReferral } from '../../utils/member-referral';
import {
  beijingToday, emptyMemberProfile, memberGenderIndex, memberGenderOptions, memberGenderValue,
  memberProfileError, memberProfileForm,
} from '../../models/member-profile';

Page(withTapFeedback({
  data: {
    navigationTop: 20,
    loggedIn: false,
    loading: false,
    loaded: false,
    saving: false,
    error: '',
    savedMessage: '',
    conflict: false,
    canEdit: false,
    accountPhone: '',
    profile: emptyMemberProfile(),
    form: memberProfileForm(),
    memberName: 'MerchantKit 会员',
    genderOptions: memberGenderOptions,
    genderIndex: 0,
    regionLabel: '',
    birthdayEnd: beijingToday(),
    nameFocused: false,
    moreOpen: false,
    avatar: emptyMemberAvatar(),
    avatarPath: '',
    avatarBusy: false,
    avatarError: '',
    avatarMessage: '',
    avatarConflict: false,
    avatarSupported: typeof wx.canIUse === 'function' && wx.canIUse('button.open-type.chooseAvatar'),
  },

  onLoad() {
    wx.hideShareMenu?.({ menus: ['shareAppMessage', 'shareTimeline'] });
    let info = {};
    try { info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync?.() || {}; } catch {}
    this.setData({ navigationTop: Number(info.statusBarHeight) || 20 });
  },

  onShow() {
    this.unloaded = false;
    const loggedIn = hasSession();
    const accountIdentity = String(getCachedUser()?.id || '');
    const cachedPhone = String(getCachedUser()?.phone || '');
    this.setData({ loggedIn, birthdayEnd: beijingToday() });
    if (!loggedIn) {
      this.loadSequence = (this.loadSequence || 0) + 1;
      this.saveSequence = (this.saveSequence || 0) + 1;
      this.avatarSequence = (this.avatarSequence || 0) + 1;
      this.setData({ loading: false, loaded: false, accountPhone: '', canEdit: false, avatar: emptyMemberAvatar(), avatarPath: '', avatarBusy: false, avatarError: '', avatarMessage: '' });
      return;
    }
    if (this.data.loaded && this.accountIdentity === accountIdentity && this.profileCachedPhone === cachedPhone) return;
    this.avatarSequence = (this.avatarSequence || 0) + 1;
    this.saveSequence = (this.saveSequence || 0) + 1;
    this.accountIdentity = accountIdentity;
    // Compare the cached account value captured on entry, not the API's
    // normalized phone, so a verified same-ID link reloads exactly once.
    this.profileCachedPhone = cachedPhone;
    this.setData({ loaded: false, accountPhone: '', canEdit: false, profile: emptyMemberProfile(), form: memberProfileForm(), avatar: emptyMemberAvatar(), avatarPath: '', avatarBusy: false, avatarError: '', avatarMessage: '' });
    this.loadProfile();
  },

  onUnload() {
    this.unloaded = true;
    this.loadSequence = (this.loadSequence || 0) + 1;
    this.saveSequence = (this.saveSequence || 0) + 1;
    this.avatarSequence = (this.avatarSequence || 0) + 1;
  },

  back() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/account/index' }) }); },
  editName() {
    if (this.data.loading || this.data.saving || this.data.avatarBusy) return;
    if (!hasSession() || !this.data.loggedIn) { this.goToLogin(); return; }
    if (!this.data.canEdit || !this.data.accountPhone) { this.bindPhone(); return; }
    if (String(getCachedUser()?.id || '') !== this.accountIdentity) return;
    this.setData({ nameFocused: true }); wx.pageScrollTo({ selector: '#member-display-name', duration: 200 });
  },
  onNameBlur(event) {
    this.setData({ nameFocused: false });
    if (typeof event?.detail?.value !== 'string' || !hasSession() || String(getCachedUser()?.id || '') !== this.accountIdentity) return;
    this.onFieldInput({ currentTarget: { dataset: { field: 'displayName' } }, detail: { value: event.detail.value } });
  },
  openAvatarSettings() {
    if (this.data.loading || this.data.saving || this.data.avatarBusy) return;
    if (!hasSession() || !this.data.loggedIn) { this.goToLogin(); return; }
    if (!this.data.canEdit || !this.data.accountPhone) { this.bindPhone(); return; }
    if (!this.data.avatarSupported) { wx.showToast({ title: '请更新微信后设置头像', icon: 'none' }); return; }
    if (!this.data.avatar.available || this.data.avatarConflict) return this.refreshAvatar();
  },
  toggleMore() { if (!this.data.saving) this.setData({ moreOpen: !this.data.moreOpen }); },

  async loadProfile() {
    if (this.data.saving || this.data.avatarBusy) return;
    const loadSequence = this.loadSequence = (this.loadSequence || 0) + 1;
    this.setData({ loading: true, error: '', savedMessage: '' });
    try {
      const response = await fetchMemberProfile();
      if (this.unloaded || loadSequence !== this.loadSequence) return;
      this.applyProfile(response);
    } catch (error) {
      if (this.unloaded || loadSequence !== this.loadSequence) return;
      this.setData({ error: memberProfileError(error), ...(error?.statusCode === 401 ? { loggedIn: false, canEdit: false } : {}) });
    } finally {
      if (!this.unloaded && loadSequence === this.loadSequence) this.setData({ loading: false });
    }
  },

  applyProfile(response) {
    const { profile, accountPhone, canEdit } = response;
    const form = memberProfileForm(profile);
    this.setData({
      profile, form, accountPhone: accountPhone || '', canEdit, loaded: true, conflict: false,
      genderIndex: memberGenderIndex(form.gender), regionLabel: form.region.join(' '),
      memberName: profile.displayName || getCachedUser()?.name || 'MerchantKit 会员',
    });
    if (response.avatar) this.applyAvatar(response.avatar);
  },

  avatarIsCurrent(sequence, identity) { return !this.unloaded && sequence === this.avatarSequence && hasSession() && identity === String(getCachedUser()?.id || ''); },
  async applyAvatar(avatar) {
    const sequence = this.avatarSequence = (this.avatarSequence || 0) + 1;
    const identity = String(getCachedUser()?.id || '');
    this.setData({ avatar, avatarPath: '', avatarConflict: false });
    try {
      const avatarPath = await downloadMemberAvatar(avatar);
      if (this.avatarIsCurrent(sequence, identity)) this.setData({ avatarPath });
    } catch (error) {
      if (this.avatarIsCurrent(sequence, identity)) this.setData({ avatarError: memberAvatarError(error) });
    }
  },
  onAvatarImageError() { this.setData({ avatarPath: '', avatarError: '头像暂未显示，请刷新头像。' }); },
  onAvatarChooseError(event) {
    if (!/cancel/i.test(event?.detail?.errMsg || '')) this.setData({ avatarError: '未能选取头像，请重新选择。' });
  },
  async refreshAvatar() {
    if (this.data.avatarBusy || this.data.saving || !hasSession()) return;
    if (String(getCachedUser()?.id || '') !== this.accountIdentity) { this.setData({ avatarPath: '', avatarError: memberAvatarError(new Error('SESSION_CHANGED')) }); return; }
    const sequence = this.avatarSequence = (this.avatarSequence || 0) + 1;
    const identity = String(getCachedUser()?.id || '');
    this.setData({ avatarBusy: true, avatarError: '', avatarMessage: '' });
    try {
      const response = await fetchMemberProfile();
      if (!this.avatarIsCurrent(sequence, identity)) return;
      const avatar = response.avatar || emptyMemberAvatar();
      const avatarPath = await downloadMemberAvatar(avatar);
      if (this.avatarIsCurrent(sequence, identity)) this.setData({ avatar, avatarPath, avatarConflict: false });
    } catch (error) { if (this.avatarIsCurrent(sequence, identity)) this.setData({ avatarError: memberAvatarError(error) }); }
    finally { if (this.avatarIsCurrent(sequence, identity)) this.setData({ avatarBusy: false }); }
  },
  async onChooseAvatar(event) { await this.changeAvatar(event?.detail?.avatarUrl); },
  async removeAvatar() { await this.changeAvatar(null); },
  async changeAvatar(filePath) {
    if (!hasSession() || !this.data.loaded || !this.data.canEdit || !this.data.avatar.available || this.data.avatarBusy || this.data.saving || this.data.loading || this.data.avatarConflict || (filePath === null && !this.data.avatar.hasAvatar)) return;
    if (String(getCachedUser()?.id || '') !== this.accountIdentity) { this.setData({ avatarPath: '', avatarError: memberAvatarError(new Error('SESSION_CHANGED')) }); return; }
    if (!filePath && filePath !== null) return;
    const sequence = this.avatarSequence = (this.avatarSequence || 0) + 1;
    const identity = String(getCachedUser()?.id || '');
    this.setData({ avatarBusy: true, avatarError: '', avatarMessage: '' });
    try {
      const avatar = filePath === null ? await removeMemberAvatar(this.data.avatar.revision) : await uploadMemberAvatar(filePath, this.data.avatar.revision);
      if (!this.avatarIsCurrent(sequence, identity)) return;
      this.setData({ avatar, avatarPath: '', avatarMessage: filePath === null ? '头像已移除。' : '头像已保存。' });
      const avatarPath = await downloadMemberAvatar(avatar);
      if (this.avatarIsCurrent(sequence, identity)) this.setData({ avatarPath });
    } catch (error) { if (this.avatarIsCurrent(sequence, identity)) this.setData({ avatarError: memberAvatarError(error), avatarConflict: error?.message === 'MEMBER_AVATAR_REVISION_CONFLICT' }); }
    finally { if (this.avatarIsCurrent(sequence, identity)) this.setData({ avatarBusy: false }); }
  },

  onFieldInput(event) {
    const field = event.currentTarget.dataset.field;
    if (!['surname', 'givenName', 'displayName'].includes(field) || this.data.saving || !this.data.canEdit) return;
    this.setData({ ['form.' + field]: event.detail.value, savedMessage: '' });
  },
  onGenderChange(event) {
    if (this.data.saving || !this.data.canEdit) return;
    const genderIndex = Number(event.detail.value);
    this.setData({ 'form.gender': memberGenderValue(genderIndex), genderIndex, savedMessage: '' });
  },
  onRegionChange(event) {
    if (this.data.saving || !this.data.canEdit) return;
    const region = event.detail.value;
    if (!Array.isArray(region) || region.length !== 3) return;
    this.setData({ 'form.region': region, regionLabel: region.join(' '), savedMessage: '' });
  },
  clearRegion() { if (!this.data.saving && this.data.canEdit) this.setData({ 'form.region': [], regionLabel: '', savedMessage: '' }); },
  onBirthdayChange(event) { if (!this.data.saving && this.data.canEdit) this.setData({ 'form.birthday': event.detail.value, savedMessage: '' }); },
  clearBirthday() { if (!this.data.saving && this.data.canEdit) this.setData({ 'form.birthday': '', savedMessage: '' }); },

  goToLogin() {
    rememberProfileAccountReturn('login');
    wx.switchTab({ url: '/pages/account/index' });
  },
  bindPhone() {
    if (this.data.saving) return;
    rememberProfileAccountReturn('phone');
    wx.switchTab({ url: '/pages/account/index' });
  },
  openPrivacy() { wx.navigateTo({ url: '/pages/content/index?pageKey=privacy-policy' }); },
  openMiniPrivacy() { wx.navigateTo({ url: '/pages/content/index?pageKey=miniprogram-privacy' }); },
  openTerms() { wx.navigateTo({ url: '/pages/content/index?pageKey=terms' }); },
  openSubscriptions() { wx.navigateTo({ url: '/pages/subscriptions/index' }); },

  async saveProfile() {
    if (!hasSession()) { this.goToLogin(); return; }
    if (this.data.saving || this.data.loading || this.data.avatarBusy || !this.data.loaded || !this.data.canEdit || this.data.conflict) return;
    if (!this.data.accountPhone) {
      this.setData({ error: '请先授权或验证手机号，再保存会员资料。' });
      wx.pageScrollTo({ selector: '#member-phone', duration: 200 });
      return;
    }
    const saveSequence = this.saveSequence = (this.saveSequence || 0) + 1;
    this.setData({ saving: true, error: '', savedMessage: '' });
    try {
      const completeRegistration = !this.data.profile.registeredAt;
      const response = await saveMemberProfile(this.data.form, this.data.profile.revision, completeRegistration);
      if (this.unloaded || saveSequence !== this.saveSequence) return;
      this.applyProfile(response);
      if (completeRegistration) void maybeBindPendingReferral().catch(() => {});
      this.setData({ savedMessage: completeRegistration ? '会员注册完成，资料已保存。' : '会员资料已保存。' });
      wx.showToast({ title: completeRegistration ? '注册完成' : '保存成功', icon: 'success' });
    } catch (error) {
      if (this.unloaded || saveSequence !== this.saveSequence) return;
      this.setData({ error: memberProfileError(error), conflict: error?.message === 'MEMBER_PROFILE_REVISION_CONFLICT', ...(error?.statusCode === 401 ? { loggedIn: false, canEdit: false } : {}) });
    } finally {
      if (!this.unloaded && saveSequence === this.saveSequence) this.setData({ saving: false });
    }
  },
}, ["back","editName","goToLogin","openTerms","openPrivacy","openMiniPrivacy","openAvatarSettings","removeAvatar","refreshAvatar","clearBirthday","toggleMore","clearRegion","openSubscriptions","loadProfile","bindPhone","saveProfile"]));

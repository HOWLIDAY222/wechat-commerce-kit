import { withTapFeedback } from '../../utils/tap-feedback';
import { operationsPage, readPendingMemberAction, savePendingMemberAction, clearPendingMemberAction } from '../../utils/member-operations-page';
import { memberOperation } from '../../services/member-operations';
import { uploadSocialProof, downloadSocialProof, removeUnusedSocialProof } from '../../services/member-social';
import { createMemberRequestId, memberOperationsError } from '../../models/member-operations';
import { xiaohongshuBrand, socialPlatforms, socialInteractions, socialPostLink, socialSubmissionPayload, socialFingerprint, localSocialImage, readSocialProof, memberSocialError } from '../../models/member-social';
import { readStoredUser, hasSession } from '../../stores/session';

const campaignByTab={follow:'XIAOHONGSHU_FOLLOW',share:'SOCIAL_POST',interaction:'SOCIAL_INTERACTION',repost:'SOCIAL_REPOST'};
const tabByCampaign={XIAOHONGSHU_FOLLOW:'follow',SOCIAL_POST:'share',SOCIAL_INTERACTION:'interaction',SOCIAL_REPOST:'repost'};
const lifecycle = operationsPage({ route: '/pages/member-community/index', initialize(options) {
  this.pendingPost = readPendingMemberAction('post'); this.pendingComment = readPendingMemberAction('comment');
  const tab = ['follow', 'share', 'interaction', 'repost', 'history'].includes(options.tab) ? options.tab : 'share';
  this.setData({ socialTab: tab === 'history' ? 'share' : tab, socialStage: tab === 'history' ? 'history' : tab === 'follow' ? 'requirements' : 'platform' });
  this.returnRoute = '/pages/member-community/index?tab=' + tab;
}, loaded(overview) {
  const owner = this.overviewIdentity;
  if (this.socialOwner !== owner) this.resetSocialIdentity(owner);
  if (this.pendingIdentity !== owner) { this.pendingPost = readPendingMemberAction('post'); this.pendingComment = readPendingMemberAction('comment'); this.pendingIdentity = owner; }
  if (this.pendingPost && overview.myPosts.some(post => post.requestId === this.pendingPost.requestId)) { this.pendingPost = null; clearPendingMemberAction('post'); }
  if (this.pendingComment && overview.myComments.some(comment => comment.requestId === this.pendingComment.requestId)) { this.pendingComment = null; clearPendingMemberAction('comment'); }
  if (this.pendingSocial && overview.mySocialSubmissions.some(item => item.requestId === this.pendingSocial.requestId)) { this.pendingSocial = null; this.socialRevision = null; clearPendingMemberAction('social'); this.setData({ pendingSocialReady: false, socialStage: 'history', socialPostUrl: '', socialNote: '', socialConfirmed: false, proofItems: [], socialRevisionLabel: '' }); }
  this.syncSocialState();
} });

Page(withTapFeedback({
  ...lifecycle,
  data: { overview: null, loading: false, busy: false, guest: false, syncFailed: false, error: '', notice: '',
    socialTab: 'share', socialStage: 'platform', selectedPlatform: 'XIAOHONGSHU', platformOptions: socialPlatforms, platformLabel: '小红书', interactionType:'LIKE',interactionOptions:socialInteractions,
    socialCanSubmit: false, socialDisabledReason: '', socialTaskDescription: '', socialRewardLabel: '', socialInstructions: '',
    socialPostUrl: '', socialNote: '', socialConfirmed: false, proofItems: [], socialUploading: false, pendingSocialReady: false, previewingProofId: '', socialRevisionLabel: '',
    brandProfile: xiaohongshuBrand, postText: '', commentPostId: '', commentText: '', confirmed: false, reportId: '', reportReason: '', preparedShare: null },
  onShow() { const owner = readStoredUser()?.id || ''; if (this.socialOwner !== owner) this.resetSocialIdentity(owner); return lifecycle.onShow.call(this); },
  loadOperations() { const owner = hasSession() ? readStoredUser()?.id || '' : ''; if (this.socialOwner !== owner) this.resetSocialIdentity(owner); return lifecycle.loadOperations.call(this); },
  onUnload() { this.socialGeneration = (this.socialGeneration || 0) + 1; this.socialOwner = ''; this.proofPreviews?.clear(); lifecycle.onUnload.call(this); },
  resetSocialIdentity(owner) {
    this.socialOwner = owner; this.socialGeneration = (this.socialGeneration || 0) + 1; this.proofPreviews = new Map(); this.socialRevision = null;
    this.selectingSocialProof = false;
    this.pendingSocial = readPendingMemberAction('social');
    try { if (this.pendingSocial) { const clean = socialSubmissionPayload(this.pendingSocial.payload); const revision = this.pendingSocial.payload.expectedRevision; if (revision !== undefined) { if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('invalid'); clean.expectedRevision = revision; } if (!/^[A-Za-z0-9_-]{8,80}$/.test(this.pendingSocial.requestId)) throw new Error('invalid'); this.pendingSocial = { ...this.pendingSocial, payload: clean }; } }
    catch { this.pendingSocial = null; clearPendingMemberAction('social'); }
    this.setData({ socialPostUrl: '', socialNote: '', socialConfirmed: false, proofItems: [], socialUploading: false, pendingSocialReady: !!this.pendingSocial, previewingProofId: '', socialRevisionLabel: '', detailedRulesOpen: false, expandedSocialRecordId: '', legacyHistoryOpen: false, error: '', notice: '' });
  },
  sameSocialOwner(owner, generation) { const current = hasSession() ? readStoredUser()?.id || '' : ''; if (!this.disposed && this.socialOwner !== current) this.resetSocialIdentity(current); return !this.disposed && this.socialOwner === owner && owner === current && generation === this.socialGeneration; },
  syncSocialState() {
    const value = this.data.overview; if (!value) return;
    const follow = this.data.socialTab === 'follow';
    const task = value.tasks.find(item => item.key === campaignByTab[this.data.socialTab]);
    const first = value.tasks.find(item => item.key === 'SOCIAL_FIRST_POST');
    const enabled = follow ? !!(task?.enabled && task.state === 'AVAILABLE' && value.xiaohongshuAccount?.enabled)
      : this.data.socialTab==='interaction'?!!(task?.enabled&&value.social?.interactionEnabled)
      : this.data.socialTab==='repost'?!!(task?.enabled&&value.social?.repostingEnabled):!!value.social?.postingEnabled;
    const canSubmit = !!(value.registered && enabled);
    const allowed = Array.isArray(value.social?.platforms) && value.social.platforms.length ? socialPlatforms.filter(item => value.social.platforms.some(platform => platform.key === item.key)) : socialPlatforms;
    const selectedPlatform = follow ? 'XIAOHONGSHU' : allowed.some(item => item.key === this.data.selectedPlatform) ? this.data.selectedPlatform : allowed[0]?.key || 'XIAOHONGSHU';
    const platformLabel = socialPlatforms.find(item => item.key === selectedPlatform)?.label || '所选平台';
    const studentFirst=enabled&&this.data.socialTab==='share'&&value.student?.valid&&value.student?.benefitsEnabled&&!value.student?.firstSocialAwarded;
    let disabledReason = '';
    if (!value.registered) disabledReason = '请先完成会员注册。';
    else if (follow && task?.state === 'PENDING') disabledReason = '关注材料审核中。';
    else if (follow && task?.state === 'COMPLETED') disabledReason = '关注奖励已领取。';
    else if (follow && task?.state === 'LIMIT_REACHED') disabledReason = '你已达到这项活动的参与上限。';
    else if (!enabled) disabledReason = '这项活动暂未开放。';
    this.setData({ selectedPlatform, platformLabel, platformOptions: allowed.map(item => ({ ...item, selected: item.key === selectedPlatform })),
      socialCanSubmit: canSubmit, socialDisabledReason: disabledReason, socialTaskDescription: task?.description || first?.description || '',
      socialRewardLabel: !enabled?'':this.data.socialTab!=='share'?task?.rewardLabel||'':[!studentFirst&&first?.rewardLabel ? '首篇 ' + first.rewardLabel : '', task?.rewardLabel ? '后续每篇 ' + task.rewardLabel : ''].filter(Boolean).join(' · '),
      socialActionLabel:follow?'关注':this.data.socialTab==='interaction'?'互动':this.data.socialTab==='repost'?'转发':'发帖',
      studentSocialRewardLabel:studentFirst?'学生本期首篇 '+value.student.firstSocialPoints+' 积分':'',
      socialInstructions: typeof value.social?.instructions === 'string' ? value.social.instructions : '', brandProfile: xiaohongshuBrand, pendingSocialReady: !!this.pendingSocial });
  },
  changeSocialTab(event) {
    const tab = event.currentTarget.dataset.tab; if (!['share', 'follow', 'interaction', 'repost', 'history'].includes(tab) || this.data.busy || this.data.socialUploading) return;
    if (tab === 'history') { this.setData({ socialStage: 'history', error: '', notice: '' }); return; }
    if (this.data.socialTab !== tab && (this.data.proofItems.length || this.data.socialNote || this.data.socialPostUrl)) { this.setData({ error: '请先完成当前材料，或点“清空草稿”后切换活动。' }); return; }
    this.setData({ socialTab: tab, socialStage: tab === 'follow' ? 'requirements' : 'platform', error: '', notice: '' }); this.syncSocialState();
  },
  selectSocialPlatform(event) {
    const key = event.currentTarget.dataset.key;
    if (this.data.busy || this.data.socialUploading || !this.data.platformOptions.some(item => item.key === key)) return;
    if (this.data.selectedPlatform !== key && (this.data.proofItems.length || this.data.socialNote || this.data.socialPostUrl)) { this.setData({ error: '当前已有核验材料，请先清空草稿再切换平台。' }); return; }
    this.setData({ selectedPlatform: key }); this.syncSocialState();
  },
  selectSocialInteraction(event){const key=event.currentTarget.dataset.key;if(this.data.busy||this.data.socialUploading||this.pendingSocial||!socialInteractions.some(item=>item.key===key))return;this.setData({interactionType:key});},
  nextSocialStep() { if (this.data.busy || this.data.socialUploading) return; this.setData({ socialStage: this.data.socialStage === 'platform' ? 'requirements' : 'submit', error: '', notice: '' }); },
  previousSocialStep() { if (this.data.busy || this.data.socialUploading) return; this.setData({ socialStage: this.data.socialStage === 'submit' ? 'requirements' : 'platform', error: '', notice: '' }); },
  changeSocialLink(event) { if (!this.data.busy && !this.data.socialUploading) this.setData({ socialPostUrl: event.detail.value }); },
  changeSocialNote(event) { if (!this.data.busy && !this.data.socialUploading) this.setData({ socialNote: event.detail.value }); },
  changeSocialConsent(event) { this.setData({ socialConfirmed: event.detail.value.includes('confirmed') }); },
  toggleSocialRules() { this.setData({ detailedRulesOpen: !this.data.detailedRulesOpen }); },
  toggleSocialRecord(event) { const id = event.currentTarget.dataset.id; if (this.data.overview?.mySocialSubmissions.some(item => item.id === id)) this.setData({ expandedSocialRecordId: this.data.expandedSocialRecordId === id ? '' : id }); },
  toggleLegacyHistory() { this.setData({ legacyHistoryOpen: !this.data.legacyHistoryOpen }); },
  copyBrandLink() {
    wx.setClipboardData({ data: xiaohongshuBrand.profileUrl, success: () => { if (!this.disposed) this.setData({ notice: '品牌主页链接已复制。' }); }, fail: () => { if (!this.disposed) this.setData({ error: '复制未完成，请重试。' }); } });
  },
  previewBrandProfile() { wx.previewImage({ current: xiaohongshuBrand.qrImageUrl, urls: [xiaohongshuBrand.qrImageUrl] }); },
  chooseSocialProof() {
    if (!this.canOperate() || !this.data.socialCanSubmit || this.data.socialUploading || this.selectingSocialProof || this.data.proofItems.length >= 3 || this.pendingSocial) return;
    this.selectingSocialProof = true;
    const owner = this.socialOwner, generation = this.socialGeneration, count = 3 - this.data.proofItems.length;
    const accept = files => {
      if (!this.sameSocialOwner(owner, generation)) return;
      this.selectingSocialProof = false;
      if (files.some(file => !localSocialImage(file.tempFilePath) || (Number.isFinite(file.size) && file.size > 3 * 1024 * 1024))) { this.setData({ error: '请选择不超过3MB的JPG、PNG或WebP截图。' }); return; }
      this.setData({ proofItems: [...this.data.proofItems, ...files.slice(0, count).map(file => ({ localId: createMemberRequestId(), localPath: file.tempFilePath, uploadRequestId: createMemberRequestId(), id: '', url: '', existing: false }))], error: '' });
    };
    const fail = error => { if (this.sameSocialOwner(owner, generation)) { this.selectingSocialProof = false; if (!String(error?.errMsg || '').includes('cancel')) this.setData({ error: '未能选择截图，请重试。' }); } };
    if (typeof wx.chooseMedia === 'function') wx.chooseMedia({ count, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'], success: result => accept(result.tempFiles || []), fail });
    else wx.chooseImage({ count, sourceType: ['album', 'camera'], sizeType: ['compressed'], success: result => accept((result.tempFiles || []).map(file => ({ ...file, tempFilePath: file.path }))), fail });
  },
  async removeSocialProof(event) {
    const index = Number(event.currentTarget.dataset.index), item = this.data.proofItems[index];
    if (!item || !this.canOperate() || this.data.busy || this.data.socialUploading || this.pendingSocial) return;
    const owner = this.socialOwner, generation = this.socialGeneration;
    if (item.id && !item.existing) {
      this.setData({ socialUploading: true, error: '' });
      try { await removeUnusedSocialProof(item); } catch (error) { if (this.sameSocialOwner(owner, generation)) this.setData({ error: memberSocialError(error) || memberOperationsError(error), socialUploading: false }); return; }
    }
    if (this.sameSocialOwner(owner, generation)) this.setData({ proofItems: this.data.proofItems.filter((_, position) => position !== index), socialUploading: false });
  },
  async previewSocialProof(event) {
    if (!this.sameSocialOwner(this.socialOwner, this.socialGeneration) || !this.data.overview || !hasSession()) return;
    if (this.data.previewingProofId) return;
    const { index, submission, id } = event.currentTarget.dataset;
    const proof = submission ? this.data.overview?.mySocialSubmissions.find(item => item.id === submission)?.proofs.find(item => item.id === id) : this.data.proofItems[Number(index)];
    if (!proof) return;
    if (localSocialImage(proof.localPath)) { wx.previewImage({ current: proof.localPath, urls: [proof.localPath] }); return; }
    const owner = this.socialOwner, generation = this.socialGeneration;
    this.setData({ previewingProofId: proof.id, error: '' });
    try {
      const localPath = this.proofPreviews?.get(proof.id) || await downloadSocialProof(proof);
      if (!this.sameSocialOwner(owner, generation)) return;
      this.proofPreviews.set(proof.id, localPath); wx.previewImage({ current: localPath, urls: [localPath] });
    } catch (error) { if (this.sameSocialOwner(owner, generation)) this.setData({ error: memberSocialError(error) || memberOperationsError(error) }); }
    finally { if (this.sameSocialOwner(owner, generation)) this.setData({ previewingProofId: '' }); }
  },
  async clearSocialDraft() {
    if (this.data.busy || this.data.socialUploading || this.pendingSocial) { this.setData({ error: '上次提交尚待确认，请先刷新记录或重试原请求。' }); return; }
    const owner = this.socialOwner, generation = this.socialGeneration;
    this.setData({ socialUploading: true, error: '' });
    try { for (const proof of this.data.proofItems) { if (proof.id && !proof.existing) await removeUnusedSocialProof(proof); if (!this.sameSocialOwner(owner, generation)) return; } this.socialRevision = null; this.setData({ socialPostUrl: '', socialNote: '', socialConfirmed: false, proofItems: [], socialRevisionLabel: '' }); }
    catch (error) { if (this.sameSocialOwner(owner, generation)) this.setData({ error: memberSocialError(error) || memberOperationsError(error) }); }
    finally { if (this.sameSocialOwner(owner, generation)) this.setData({ socialUploading: false }); }
  },
  async submitSocial() {
    if (!this.canOperate() || !this.data.socialCanSubmit || this.data.socialUploading) return;
    if (this.pendingSocial) { this.setData({ error: '上次提交结果尚未确认，请刷新记录或重试上次提交。' }); return; }
    if (!this.data.socialConfirmed) { this.setData({ error: '请确认材料由本人发布并同意用于核验。' }); return; }
    const follow = this.data.socialTab === 'follow', platform = follow ? 'XIAOHONGSHU' : this.data.selectedPlatform;
    const postUrl = platform==='WECHAT_MOMENTS'?'':this.data.socialPostUrl.trim(), note = this.data.socialNote.trim();
    if (note.length < 2 || note.length > 1000 || (postUrl && !socialPostLink(postUrl))) { this.setData({ error: '请填写2至1000字的核验说明；发布链接须是完整的HTTPS链接。' }); return; }
    if (!this.data.proofItems.length) { this.setData({ error: '请添加核验截图。' }); return; }
    const owner = this.socialOwner, generation = this.socialGeneration;
    this.setData({ socialUploading: true, error: '', notice: '' });
    try {
      const items = [...this.data.proofItems];
      for (let index = 0; index < items.length; index++) {
        if (!items[index].id) { const proof = await uploadSocialProof(items[index].localPath, items[index].uploadRequestId,'SOCIAL'); if (!this.sameSocialOwner(owner, generation)) return; items[index] = { ...items[index], ...proof }; this.setData({ proofItems: [...items] }); }
      }
      const payload = socialSubmissionPayload({ campaignKey: campaignByTab[this.data.socialTab], platform, postUrl, note, proofKeys: items.map(item => item.id), ...(this.data.socialTab==='interaction'?{interactionType:this.data.interactionType}:{}) });
      if (this.socialRevision) payload.expectedRevision = this.socialRevision.revision;
      const pending = { target: socialFingerprint(payload), requestId: this.socialRevision?.requestId || createMemberRequestId(), payload };
      this.pendingSocial = pending; savePendingMemberAction('social', pending); this.setData({ pendingSocialReady: true, socialUploading: false });
      await this.sendPendingSocial(pending, owner, generation);
    } catch (error) { if (this.sameSocialOwner(owner, generation)) this.setData({ error: memberSocialError(error) || memberOperationsError(error) }); }
    finally { if (this.sameSocialOwner(owner, generation)) this.setData({ socialUploading: false }); }
  },
  async retrySocialSubmission() {
    if (!this.canOperate() || this.data.socialUploading || !this.pendingSocial) return;
    await this.sendPendingSocial(this.pendingSocial, this.socialOwner, this.socialGeneration);
  },
  async sendPendingSocial(pending, owner, generation) {
    const result = await this.performOperation('submit_social_submission', { ...pending.payload, requestId: pending.requestId }, '已提交，等待人工审核。');
    if (!this.sameSocialOwner(owner, generation)) return;
    if (result?.submission) { this.pendingSocial = null; this.socialRevision = null; clearPendingMemberAction('social'); this.setData({ pendingSocialReady: false, socialStage: 'history', socialPostUrl: '', socialNote: '', socialConfirmed: false, proofItems: [], socialRevisionLabel: '' }); }
    else if (this.lastOperationError) {
      const definitive = ['MEMBER_OPERATIONS_DISABLED', 'INVALID_MEMBER_OPERATION', 'MEMBER_OPERATIONS_DUPLICATE_CONTENT', 'MEMBER_OPERATIONS_REVISION_CONFLICT', 'MEMBER_OPERATIONS_ALREADY_COMPLETED', 'MEMBER_OPERATIONS_LIMIT_REACHED', 'MEMBER_PHONE_REQUIRED', 'MEMBERSHIP_REQUIRED', 'MEMBER_CUSTOMER_REQUIRED'].includes(this.lastOperationError.message);
      if (definitive) { this.pendingSocial = null; clearPendingMemberAction('social'); }
      this.setData({ error: memberSocialError(this.lastOperationError) || memberOperationsError(this.lastOperationError), ...(definitive ? { pendingSocialReady: false } : {}) });
    }
  },
  reviseSocialSubmission(event) {
    if (!this.canOperate() || this.data.socialUploading || this.pendingSocial) return;
    const item = this.data.overview?.mySocialSubmissions.find(row => row.id === event.currentTarget.dataset.id);
    if (!item || item.status !== 'REJECTED' || !Number.isSafeInteger(item.revision) || !/^[A-Za-z0-9_-]{8,80}$/.test(item.requestId || '')) return;
    if (this.data.proofItems.length || this.data.socialNote || this.data.socialPostUrl) { this.setData({ error: '当前还有草稿材料，请先清空草稿再修改申请。' }); return; }
    this.socialRevision = { requestId: item.requestId, revision: item.revision };
    this.setData({ socialTab: tabByCampaign[item.campaignKey]||'share', interactionType:item.interactionType||'LIKE', socialStage: 'submit', selectedPlatform: item.platform,
      socialPostUrl: item.postUrl || '', socialNote: item.note || '', socialConfirmed: false, socialRevisionLabel: '正在修改未通过的申请，提交后会重新审核。',
      proofItems: item.proofs.map(proof => ({ ...readSocialProof(proof), localId: proof.id, localPath: '', existing: true })), error: '', notice: '' }); this.syncSocialState();
  },
  changeText(event) { this.setData({ postText: event.detail.value }); },
  changeConsent(event) { this.setData({ confirmed: event.detail.value.includes('confirmed') }); },
  async submitPost() {
    if (!this.canOperate() || !this.data.overview?.community?.postingEnabled || !this.data.confirmed) return;
    const text = this.data.postText.trim();
    if (text.length < 20 || text.length > 1000) { this.setData({ error: '请填写 20 至 1000 字的文字内容。' }); return; }
    const target = fingerprint(text);
    if (this.pendingPost && this.pendingPost.target !== target) { this.setData({ error: '上次投稿结果尚未确认，请先刷新“我的投稿”核对，再使用原文重试。' }); return; }
    this.pendingPost ||= { target, requestId: createMemberRequestId() }; savePendingMemberAction('post', this.pendingPost);
    const result = await this.performOperation('create_post', { text, requestId: this.pendingPost.requestId }, '投稿已保存，审核通过后公开展示。');
    if (result?.post) { this.pendingPost = null; clearPendingMemberAction('post'); if (!this.disposed) this.setData({ postText: '', confirmed: false }); }
  },
  openComment(event) { const postId = event.currentTarget.dataset.id; if (this.data.overview?.posts.some(post => post.id === postId)) this.setData({ commentPostId: postId, commentText: '', error: '', notice: '' }); },
  closeComment() { this.setData({ commentPostId: '', commentText: '' }); },
  changeComment(event) { this.setData({ commentText: event.detail.value }); },
  async submitComment() {
    if (!this.canOperate() || !this.data.overview?.community?.enabled) return;
    const postId = this.data.commentPostId, text = this.data.commentText.trim();
    if (!this.data.overview.posts.some(post => post.id === postId)) return;
    if (text.length < 2 || text.length > 500) { this.setData({ error: '请填写 2 至 500 字的评论内容。' }); return; }
    const target = postId + ':' + fingerprint(text);
    if (this.pendingComment && this.pendingComment.target !== target) { this.setData({ error: '上次评论结果尚未确认，请先刷新“我的评论”核对，再使用原文重试。' }); return; }
    this.pendingComment ||= { target, requestId: createMemberRequestId() }; savePendingMemberAction('comment', this.pendingComment);
    const result = await this.performOperation('create_comment', { postId, text, requestId: this.pendingComment.requestId }, '评论已保存，审核通过后公开展示。');
    if (result?.comment) { this.pendingComment = null; clearPendingMemberAction('comment'); if (!this.disposed) this.closeComment(); }
  },
  async react(event) {
    if (!this.data.overview?.community?.enabled) return;
    const { id, reaction } = event.currentTarget.dataset;
    const post = this.data.overview.posts.find(item => item.id === id);
    if (!post || !['LIKE', 'FAVORITE'].includes(reaction)) return;
    await this.performOperation('react_post', { postId: id, reaction, active: reaction === 'LIKE' ? !post.liked : !post.favorited }, '互动状态已更新。');
  },
  openReport(event) { this.setData({ reportId: event.currentTarget.dataset.id, reportReason: '', notice: '' }); },
  closeReport() { this.setData({ reportId: '', reportReason: '' }); },
  changeReport(event) { this.setData({ reportReason: event.detail.value }); },
  async submitReport() {
    if (!this.data.overview?.community?.enabled || !this.data.overview.posts.some(item => item.id === this.data.reportId)) return;
    const reason = this.data.reportReason.trim();
    if (reason.length < 2 || reason.length > 300) { this.setData({ error: '请填写 2 至 300 字的举报原因。' }); return; }
    const result = await this.performOperation('report_post', { postId: this.data.reportId, reason }, '举报已提交，将由工作人员审核。');
    if (result && !this.disposed) this.closeReport();
  },
  async prepareShare(event) {
    if (!this.data.overview?.community?.enabled) return;
    const postId = event.currentTarget.dataset.id;
    if (!this.data.overview.posts.some(item => item.id === postId)) return;
    const result = await this.performOperation('create_share', { postId }, '分享链接已准备好，请点击“分享这篇”。');
    if (typeof result?.token === 'string' && !this.disposed) this.setData({ preparedShare: { postId, token: result.token } });
  },
  onShareAppMessage(event) {
    const prepared = this.data.preparedShare;
    const matched = event?.from === 'button' && prepared?.postId === event.target?.dataset?.id;
    return { title: 'MerchantKit · 会员社区', path: '/pages/member-community/index' + (matched ? '?shareToken=' + encodeURIComponent(prepared.token) : '') };
  },
}, ["changeSocialTab","goLogin","loadOperations","retrySocialSubmission","selectSocialPlatform","nextSocialStep","previewBrandProfile","copyBrandLink","previousSocialStep","toggleSocialRules","selectSocialInteraction","previewSocialProof","removeSocialProof","chooseSocialProof","submitSocial","clearSocialDraft","toggleSocialRecord","reviseSocialSubmission","toggleLegacyHistory"]));

function fingerprint(value) { let hash = 2166136261; for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); } return value.length + ":" + (hash >>> 0).toString(16); }

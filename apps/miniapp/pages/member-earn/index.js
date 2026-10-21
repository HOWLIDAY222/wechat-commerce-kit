import { withTapFeedback } from '../../utils/tap-feedback';
import { operationsPage, readPendingMemberAction, savePendingMemberAction, clearPendingMemberAction } from '../../utils/member-operations-page';
import { safeQrImage, createMemberRequestId, memberOperationsError } from '../../models/member-operations';
import { enterpriseContact } from '../../config/enterprise-contact';
import { uploadSocialProof, downloadSocialProof, removeUnusedSocialProof } from '../../services/member-social';
import { memberOperation } from '../../services/member-operations';
import { localSocialImage, readSocialProof, memberSocialError } from '../../models/member-social';
import { hasSession, readStoredUser } from '../../stores/session';

const lifecycle = operationsPage({ route: '/pages/member-earn/index', initialize(options) {
  this.setData({ contactKey: options.contact === 'ENTERPRISE' ? options.contact : '' });
  if (options.contact === 'ENTERPRISE') this.returnRoute = '/pages/member-earn/index?contact=ENTERPRISE';
}, loaded() { this.updateContact(); } });
const sameProofs = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((key, index) => key === b[index]);
function validPending(value) {
  const payload = value?.payload, detail = payload?.detail;
  return typeof value?.requestId === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(value.requestId) && payload?.taskKey === 'ENTERPRISE'
    && typeof detail?.note === 'string' && detail.note.length <= 300 && Array.isArray(detail.proofKeys) && detail.proofKeys.length >= 1 && detail.proofKeys.length <= 3
    && new Set(detail.proofKeys).size === detail.proofKeys.length && detail.proofKeys.every(key => typeof key === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(key))
    && (payload.expectedRevision === undefined || Number.isSafeInteger(payload.expectedRevision) && payload.expectedRevision >= 0);
}

Page(withTapFeedback({
  ...lifecycle,
  data: { overview: null, loading: false, busy: false, guest: false, syncFailed: false, error: '', notice: '', contactKey: '', contactNote: '',
    enterpriseContactConfigured: enterpriseContact.enabled && /^[a-f0-9]{32}$/.test(enterpriseContact.configId),
    contactProofItems: [], contactUploading: false, contactPreviewingProofId: '', contactPendingReady: false, contactApplicationProofs: [], contactQrAvailable: false },
  loadOperations() {
    const owner = hasSession() ? readStoredUser()?.id || '' : '';
    if (this.contactOwner !== owner) this.resetContactIdentity(owner);
    return lifecycle.loadOperations.call(this);
  },
  onUnload() { this.contactGeneration = (this.contactGeneration || 0) + 1; this.contactPreviews?.clear(); lifecycle.onUnload.call(this); },
  resetContactIdentity(owner) {
    this.contactOwner = owner; this.contactGeneration = (this.contactGeneration || 0) + 1;
    this.contactPreviews = new Map(); this.selectingContactProof = false;
    const pending = owner ? readPendingMemberAction('enterprise') : null;
    this.pendingContact = validPending(pending) ? pending : null;
    this.setData({ contactNote: '', contactProofItems: [], contactUploading: false, busy: false, contactPreviewingProofId: '', contactPendingReady: !!this.pendingContact,
      contactApplication: null, contactApplicationProofs: [], contactCanSubmit: false, error: '', notice: '' });
  },
  sameContactOwner(owner, generation) {
    const current = hasSession() ? readStoredUser()?.id || '' : '';
    if (!this.disposed && this.contactOwner !== current) this.resetContactIdentity(current);
    return !this.disposed && owner === current && owner === this.contactOwner && generation === this.contactGeneration;
  },
  openTask(event) {
    const key = event.currentTarget.dataset.key;
    const task = this.data.overview?.tasks?.find(item => item.key === key);
    if (!task || task.actionDisabled || this.data.contactUploading || this.data.busy) return;
    if (key === 'ENTERPRISE') { this.setData({ contactKey: key, notice: '' }); this.updateContact(); wx.pageScrollTo?.({ selector: '#member-contact', duration: 180 }); return; }
    this.openRoute({ currentTarget: { dataset: { route: task.route } } });
  },
  closeContact() { if (!this.data.busy && !this.data.contactUploading) this.setData({ contactKey: '' }); },
  updateContact() {
    const overview = this.data.overview, info = overview?.enterpriseContact, task = overview?.tasks?.find(item => item.key === 'ENTERPRISE');
    const application = overview?.myApplications?.find(item => item.taskKey === 'ENTERPRISE');
    const proofs = (application?.proofs || []).flatMap(proof => { try { return [readSocialProof(proof)]; } catch { return []; } });
    const available = !!(info?.enabled && (safeQrImage(info.qrImageUrl) || this.data.enterpriseContactConfigured));
    if (this.pendingContact && application && ['PENDING', 'APPROVED', 'REJECTED'].includes(application.status)
      && sameProofs(this.pendingContact.payload.detail.proofKeys, proofs.map(proof => proof.id))
      && (application.status !== 'REJECTED' || application.revision > (this.pendingContact.payload.expectedRevision || 0))) {
      this.pendingContact = null; clearPendingMemberAction('enterprise'); this.setData({ contactPendingReady: false, contactProofItems: [], contactNote: '' });
    }
    this.setData({ contactInfo: info || null, contactAvailable: available, contactQrAvailable: !!(info?.enabled && safeQrImage(info.qrImageUrl)), contactApplication: application || null,
      contactApplicationProofs: proofs, contactCanSubmit: !!(available && task?.enabled && overview?.registered && !['PENDING', 'APPROVED'].includes(application?.status)) });
  },
  changeContactNote(event) { if (!this.data.busy && !this.data.contactUploading && !this.pendingContact) this.setData({ contactNote: event.detail.value }); },
  previewContact() { const value = this.data.overview?.enterpriseContact; if (value?.enabled && safeQrImage(value.qrImageUrl)) wx.previewImage({ current: value.qrImageUrl, urls: [value.qrImageUrl] }); },
  chooseContactProof() {
    if (!this.canOperate() || !this.data.contactCanSubmit || this.data.contactUploading || this.selectingContactProof || this.pendingContact || this.data.contactProofItems.length >= 3) return;
    this.selectingContactProof = true;
    const owner = this.contactOwner, generation = this.contactGeneration, count = 3 - this.data.contactProofItems.length;
    const accept = files => {
      if (!this.sameContactOwner(owner, generation)) return;
      this.selectingContactProof = false;
      if (files.some(file => !localSocialImage(file.tempFilePath) || Number.isFinite(file.size) && file.size > 3 * 1024 * 1024)) { this.setData({ error: '请选择不超过3MB的JPG、PNG或WebP截图。' }); return; }
      this.setData({ contactProofItems: [...this.data.contactProofItems, ...files.slice(0, count).map(file => ({ localId: createMemberRequestId(), localPath: file.tempFilePath, uploadRequestId: createMemberRequestId(), id: '', url: '', existing: false }))], error: '' });
    };
    const fail = error => { if (this.sameContactOwner(owner, generation)) { this.selectingContactProof = false; if (!String(error?.errMsg || '').includes('cancel')) this.setData({ error: '未能选择截图，请重试。' }); } };
    if (typeof wx.chooseMedia === 'function') wx.chooseMedia({ count, mediaType: ['image'], sourceType: ['album', 'camera'], sizeType: ['compressed'], success: result => accept(result.tempFiles || []), fail });
    else if (typeof wx.chooseImage === 'function') wx.chooseImage({ count, sourceType: ['album', 'camera'], sizeType: ['compressed'], success: result => accept((result.tempFiles || []).map(file => ({ ...file, tempFilePath: file.path }))), fail });
    else fail({ errMsg: 'unsupported' });
  },
  async removeContactProof(event) {
    const index = Number(event.currentTarget.dataset.index), proof = this.data.contactProofItems[index];
    if (!proof || !this.canOperate() || this.data.contactUploading || this.pendingContact) return;
    const owner = this.contactOwner, generation = this.contactGeneration; this.setData({ contactUploading: true, error: '' });
    try { if (proof.id && !proof.existing) await removeUnusedSocialProof(proof); if (this.sameContactOwner(owner, generation)) this.setData({ contactProofItems: this.data.contactProofItems.filter((_, position) => position !== index) }); }
    catch (error) { if (this.sameContactOwner(owner, generation)) this.setData({ error: memberSocialError(error) || memberOperationsError(error) }); }
    finally { if (this.sameContactOwner(owner, generation)) this.setData({ contactUploading: false }); }
  },
  async previewContactProof(event) {
    const { index, id } = event.currentTarget.dataset;
    const proof = id ? this.data.contactApplicationProofs.find(item => item.id === id) : this.data.contactProofItems[Number(index)];
    if (!proof || this.data.contactPreviewingProofId || !this.sameContactOwner(this.contactOwner, this.contactGeneration)) return;
    if (localSocialImage(proof.localPath)) { wx.previewImage({ current: proof.localPath, urls: [proof.localPath] }); return; }
    const owner = this.contactOwner, generation = this.contactGeneration; this.setData({ contactPreviewingProofId: proof.id, error: '' });
    try { const localPath = this.contactPreviews.get(proof.id) || await downloadSocialProof(proof); if (!this.sameContactOwner(owner, generation)) return; this.contactPreviews.set(proof.id, localPath); wx.previewImage({ current: localPath, urls: [localPath] }); }
    catch (error) { if (this.sameContactOwner(owner, generation)) this.setData({ error: memberSocialError(error) || memberOperationsError(error) }); }
    finally { if (this.sameContactOwner(owner, generation)) this.setData({ contactPreviewingProofId: '' }); }
  },
  async submitContact() {
    if (!this.canOperate() || !this.data.contactCanSubmit || this.data.contactUploading || this.pendingContact) return;
    if (this.data.contactProofItems.length < 1 || this.data.contactProofItems.length > 3) { this.setData({ error: '请添加1—3张已添加品牌顾问的截图。' }); return; }
    const note = this.data.contactNote.trim(); if (note.length > 300) { this.setData({ error: '核验说明请控制在300字以内。' }); return; }
    const owner = this.contactOwner, generation = this.contactGeneration; this.setData({ contactUploading: true, error: '', notice: '' });
    try {
      const proofs = [...this.data.contactProofItems];
      for (let index = 0; index < proofs.length; index++) {
        if (!proofs[index].id) {
          const proof = await uploadSocialProof(proofs[index].localPath, proofs[index].uploadRequestId, 'ENTERPRISE');
          if (!this.sameContactOwner(owner, generation)) return;
          proofs[index] = { ...proofs[index], ...readSocialProof(proof) }; this.setData({ contactProofItems: [...proofs] });
        } else readSocialProof(proofs[index]);
      }
      if (!this.sameContactOwner(owner, generation)) return;
      const payload = { taskKey: 'ENTERPRISE', detail: { note, proofKeys: proofs.map(proof => proof.id) }, ...(this.data.contactApplication ? { expectedRevision: this.data.contactApplication.revision } : {}) };
      const pending = { target: JSON.stringify(payload), requestId: createMemberRequestId(), payload };
      if (!validPending(pending)) throw Error('INVALID_MEMBER_OPERATION');
      this.pendingContact = pending; savePendingMemberAction('enterprise', pending); this.setData({ contactPendingReady: true, contactUploading: false });
      await this.sendContactSubmission(pending, owner, generation);
    } catch (error) { if (this.sameContactOwner(owner, generation)) this.setData({ error: memberSocialError(error) || memberOperationsError(error) }); }
    finally { if (this.sameContactOwner(owner, generation)) this.setData({ contactUploading: false }); }
  },
  async retryContactSubmission() { if (this.canOperate() && this.data.contactCanSubmit && !this.data.contactUploading && this.pendingContact) await this.sendContactSubmission(this.pendingContact, this.contactOwner, this.contactGeneration); },
  async sendContactSubmission(pending, owner, generation) {
    if (!validPending(pending) || !this.sameContactOwner(owner, generation)) return;
    this.setData({ busy: true, error: '', notice: '' });
    try {
      const result = await memberOperation('submit_application', pending.payload);
      if (!this.sameContactOwner(owner, generation)) return;
      if (typeof result?.application?.id !== 'string' || result.application.taskKey !== 'ENTERPRISE' || !['PENDING', 'APPROVED', 'REJECTED'].includes(result.application.status)) throw Error('INVALID_MEMBER_OPERATION_RESPONSE');
      this.pendingContact = null; clearPendingMemberAction('enterprise'); this.setData({ contactPendingReady: false, contactProofItems: [], contactNote: '' });
      const synced = await this.loadOperations();
      if (this.sameContactOwner(owner, generation)) this.setData({ notice: result.application.status === 'APPROVED' ? '核验已通过。' : result.application.status === 'REJECTED' ? '申请未通过，请修改后重新提交。' : '已提交，等待人工核验。', ...(synced ? {} : { error: '记录暂未刷新，请重新加载。' }) });
    } catch (error) {
      if (!this.sameContactOwner(owner, generation)) return;
      if (['MEMBER_OPERATIONS_DISABLED', 'INVALID_MEMBER_OPERATION', 'MEMBER_SOCIAL_PROOF_INVALID', 'MEMBER_SOCIAL_PROOF_REQUIRED', 'MEMBER_OPERATIONS_REVISION_CONFLICT', 'MEMBER_OPERATIONS_ALREADY_COMPLETED', 'MEMBER_PHONE_REQUIRED', 'MEMBERSHIP_REQUIRED', 'MEMBER_CUSTOMER_REQUIRED'].includes(error?.message)) { this.pendingContact = null; clearPendingMemberAction('enterprise'); this.setData({ contactPendingReady: false }); }
      this.setData({ error: memberSocialError(error) || memberOperationsError(error) });
    } finally { if (this.sameContactOwner(owner, generation)) this.setData({ busy: false }); }
  },
  async claimProfile() { if (!this.data.contactUploading && this.data.overview?.profileClaimable) await this.performOperation('claim_task', { taskKey: 'PROFILE' }, '资料奖励核验已完成，请查看最新积分记录。'); },
}, ["goLogin","loadOperations","joinMember","openPoints","goShopping","openTask","claimProfile","openRoute","previewContact","previewContactProof","retryContactSubmission","removeContactProof","chooseContactProof","submitContact","closeContact"]));

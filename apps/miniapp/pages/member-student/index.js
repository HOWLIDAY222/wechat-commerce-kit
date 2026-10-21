import { withTapFeedback } from '../../utils/tap-feedback';
import { operationsPage } from '../../utils/member-operations-page';
import { memberOperationsError, dateLabel } from '../../models/member-operations';
import { downloadSocialProof } from '../../services/member-social';
import { memberSocialError } from '../../models/member-social';
import { hasSession, readStoredUser } from '../../stores/session';

const lifecycle = operationsPage({ route: '/pages/member-student/index', loaded(overview) {
  const application = overview.myApplications.find(item => item.taskKey === 'STUDENT');
  const student = overview.student, enabled = overview.tasks.some(item => item.key === 'STUDENT' && item.enabled) && student?.verification?.available;
  this.setData({ application: application || null, studentEnabled: !!enabled, canSubmit: !!enabled && !student?.valid, studentValid: !!student?.valid, testVerified: !!student?.testVerified,
    validUntilLabel: dateLabel(student?.certification?.validUntil).slice(0, 10), benefitsVisible: !!student?.benefitsEnabled,
    firstSocialPoints: student?.benefitsEnabled ? student.firstSocialPoints || 1500 : 0, firstCertificationPoints: enabled ? 100 : 0 });
} });

Page(withTapFeedback({
  ...lifecycle,
  data: { overview: null, loading: false, busy: false, guest: false, syncFailed: false, error: '', notice: '', application: null,
    canSubmit: false, benefitsVisible: false, coupons: [], firstSocialPoints: 0, firstCertificationPoints: 0, studentValid: false,
    proofItems: [], school: '', graduationYear: '', confirmed: false, previewingProofId: '' },
  loadOperations() {
    const owner = hasSession() ? readStoredUser()?.id || '' : '';
    if (owner !== this.studentOwner) {
      this.studentOwner = owner; this.studentGeneration = (this.studentGeneration || 0) + 1; this.studentPreviews = new Map();
      this.setData({ application: null, proofItems: [], school: '', graduationYear: '', confirmed: false, previewingProofId: '', canSubmit: false,
        studentEnabled: false, studentValid: false, testVerified: false, benefitsVisible: false, validUntilLabel: '', firstSocialPoints: 0, firstCertificationPoints: 0 });
    }
    return lifecycle.loadOperations.call(this);
  },
  onUnload() { this.studentGeneration = (this.studentGeneration || 0) + 1; this.studentPreviews?.clear(); lifecycle.onUnload.call(this); },
  sameStudentOwner(owner, generation) {
    return !this.disposed && hasSession() && owner === readStoredUser()?.id && owner === this.studentOwner && generation === this.studentGeneration;
  },
  // Retired manual verification callbacks cannot upload evidence or award points.
  chooseProof() { this.setData({ notice: '暂未开放' }); return false; },
  submit() { this.setData({ notice: '暂未开放' }); return false; },
  verifyStudent() {
    if (!this.canOperate() || !this.data.canSubmit) return;
    wx.navigateTo({ url: '/packages/student/entry?start=1' });
  },
  openSocial() { wx.navigateTo({ url: '/pages/member-community/index?tab=share' }); },
  async previewProof(event) {
    const id = event?.currentTarget?.dataset?.id, proof = this.data.application?.proofs?.find(item => item.id === id);
    if (!proof || this.data.previewingProofId || !this.sameStudentOwner(this.studentOwner, this.studentGeneration)) return;
    const owner = this.studentOwner, generation = this.studentGeneration;
    this.setData({ previewingProofId: proof.id, error: '' });
    try {
      const localPath = this.studentPreviews?.get(proof.id) || await downloadSocialProof(proof);
      if (!this.sameStudentOwner(owner, generation)) return;
      this.studentPreviews.set(proof.id, localPath); wx.previewImage({ current: localPath, urls: [localPath] });
    } catch (error) {
      if (this.sameStudentOwner(owner, generation)) this.setData({ error: memberSocialError(error) || memberOperationsError(error) });
    } finally { if (this.sameStudentOwner(owner, generation)) this.setData({ previewingProofId: '' }); }
  },
}, ["loadOperations","goLogin","joinMember","openSocial","verifyStudent","previewProof"]));

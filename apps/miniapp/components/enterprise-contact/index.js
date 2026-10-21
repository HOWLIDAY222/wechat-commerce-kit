import { enterpriseContact } from '../../config/enterprise-contact';
import { contactResult } from '../../models/enterprise-contact';
import { isPrivacyAccepted } from '../../stores/privacy-consent';
import { observePrivacyDecision } from '../../utils/privacy-flow';

Component({
  properties: {
    heading: { type: String, value: '品牌顾问' },
  },
  data: {
    contactWayId: enterpriseContact.configId,
    configured: false,
    statusMessage: '',
    statusError: false,
  },
  lifetimes: {
    attached() { this.contactDetached = false; this.updatePrivacy(); this.removePrivacyObserver = observePrivacyDecision(() => { if (!this.contactDetached) this.updatePrivacy(); }); },
    detached() { this.contactDetached = true; this.removePrivacyObserver?.(); },
  },
  pageLifetimes: { show() { this.updatePrivacy(); } },
  methods: {
    updatePrivacy() { this.setData({ configured: isPrivacyAccepted() && enterpriseContact.enabled && /^[a-f0-9]{32}$/.test(enterpriseContact.configId) }); },
    onContactStart() {
      if (this.contactDetached || !isPrivacyAccepted()) return;
      this.setData({ statusMessage: '请按微信提示联系顾问。', statusError: false });
    },
    onContactComplete(event) {
      if (this.contactDetached || !isPrivacyAccepted()) return;
      const result = contactResult(event?.detail);
      this.setData({ statusMessage: result.message, statusError: result.isError });
    },
  },
});

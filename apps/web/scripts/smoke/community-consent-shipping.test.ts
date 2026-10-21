import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCurrentPrivacyConsent, PRIVACY_POLICY_CONSENT_VERSION } from '../../lib/privacy-policy';
import { calculateShippingQuote, describeShippingRates } from '../../lib/commerce/shipping-rates';

test('current policy acceptance works without inventing a data-transfer consent', () => {
  assert.equal(hasCurrentPrivacyConsent({ privacyAccepted: true, privacyConsentVersion: PRIVACY_POLICY_CONSENT_VERSION }), true);
  assert.equal(hasCurrentPrivacyConsent({ privacyAccepted: false, privacyConsentVersion: PRIVACY_POLICY_CONSENT_VERSION }), false);
});

test('missing, string-valued and outdated policy acceptance stays rejected', () => {
  for (const value of [null, {}, { privacyAccepted: 'true', privacyConsentVersion: PRIVACY_POLICY_CONSENT_VERSION }, { privacyAccepted: true, privacyConsentVersion: 'old-policy' }]) {
    assert.equal(hasCurrentPrivacyConsent(value), false);
  }
});

test('legacy clients keep their explicit consent field compatible', () => {
  assert.equal(hasCurrentPrivacyConsent({ crossBorderConsent: true, privacyConsentVersion: PRIVACY_POLICY_CONSENT_VERSION }), true);
  assert.equal(hasCurrentPrivacyConsent({ crossBorderConsent: false, privacyConsentVersion: PRIVACY_POLICY_CONSENT_VERSION }), false);
});

test('demo free shipping is described consistently with the actual quotes', () => {
  const rates = { baseFeeCents: 0, remoteFeeCents: 0, farRemoteFeeCents: 0 };
  assert.equal(describeShippingRates(rates), '中国大陆配送：包邮');
  for (const province of ['山东省', '甘肃省', '新疆维吾尔自治区']) assert.equal(calculateShippingQuote(province, rates).feeCents, 0);
});

test('changed delivery tiers update both the summary and regional quotes', () => {
  const rates = { baseFeeCents: 600, remoteFeeCents: 1500, farRemoteFeeCents: 2800 };
  assert.equal(describeShippingRates(rates), '标准地区 ¥6.00；特殊地区 ¥15.00；偏远地区 ¥28.00');
  assert.equal(calculateShippingQuote('山东省', rates).feeCents, 600);
  assert.equal(calculateShippingQuote('甘肃省', rates).feeCents, 1500);
  assert.equal(calculateShippingQuote('新疆维吾尔自治区', rates).feeCents, 2800);
});

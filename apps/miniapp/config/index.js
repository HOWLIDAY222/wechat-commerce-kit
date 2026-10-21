// Public client configuration only. Never put AppSecret or payment keys here.
export const config = Object.freeze({
  apiBaseUrl: 'https://example.invalid', websiteBaseUrl: 'https://example.invalid',
  operatorName: '演示商家', contactEmail: '',
  requestTimeout: 12000, catalogCacheMs: 60000, contentCacheMs: 60000,
  privacyConsentVersion: 'privacy-v1.0-demo-2026-10-21', authProvider: 'wechat', paymentProvider: 'wechat',
  privacyNoticeVersion: 'privacy-v1.0-demo-2026-10-21', miniProgramPrivacyVersion: 'community-miniapp-privacy-v1',
  accountEnabled: true, checkoutEnabled: true, paymentEnabled: false,
  isDevelopment: true, isProduction: false,
});

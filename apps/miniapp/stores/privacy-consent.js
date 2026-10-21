import { config } from '../config/index';

export const privacyChoiceKey = 'merchantkit.privacy.choice.v1';
let temporaryBrowse = false;
export function readPrivacyChoice() {
  try {
    const value = wx.getStorageSync(privacyChoiceKey);
    return value && value.version === config.privacyNoticeVersion && value.miniProgramVersion === config.miniProgramPrivacyVersion
      && ['accepted', 'browse'].includes(value.choice) && typeof value.decidedAt === 'string' && Number.isFinite(Date.parse(value.decidedAt)) ? value : null;
  } catch { return null; }
}
export function isPrivacyAccepted() { return !temporaryBrowse && readPrivacyChoice()?.choice === 'accepted'; }
export function hasPrivacyChoice() { return temporaryBrowse || !!readPrivacyChoice(); }
export function assertPrivacyAccepted() { if (!isPrivacyAccepted()) throw Error('PRIVACY_CONSENT_REQUIRED'); }
export function savePrivacyChoice(choice) {
  if (!['accepted', 'browse'].includes(choice)) throw Error('INVALID_PRIVACY_CHOICE');
  const value = { version: config.privacyNoticeVersion, miniProgramVersion: config.miniProgramPrivacyVersion, choice, decidedAt: new Date().toISOString() };
  try {
    wx.setStorageSync(privacyChoiceKey, value);
    if (readPrivacyChoice()?.choice !== choice) throw Error('PRIVACY_STORAGE_FAILED');
    temporaryBrowse = choice === 'browse'; return true;
  } catch { if (choice === 'browse') { temporaryBrowse = true; return false; } throw Error('PRIVACY_STORAGE_FAILED'); }
}

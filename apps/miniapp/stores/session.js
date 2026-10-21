const sessionKey = 'merchantkit.session';
const userKey = 'merchantkit.user';

export function readSession() {
  if (!isPrivacyAccepted()) return null;
  const session = wx.getStorageSync(sessionKey);
  if (!session?.accessToken || !session?.expiresAt) return null;
  if (!Number.isFinite(new Date(session.expiresAt).getTime()) || new Date(session.expiresAt).getTime() <= Date.now()) {
    clearSession();
    return null;
  }
  return session;
}

export function readAccessToken() {
  return readSession()?.accessToken || '';
}

export function readStoredUser() {
  if (!isPrivacyAccepted()) return null;
  return wx.getStorageSync(userKey) || null;
}

export function writeSession(session, user) {
  assertPrivacyAccepted();
  wx.setStorageSync(sessionKey, session);
  if (user) wx.setStorageSync(userKey, user);
}

export function writeStoredUser(user) {
  assertPrivacyAccepted();
  if (user) wx.setStorageSync(userKey, user);
}

export function clearSession() {
  wx.removeStorageSync(sessionKey);
  wx.removeStorageSync(userKey);
  wx.removeStorageSync('merchantkit.checkoutAddress');
}

export function hasSession() {
  return Boolean(readSession());
}

import { assertPrivacyAccepted, isPrivacyAccepted } from './privacy-consent';

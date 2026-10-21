import { config } from '../config/index';
import {
  clearSession,
  hasSession,
  readStoredUser,
  writeSession,
  writeStoredUser,
} from '../stores/session';
import { request } from './http';
import { assertPrivacyAccepted } from '../stores/privacy-consent';

export async function loginWithWeChat(consent) {
  assertPrivacyAccepted();
  if (!config.accountEnabled || !config.privacyConsentVersion) throw new Error('ACCOUNT_NOT_READY');
  if (consent?.privacyConsent !== true || consent?.crossBorderConsent !== true) throw new Error('PRIVACY_CONSENT_REQUIRED');
  const code = await requestWeChatLoginCode();
  const response = await request({
    path: '/api/miniprogram/auth/wechat',
    method: 'POST',
    auth: 'none',
    data: {
      code,
      crossBorderConsent: true,
      privacyConsentVersion: config.privacyConsentVersion,
      miniProgramPrivacyVersion: config.miniProgramPrivacyVersion,
    },
  });
  if (!response?.ok || !response.session?.accessToken || !response.user) {
    throw new Error('INVALID_WECHAT_LOGIN_RESPONSE');
  }
  writeSession(response.session, response.user);
  return response.user;
}

export async function fetchCurrentUser() {
  const response = await request({ path: '/api/miniprogram/me', auth: 'required' });
  if (!response?.ok || !response.user) throw new Error('INVALID_ACCOUNT_RESPONSE');
  writeStoredUser(response.user);
  return response.user;
}

export async function logout() {
  if (hasSession()) {
    await request({ path: '/api/miniprogram/auth/logout', method: 'POST', auth: 'required' }).catch(() => null);
  }
  clearSession();
}

export async function sendPhoneLinkCode(phone) {
  const response = await request({
    path: '/api/miniprogram/auth/link-phone/send',
    method: 'POST',
    auth: 'required',
    data: {
      phone,
      crossBorderConsent: true,
      privacyConsentVersion: config.privacyConsentVersion,
    },
  });
  if (!response?.ok) throw new Error('INVALID_PHONE_LINK_RESPONSE');
  return response;
}

export async function linkPhoneToAccount(phone, code) {
  const response = await request({
    path: '/api/miniprogram/auth/link-phone/verify',
    method: 'POST',
    auth: 'required',
    data: {
      phone,
      code,
      crossBorderConsent: true,
      privacyConsentVersion: config.privacyConsentVersion,
    },
  });
  if (!response?.ok || !response.session?.accessToken || !response.user) {
    throw new Error('INVALID_PHONE_LINK_RESPONSE');
  }
  writeSession(response.session, response.user);
  return response.user;
}

export async function linkWeChatPhone(code) {
  if (typeof code !== 'string' || !code) throw new Error('WECHAT_PHONE_CODE_INVALID');
  const response = await request({
    path: '/api/miniprogram/auth/link-phone/wechat', method: 'POST', auth: 'required', retries: 0,
    data: { code, crossBorderConsent: true, privacyConsentVersion: config.privacyConsentVersion,
      miniProgramPrivacyVersion: config.miniProgramPrivacyVersion },
  });
  if (!response?.ok || !response.session?.accessToken || !response.user) throw new Error('INVALID_PHONE_LINK_RESPONSE');
  writeSession(response.session, response.user);
  return response.user;
}

export function getCachedUser() {
  return readStoredUser();
}

function requestWeChatLoginCode() {
  return new Promise((resolve, reject) => {
    wx.login({
      timeout: config.requestTimeout,
      success(result) {
        if (result.code) resolve(result.code);
        else reject(new Error('WECHAT_LOGIN_CODE_MISSING'));
      },
      fail(error) {
        reject(new Error(error?.errMsg || 'WECHAT_LOGIN_FAILED'));
      },
    });
  });
}

import { config } from '../config/index';
import { readAccessToken, clearSession } from '../stores/session';
import { request } from './http';
import { readMemberAvatar, localAvatarPath } from '../models/member-avatar';
import { isPrivacyAccepted } from '../stores/privacy-consent';

const endpoint = '/api/account/member-profile/avatar';
function assertCurrent(token) { if (!token) throw new Error('AUTH_REQUIRED'); if (readAccessToken() !== token) throw new Error('SESSION_CHANGED'); }
export function downloadMemberAvatar(avatar) {
  if (!isPrivacyAccepted()) return Promise.reject(new Error('PRIVACY_CONSENT_REQUIRED'));
  if (!avatar?.hasAvatar) return Promise.resolve('');
  const token = readAccessToken();
  if (!token) return Promise.reject(new Error('AUTH_REQUIRED'));
  return new Promise((resolve, reject) => {
    wx.downloadFile({ url: config.apiBaseUrl + endpoint + '?revision=' + avatar.revision, timeout: config.requestTimeout,
      header: { Authorization: 'Bearer ' + token, 'Cache-Control': 'no-cache' },
      success(result) {
        try { assertCurrent(token); } catch (error) { reject(error); return; }
        if (result.statusCode === 401) clearSession();
        if (result.statusCode !== 200 || !localAvatarPath(result.tempFilePath)) { reject(new Error('MEMBER_AVATAR_DOWNLOAD_FAILED')); return; }
        resolve(result.tempFilePath);
      }, fail() { reject(new Error('MEMBER_AVATAR_DOWNLOAD_FAILED')); },
    });
  });
}
export function uploadMemberAvatar(filePath, expectedRevision) {
  if (!isPrivacyAccepted()) return Promise.reject(new Error('PRIVACY_CONSENT_REQUIRED'));
  if (!localAvatarPath(filePath) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return Promise.reject(new Error('INVALID_MEMBER_AVATAR'));
  const token = readAccessToken();
  if (!token) return Promise.reject(new Error('AUTH_REQUIRED'));
  return new Promise((resolve, reject) => {
    wx.uploadFile({ url: config.apiBaseUrl + endpoint, filePath, name: 'file', timeout: config.requestTimeout,
      header: { Authorization: 'Bearer ' + token, 'X-Client-Channel': 'wechat-miniprogram' }, formData: { expectedRevision: String(expectedRevision) },
      success(result) {
        try {
          assertCurrent(token);
          if (result.statusCode === 401) clearSession();
          let body; try { body = JSON.parse(result.data || '{}'); } catch { throw new Error('INVALID_MEMBER_AVATAR_RESPONSE'); }
          if (result.statusCode < 200 || result.statusCode >= 300 || !body?.ok) throw Object.assign(new Error(body?.error || 'MEMBER_AVATAR_UPLOAD_FAILED'), { statusCode: result.statusCode });
          resolve(readMemberAvatar(body.avatar));
        } catch (error) { reject(error); }
      }, fail() { reject(new Error('MEMBER_AVATAR_UPLOAD_FAILED')); },
    });
  });
}
export async function removeMemberAvatar(expectedRevision) {
  const response = await request({ path: endpoint, method: 'DELETE', data: { expectedRevision }, auth: 'required', retries: 0 });
  if (!response?.ok) throw new Error('INVALID_MEMBER_AVATAR_RESPONSE');
  return readMemberAvatar(response.avatar);
}

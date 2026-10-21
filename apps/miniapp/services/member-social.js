import { config } from '../config/index';
import { readAccessToken, clearSession } from '../stores/session';
import { request } from './http';
import { localSocialImage, readSocialProof } from '../models/member-social';
import { isPrivacyAccepted } from '../stores/privacy-consent';
const endpoint = '/api/miniprogram/member-operations/proofs';
function current(token) { if (!token) throw new Error('AUTH_REQUIRED'); if (readAccessToken() !== token) throw new Error('SESSION_CHANGED'); }
export function uploadSocialProof(filePath, requestId, purpose = 'SOCIAL') {
  if (!isPrivacyAccepted()) return Promise.reject(new Error('PRIVACY_CONSENT_REQUIRED'));
  if (!localSocialImage(filePath) || !/^[A-Za-z0-9_-]{8,80}$/.test(requestId || '')) return Promise.reject(new Error('INVALID_SOCIAL_IMAGE'));
  if (!['SOCIAL', 'STUDENT', 'ENTERPRISE'].includes(purpose)) return Promise.reject(new Error('INVALID_MEMBER_OPERATION'));
  const token = readAccessToken(); if (!token) return Promise.reject(new Error('AUTH_REQUIRED'));
  return new Promise((resolve, reject) => {
    wx.uploadFile({ url: config.apiBaseUrl + endpoint, filePath, name: 'file', timeout: config.requestTimeout,
      header: { Authorization: 'Bearer ' + token, 'X-Client-Channel': 'wechat-miniprogram' }, formData: { requestId, purpose },
      success(result) { try {
        current(token); if (result.statusCode === 401) clearSession();
        let body; try { body = JSON.parse(result.data || '{}'); } catch { throw new Error('INVALID_SOCIAL_PROOF_RESPONSE'); }
        if (result.statusCode < 200 || result.statusCode >= 300 || !body?.ok) throw Object.assign(new Error(body?.error || 'SOCIAL_PROOF_UPLOAD_FAILED'), { statusCode: result.statusCode });
        resolve(readSocialProof(body.proof));
      } catch (error) { reject(error); } }, fail() { reject(new Error('SOCIAL_PROOF_UPLOAD_FAILED')); },
    });
  });
}
export function downloadSocialProof(proof) {
  if (!isPrivacyAccepted()) return Promise.reject(new Error('PRIVACY_CONSENT_REQUIRED'));
  let safe; try { safe = readSocialProof(proof); } catch (error) { return Promise.reject(error); }
  const token = readAccessToken(); if (!token) return Promise.reject(new Error('AUTH_REQUIRED'));
  return new Promise((resolve, reject) => {
    wx.downloadFile({ url: config.apiBaseUrl + safe.url, timeout: config.requestTimeout, header: { Authorization: 'Bearer ' + token, 'Cache-Control': 'no-cache' },
      success(result) { try { current(token); if (result.statusCode === 401) clearSession(); if (result.statusCode !== 200 || !localSocialImage(result.tempFilePath)) throw new Error('SOCIAL_PROOF_DOWNLOAD_FAILED'); resolve(result.tempFilePath); } catch (error) { reject(error); } },
      fail() { reject(new Error('SOCIAL_PROOF_DOWNLOAD_FAILED')); },
    });
  });
}
export async function removeUnusedSocialProof(proof) {
  const safe = readSocialProof(proof);
  const body = await request({ path: safe.url, method: 'DELETE', auth: 'required', retries: 0 });
  if (!body?.ok) throw new Error('INVALID_SOCIAL_PROOF_RESPONSE');
}

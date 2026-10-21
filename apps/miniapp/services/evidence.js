import { config } from '../config/index';
import { readAccessToken, clearSession } from '../stores/session';
import { assertPrivacyAccepted } from '../stores/privacy-consent';

let session = '';
const cache = new Map();
export async function loadEvidenceImages(item) {
  assertPrivacyAccepted();
  const token = readAccessToken();
  if (token !== session) { cache.clear(); session = token; }
  const results = await Promise.allSettled((item.imageUrls || []).map(url => download(url, token)));
  if (token && readAccessToken() !== token) throw new Error('AUTH_REQUIRED');
  return { ...item, evidenceImages: results.filter(r => r.status === 'fulfilled').map(r => r.value),
    evidenceLoadError: results.some(r => r.status === 'rejected') };
}

function download(url, token) {
  // Bearer tokens must never be sent to third-party or non-evidence URLs.
  if (!token) return Promise.reject(new Error('AUTH_REQUIRED'));
  if (typeof url !== 'string' || !url.startsWith(`${config.apiBaseUrl}/uploads/after-sales/`)) return Promise.reject(new Error('INVALID_EVIDENCE_URL'));
  if (cache.has(url)) return cache.get(url);
  const promise = new Promise((resolve, reject) => {
    wx.downloadFile({ url: `${url}${url.includes('?') ? '&' : '?'}private=1`, timeout: config.requestTimeout,
      header: { Authorization: `Bearer ${token}`, 'Cache-Control': 'no-cache' },
      success(result) {
        if (result.statusCode === 401 && readAccessToken() === token) clearSession();
        if (result.statusCode !== 200 || !result.tempFilePath) return reject(new Error('EVIDENCE_DOWNLOAD_FAILED'));
        if (readAccessToken() !== token) return reject(new Error('AUTH_REQUIRED'));
        resolve(result.tempFilePath);
      },
      fail() { reject(new Error('EVIDENCE_DOWNLOAD_FAILED')); },
    });
  }).catch(error => { if (cache.get(url) === promise) cache.delete(url); throw error; });
  if (cache.size >= 24) cache.delete(cache.keys().next().value);
  cache.set(url, promise);
  return promise;
}

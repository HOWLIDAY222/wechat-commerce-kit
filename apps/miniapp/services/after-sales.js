import { normalizeAfterSales } from '../models/after-sales';
import { config } from '../config/index';
import { clearSession, readAccessToken } from '../stores/session';
import { request } from './http';
import { loadEvidenceImages } from './evidence';
import { isPrivacyAccepted } from '../stores/privacy-consent';

export async function fetchAfterSalesList() {
  const response = await request({ path: '/api/account/after-sales', auth: 'required' });
  if (!response?.ok || !Array.isArray(response.afterSales)) throw new Error('INVALID_AFTER_SALES_RESPONSE');
  return response.afterSales.map(normalizeAfterSales);
}

export async function fetchAfterSales(afterSalesNo) {
  const response = await request({
    path: `/api/account/after-sales/${encodeURIComponent(afterSalesNo)}`,
    auth: 'required',
  });
  if (!response?.ok || !response.afterSales) throw new Error('INVALID_AFTER_SALES_RESPONSE');
  return loadEvidenceImages(normalizeAfterSales(response.afterSales));
}

export async function createAfterSales(data) {
  const response = await request({
    path: '/api/account/after-sales',
    method: 'POST',
    data,
    auth: 'required',
  });
  if (!response?.ok || !response.afterSales) throw new Error('INVALID_AFTER_SALES_RESPONSE');
  return normalizeAfterSales(response.afterSales);
}

export async function addAfterSalesMessage(afterSalesNo, message) {
  const response = await request({
    path: `/api/account/after-sales/${encodeURIComponent(afterSalesNo)}/messages`,
    method: 'POST',
    data: { message },
    auth: 'required',
  });
  if (!response?.ok || !response.afterSales) throw new Error('INVALID_AFTER_SALES_RESPONSE');
  return loadEvidenceImages(normalizeAfterSales(response.afterSales));
}

export async function submitReturnShipment(afterSalesNo, data) {
  const response = await request({
    path: `/api/account/after-sales/${encodeURIComponent(afterSalesNo)}/return-shipment`,
    method: 'POST',
    data,
    auth: 'required',
  });
  if (!response?.ok || !response.afterSales) throw new Error('INVALID_AFTER_SALES_RESPONSE');
  return loadEvidenceImages(normalizeAfterSales(response.afterSales));
}

export function uploadAfterSalesImage(afterSalesNo, filePath) {
  if (!isPrivacyAccepted()) return Promise.reject(new Error('PRIVACY_CONSENT_REQUIRED'));
  return new Promise((resolve, reject) => {
    const accessToken = readAccessToken();
    if (!accessToken) {
      reject(new Error('AUTH_REQUIRED'));
      return;
    }
    wx.uploadFile({
      url: `${config.apiBaseUrl}/api/account/after-sales/${encodeURIComponent(afterSalesNo)}/images`,
      filePath,
      name: 'file',
      timeout: config.requestTimeout,
      header: {
        Authorization: `Bearer ${accessToken}`,
        'X-Client-Channel': 'wechat-miniprogram',
      },
      success(response) {
        if (readAccessToken() !== accessToken) return reject(new Error('SESSION_CHANGED'));
        if (response.statusCode === 401) clearSession();
        let payload;
        try {
          payload = JSON.parse(response.data || '{}');
        } catch {
          reject(new Error('INVALID_AFTER_SALES_UPLOAD_RESPONSE'));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300 || !payload?.ok || !payload.afterSales) {
          const error = new Error(payload?.error || `HTTP_${response.statusCode}`);
          error.statusCode = response.statusCode;
          reject(error);
          return;
        }
        resolve(loadEvidenceImages(normalizeAfterSales(payload.afterSales)));
      },
      fail(error) {
        reject(new Error(error?.errMsg || 'AFTER_SALES_IMAGE_UPLOAD_FAILED'));
      },
    });
  });
}

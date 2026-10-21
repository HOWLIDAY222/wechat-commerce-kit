import { config } from '../config/index';
import { clearSession, readAccessToken } from '../stores/session';
import { isPrivacyAccepted } from '../stores/privacy-consent';
import { openPrivacyPage } from '../utils/privacy-flow';

function publicRead(path, method, auth) {
  return method === 'GET' && auth !== 'required' && typeof path === 'string'
    && /^(?:\/api\/products(?:[/?]|$)|\/api\/miniprogram\/(?:pages\/[a-z0-9-]+|layouts\/[a-z0-9-]+|newcomer|subscriptions)(?:\?|$))/.test(path);
}

export function request({ path, method = 'GET', data, headers = {}, auth = 'optional', retries, timeout }) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const retryLimit = Number.isInteger(retries) ? Math.max(0, retries) : (normalizedMethod === 'GET' ? 1 : 0);
  return new Promise((resolve, reject) => {
    const anonymousRead = publicRead(path, normalizedMethod, auth);
    if (!isPrivacyAccepted() && !anonymousRead) { try { openPrivacyPage(); } catch {} reject(new Error('PRIVACY_CONSENT_REQUIRED')); return; }
    const accessToken = auth === 'none' || !isPrivacyAccepted() ? '' : readAccessToken();
    if (auth === 'required' && !accessToken) {
      const error = new Error('AUTH_REQUIRED');
      error.statusCode = 401;
      reject(error);
      return;
    }

    const execute = (attempt) => {
      const accepted = isPrivacyAccepted();
      if (!accepted && !anonymousRead) { reject(new Error('PRIVACY_CONSENT_REQUIRED')); return; }
      const safeHeaders = { ...headers };
      if (!accepted) for (const key of Object.keys(safeHeaders)) if (key.toLowerCase() === 'authorization') delete safeHeaders[key];
      wx.request({
        url: `${config.apiBaseUrl}${path}`,
        method: normalizedMethod,
        data,
        timeout: Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 60000 ? timeout : config.requestTimeout,
        enableHttp2: true,
        // Trade requests always use fresh responses; public browsing has its
        // own bounded catalog/content cache above this transport layer.
        enableCache: false,
        header: {
          'Content-Type': 'application/json',
          'X-Client-Channel': 'wechat-miniprogram',
          ...(accepted && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          ...safeHeaders,
        },
        success(response) {
          if (accessToken && !isPrivacyAccepted()) { reject(new Error('PRIVACY_CONSENT_REQUIRED')); return; }
          if (accessToken && readAccessToken() !== accessToken) {
            reject(new Error('SESSION_CHANGED'));
            return;
          }
          if (response.statusCode >= 200 && response.statusCode < 300) {
            if (!response.data || typeof response.data !== 'object') {
              const error = new Error('INVALID_API_RESPONSE');
              error.statusCode = response.statusCode;
              reject(error);
              return;
            }
            resolve(response.data);
            return;
          }

          if (response.statusCode >= 500 && attempt < retryLimit) {
            setTimeout(() => execute(attempt + 1), retryDelay(attempt));
            return;
          }
          if (response.statusCode === 401 && accessToken) clearSession();
          const error = new Error(response.data?.error || `HTTP_${response.statusCode}`);
          error.statusCode = response.statusCode;
          error.response = response.data;
          reject(error);
        },
        fail(error) {
          if (attempt < retryLimit) {
            setTimeout(() => execute(attempt + 1), retryDelay(attempt));
            return;
          }
          const networkError = new Error(error?.errMsg || 'NETWORK_REQUEST_FAILED');
          networkError.code = 'NETWORK_REQUEST_FAILED';
          reject(networkError);
        },
      });
    };

    execute(0);
  });
}

function retryDelay(attempt) {
  return Math.min(1200, 300 * (2 ** attempt));
}

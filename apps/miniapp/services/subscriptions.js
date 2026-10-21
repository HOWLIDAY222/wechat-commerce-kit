import { request } from './http';
import { readAccessToken, readStoredUser } from '../stores/session';
import { readSubscriptionReceipt, readSubscriptionResponse } from '../models/subscriptions';
import { isPrivacyAccepted } from '../stores/privacy-consent';

const pendingPrefix = 'merchantkit.subscriptions.pending.v1.';
const validOwner = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);

export async function fetchSubscriptions() {
  return readSubscriptionResponse(await request({ path: '/api/miniprogram/subscriptions', auth: 'optional' }));
}
export async function saveSubscriptionReceipt(receipt) {
  const data = readSubscriptionReceipt(receipt);
  if (!data) throw Error('SUBSCRIPTION_INPUT_INVALID');
  return readSubscriptionResponse(await request({ path: '/api/miniprogram/subscriptions', method: 'POST', auth: 'required', retries: 0, data }));
}
export async function saveSubscriptionPreferences(enabledChannels, expectedRevision) {
  return readSubscriptionResponse(await request({ path: '/api/miniprogram/subscriptions', method: 'PUT', auth: 'required', retries: 0, data: { enabledChannels, expectedRevision } }));
}
export function subscriptionRequestId() {
  return `subscribe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}_${Math.random().toString(36).slice(2, 10)}`;
}
export function subscriptionAccountId() {
  if (!readAccessToken()) return '';
  const id = readStoredUser()?.id;
  return validOwner(id) ? id : '';
}
export function loadPendingSubscriptionReceipt(ownerId) {
  if (!validOwner(ownerId)) return null;
  try {
    const record = wx.getStorageSync(pendingPrefix + ownerId);
    if (!record) return null;
    const receipt = record.ownerId === ownerId ? readSubscriptionReceipt(record.receipt) : null;
    if (!receipt) { wx.removeStorageSync(pendingPrefix + ownerId); return null; }
    return receipt;
  } catch { return null; }
}
export function persistPendingSubscriptionReceipt(ownerId, value) {
  const receipt = readSubscriptionReceipt(value);
  if (!validOwner(ownerId) || !receipt) return false;
  try { wx.setStorageSync(pendingPrefix + ownerId, { ownerId, receipt }); return true; } catch { return false; }
}
export function clearPendingSubscriptionReceipt(ownerId, requestId) {
  if (!validOwner(ownerId)) return;
  try {
    const record = wx.getStorageSync(pendingPrefix + ownerId);
    if (record?.ownerId === ownerId && record.receipt?.requestId === requestId) wx.removeStorageSync(pendingPrefix + ownerId);
  } catch {}
}
export function requestNativeSubscriptions(templateIds) {
  return new Promise((resolve, reject) => {
    if (!isPrivacyAccepted()) { reject(Error('PRIVACY_CONSENT_REQUIRED')); return; }
    if (!Array.isArray(templateIds) || templateIds.length < 1 || templateIds.length > 3 || new Set(templateIds).size !== templateIds.length || !templateIds.every(id => typeof id === 'string' && /^[A-Za-z0-9_-]{10,160}$/.test(id))) { reject(Error('SUBSCRIPTION_SELECTION_INVALID')); return; }
    if (typeof wx.requestSubscribeMessage !== 'function') { reject(Error('SUBSCRIPTION_WECHAT_UNSUPPORTED')); return; }
    wx.requestSubscribeMessage({ tmplIds: templateIds, success: resolve, fail: reject });
  });
}

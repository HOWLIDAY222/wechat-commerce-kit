import { hasSession, readStoredUser } from '../stores/session';
import { fetchMemberOperations, memberOperation } from '../services/member-operations';
import { isPrivacyAccepted } from '../stores/privacy-consent';
import { rememberPrivacyTarget, deferPrivacyCapture } from './privacy-flow';

const storageKey = 'merchantkit.member.referral.pending.v1';
const codePattern = /^[A-Za-z0-9_-]{6,80}$/;
const phases = ['pending', 'submitting', 'retry', 'bound', 'already_bound', 'ineligible', 'invalid', 'account_changed'];
const terminal = ['bound', 'already_bound', 'ineligible', 'invalid', 'account_changed'];
let cached, stored = true, active = null, identityFailed = false;
const identity = () => { try { const id = hasSession() ? readStoredUser()?.id : ''; identityFailed = false; return typeof id === 'string' && id.length > 0 && id.length <= 100 ? id : ''; } catch { identityFailed = true; return ''; } };
function valid(value) { return value && typeof value === 'object' && typeof value.id === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(value.id)
  && typeof value.code === 'string' && codePattern.test(value.code) && typeof value.ownerId === 'string' && value.ownerId.length <= 100 && phases.includes(value.phase); }
function read() {
  if (cached !== undefined) return cached;
  try { const value = wx.getStorageSync(storageKey); cached = valid(value) ? { id: value.id, code: value.code, ownerId: value.ownerId, phase: value.phase } : null; }
  catch { cached = null; stored = false; }
  return cached;
}
function save(value) {
  cached = value;
  try { wx.setStorageSync(storageKey, value); stored = true; return true; } catch { stored = false; return false; }
}
function update(record, phase) {
  if (read()?.id !== record.id) return false;
  return save({ ...record, phase });
}
function current(record, owner) { return read()?.id === record.id && identity() === owner; }
function status(record = read()) { return { status: record && ['bound', 'already_bound'].includes(record.phase) ? record.phase : !stored ? 'storage_failed' : !record ? 'none' : record.phase }; }

export function pendingReferralStatus() { return status(); }

export function capturePendingReferral(code) {
  if (typeof code !== 'string' || !codePattern.test(code)) return { status: 'invalid' };
  if (!isPrivacyAccepted()) { rememberPrivacyTarget('pages/member-invite/index', { referralCode: code }); deferPrivacyCapture(code, () => capturePendingReferral(code)); return { status: 'privacy_required' }; }
  const previous = read(), ownerId = identity();
  if (identityFailed) return { status: 'storage_failed' };
  if (previous && !previous.ownerId && ownerId && !['invalid', 'account_changed'].includes(previous.phase)) {
    const scoped = { ...previous, ownerId }; save(scoped); return status(scoped);
  }
  // Keep the first invitation until it has been resolved; a second link cannot
  // change attribution while an earlier request may already be in flight.
  if (previous && previous.ownerId === ownerId && previous.phase !== 'account_changed'
    && !(previous.phase === 'invalid' && previous.code !== code)) return status();
  const record = { id: 'referral_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12), code, ownerId, phase: 'pending' };
  save(record); return status(record);
}

export function maybeBindPendingReferral(options = {}) {
  if (!isPrivacyAccepted()) return Promise.resolve({ status: 'privacy_required' });
  const retry = options?.retry === true, allowMemory = options?.allowMemory === true;
  let record = read(); if (!record) return Promise.resolve({ status: stored ? 'none' : 'storage_failed' });
  if (!stored && retry) save(record);
  const owner = identity();
  if (identityFailed) return Promise.resolve({ status: 'storage_failed' });
  if (record.ownerId && record.ownerId !== owner && owner) { update(record, 'account_changed'); return Promise.resolve(status()); }
  if (!owner) return Promise.resolve({ status: stored ? 'waiting_login' : 'storage_failed' });
  if (terminal.includes(record.phase)) return Promise.resolve(status(record));
  if (!record.ownerId) { record = { ...record, ownerId: owner }; save(record); }
  if (!stored && !allowMemory) return Promise.resolve({ status: 'storage_failed' });
  if (active?.id === record.id && active.owner === owner) return active.promise;
  const operation = (async () => {
    try {
      const overview = await fetchMemberOperations();
      if (!current(record, owner)) { if (read()?.id === record.id) update(record, 'account_changed'); return { status: 'account_changed' }; }
      if (overview.referral?.bound === true) { update(record, 'already_bound'); return status(); }
      if (overview.registered !== true) return { status: 'waiting_membership' };
      const tasks = Array.isArray(overview.tasks) ? overview.tasks.filter(task => task?.key === 'INVITE') : [];
      if (tasks.length !== 1 || tasks[0].enabled !== true) return { status: 'disabled' };
      if (['retry', 'submitting'].includes(record.phase) && !retry) return { status: 'retry' };
      if (!update(record, 'submitting') && !allowMemory) return { status: 'storage_failed' };
      const result = await memberOperation('bind_referral', { code: record.code });
      if (!current(record, owner)) { if (read()?.id === record.id) update(record, 'account_changed'); return { status: 'account_changed' }; }
      if (result?.bound !== true) throw Error('INVALID_MEMBER_OPERATION_RESPONSE');
      update(record, 'bound'); return { status: 'bound' };
    } catch (error) {
      if (!current(record, owner)) { if (read()?.id === record.id) update(record, 'account_changed'); return { status: 'account_changed' }; }
      const phase = error?.message === 'MEMBER_OPERATIONS_NEW_MEMBER_REQUIRED' ? 'ineligible'
        : error?.message === 'MEMBER_OPERATIONS_INVALID_REFERRAL' ? 'invalid'
          : error?.message === 'MEMBER_OPERATIONS_REFERRAL_BOUND' ? 'already_bound' : 'retry';
      if (['MEMBERSHIP_REQUIRED', 'MEMBER_PHONE_REQUIRED'].includes(error?.message)) { update(record, 'pending'); return { status: 'waiting_membership' }; }
      if (error?.message === 'MEMBER_OPERATIONS_DISABLED') { update(record, 'pending'); return { status: 'disabled' }; }
      update(record, phase); return status();
    }
  })();
  active = { id: record.id, owner, promise: operation };
  operation.finally(() => { if (active?.promise === operation) active = null; });
  return operation;
}

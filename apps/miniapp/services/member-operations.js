import { request } from './http';
import { config } from '../config/index';

export async function fetchMemberOperations() {
  const value = await request({ path: '/api/miniprogram/member-operations', auth: 'required' });
  if (value?.ok !== true || !Number.isSafeInteger(value.pointsBalance) || value.pointsBalance < 0 || !Array.isArray(value.tasks) || !Array.isArray(value.lotteries) || !Array.isArray(value.surveys) || !Array.isArray(value.posts)) throw new Error('INVALID_MEMBER_OPERATIONS_RESPONSE');
  return { ...value, officialAccount: normalizeContact(value.officialAccount), enterpriseContact: normalizeContact(value.enterpriseContact) };
}

function normalizeContact(contact) {
  if (!contact || typeof contact.qrImageUrl !== 'string' || !contact.qrImageUrl.startsWith('/uploads/')) return contact;
  const source = contact.qrImageUrl;
  if (source.includes('..') || source.includes(String.fromCharCode(92)) || /[\s\u0000-\u001f]/.test(source) || /%(?:2e|2f|5c|25|0[0-9a-f]|1[0-9a-f]|7f)/i.test(source)) return { ...contact, qrImageUrl: '' };
  return { ...contact, qrImageUrl: config.websiteBaseUrl.replace(/\/$/, '') + source };
}

export async function memberOperation(action, payload = {}) {
  const value = await request({ path: '/api/miniprogram/member-operations', method: 'POST', auth: 'required', retries: 0, data: { ...payload, action } });
  if (value?.ok !== true) throw new Error('INVALID_MEMBER_OPERATION_RESPONSE');
  if (action === 'draw' && (!value.draw || typeof value.draw.id !== 'string' || typeof value.draw.prizeTitle !== 'string' || !Number.isSafeInteger(value.draw.costPoints))) throw new Error('INVALID_MEMBER_OPERATION_RESPONSE');
  if (action === 'create_post' && (typeof value.post?.id !== 'string' || !['PENDING', 'APPROVED', 'REJECTED'].includes(value.post.status))) throw new Error('INVALID_MEMBER_OPERATION_RESPONSE');
  if (action === 'create_comment' && (typeof value.comment?.id !== 'string' || !['PENDING', 'APPROVED', 'REJECTED'].includes(value.comment.status))) throw new Error('INVALID_MEMBER_OPERATION_RESPONSE');
  if (action === 'create_referral' && typeof value.code !== 'string') throw new Error('INVALID_MEMBER_OPERATION_RESPONSE');
  if (action === 'create_share' && typeof value.token !== 'string') throw new Error('INVALID_MEMBER_OPERATION_RESPONSE');
  if (action === 'submit_social_submission' && (typeof value.submission?.id !== 'string' || !['PENDING', 'APPROVED', 'REJECTED'].includes(value.submission.status) || value.submission.requestId !== payload.requestId || value.submission.campaignKey !== payload.campaignKey)) throw new Error('INVALID_MEMBER_OPERATION_RESPONSE');
  return value;
}

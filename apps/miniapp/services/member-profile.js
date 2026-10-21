import { request } from './http';
import { memberProfileWrite, readMemberProfileResponse } from '../models/member-profile';

let accountReturnIntent = '';

export function rememberProfileAccountReturn(intent = 'login') {
  accountReturnIntent = intent === 'phone' ? 'phone' : 'login';
}

export function consumeProfileAccountReturn() {
  const intent = accountReturnIntent;
  accountReturnIntent = '';
  return intent;
}

export async function fetchMemberProfile() {
  const response = await request({ path: '/api/account/member-profile', auth: 'required' });
  return readMemberProfileResponse(response);
}

export async function saveMemberProfile(form, expectedRevision, completeRegistration = false) {
  const data = memberProfileWrite(form, expectedRevision, completeRegistration);
  const response = await request({ path: '/api/account/member-profile', method: 'PUT', auth: 'required', retries: 0, data });
  return readMemberProfileResponse(response);
}

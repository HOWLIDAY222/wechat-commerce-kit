import { readAccessToken, readStoredUser } from './session';

let phoneReturn = null;
const accountId = () => readAccessToken() ? String(readStoredUser()?.id || '') : '';

export function rememberSubscriptionPhoneReturn() { phoneReturn = { ownerId: accountId() }; }
export function consumeSubscriptionPhoneReturn() {
  const intent = phoneReturn;
  phoneReturn = null;
  if (!intent || intent.ownerId && intent.ownerId !== accountId()) return null;
  return intent;
}
export function clearSubscriptionPhoneReturn() { phoneReturn = null; }

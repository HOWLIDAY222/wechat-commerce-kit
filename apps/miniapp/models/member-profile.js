import { readMemberAvatar } from './member-avatar';
const FIELD_LIMITS = Object.freeze({ surname: 40, givenName: 40, displayName: 80 });
const GENDERS = [null, 'MALE', 'FEMALE', 'UNSPECIFIED'];

export const memberGenderOptions = ['请选择（选填）', '男', '女', '不愿透露'];

export function beijingToday(now = new Date()) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function validMemberBirthday(value, today = beijingToday()) {
  if (value === null || value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > today) return false;
  const parsed = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function emptyMemberProfile() {
  return { surname: '', givenName: '', displayName: '', gender: null, region: [], birthday: null, registeredAt: null, updatedAt: null, revision: 0 };
}

function cleanText(value, limit) {
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('INVALID_MEMBER_PROFILE');
  return value.trim();
}

export function memberProfileWrite(form, expectedRevision, completeRegistration = false, today = beijingToday()) {
  if (!form || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || typeof completeRegistration !== 'boolean') throw new Error('INVALID_MEMBER_PROFILE');
  const fields = {};
  Object.keys(FIELD_LIMITS).forEach(key => { fields[key] = cleanText(form[key], FIELD_LIMITS[key]); });
  const gender = form.gender === '' ? null : form.gender;
  if (!GENDERS.includes(gender)) throw new Error('INVALID_MEMBER_PROFILE');
  if (!Array.isArray(form.region) || (form.region.length !== 0 && form.region.length !== 3)) throw new Error('INVALID_MEMBER_PROFILE');
  const region = form.region.map(value => cleanText(value, 80));
  if (region.some(value => !value)) throw new Error('INVALID_MEMBER_PROFILE');
  const birthday = form.birthday === '' ? null : form.birthday;
  if (!validMemberBirthday(birthday, today)) throw new Error('INVALID_MEMBER_BIRTHDAY');
  return { ...fields, gender, region, birthday, expectedRevision, completeRegistration };
}

export function readMemberProfileResponse(response) {
  if (!response?.ok || !response.profile || typeof response.canEdit !== 'boolean' || typeof response.canCompleteRegistration !== 'boolean') throw new Error('INVALID_MEMBER_PROFILE_RESPONSE');
  const value = response.profile;
  try {
    memberProfileWrite(value, value.revision, false);
    if (!['registeredAt', 'updatedAt'].every(key => value[key] === null || (typeof value[key] === 'string' && Number.isFinite(Date.parse(value[key]))))) throw new Error('INVALID_MEMBER_PROFILE');
    if (response.accountPhone !== null && (typeof response.accountPhone !== 'string' || !/^1[3-9]\d{9}$/.test(response.accountPhone))) throw new Error('INVALID_MEMBER_PROFILE');
  } catch {
    throw new Error('INVALID_MEMBER_PROFILE_RESPONSE');
  }
  const profile = { ...emptyMemberProfile(), ...value, region: value.region.slice() };
  return { profile, accountPhone: response.accountPhone, canEdit: response.canEdit, canCompleteRegistration: response.canCompleteRegistration,
    ...(response.avatar === undefined ? {} : { avatar: readMemberAvatar(response.avatar) }) };
}

export function memberProfileForm(profile = emptyMemberProfile()) {
  return { surname: profile.surname, givenName: profile.givenName, displayName: profile.displayName, gender: profile.gender, region: profile.region.slice(), birthday: profile.birthday || '' };
}

export function memberGenderIndex(gender) { return Math.max(0, GENDERS.indexOf(gender)); }
export function memberGenderValue(index) { return GENDERS[Number(index)] ?? null; }

export function memberProfileError(error) {
  if (error?.statusCode === 401 || error?.message === 'AUTH_REQUIRED') return '登录已过期，请重新登录后继续。';
  const messages = {
    INVALID_MEMBER_PROFILE: '请检查资料内容：姓名和昵称不可超过输入框的字数限制。',
    INVALID_MEMBER_BIRTHDAY: '请选择正确的出生日期，日期不能晚于今天。',
    MEMBER_PROFILE_PHONE_REQUIRED: '请先授权或验证手机号，再保存会员资料。',
    MEMBER_PROFILE_REVISION_CONFLICT: '资料已在其他页面更新。请先重新加载，再确认你的修改。',
    MEMBER_PROFILE_UNAVAILABLE: '会员资料暂时无法同步，你填写的内容仍保留在当前页面。',
    INVALID_MEMBER_PROFILE_RESPONSE: '会员资料暂时无法读取，请稍后重新加载。',
    ACCOUNT_NOT_FOUND: '账户信息暂时无法读取，请重新登录后重试。',
    SESSION_CHANGED: '账户已发生变化，请重新加载资料后继续。',
  };
  return messages[error?.message] || '会员资料同步失败，请检查网络后重试。';
}

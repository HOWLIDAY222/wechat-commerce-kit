import { request } from './http';
export async function verifyStudentIdentity(code, requestId) {
  const value = await request({ path: '/api/miniprogram/member-operations/student', method: 'POST', auth: 'required', retries: 0, timeout: 24000,
    data: { code, requestId, consentVersion: 'wechat-student-20261019' } });
  if (value?.ok !== true || !['VERIFIED', 'TEST_VERIFIED', 'PENDING', 'UNBOUND', 'NOT_STUDENT'].includes(value.status)
    || !Number.isSafeInteger(value.rewardPoints) || value.rewardPoints < 0 || !Number.isSafeInteger(value.couponsIssued) || value.couponsIssued < 0) throw Error('WECHAT_STUDENT_INVALID_RESPONSE');
  return value;
}
export function studentVerificationError(error) {
  return ({ WECHAT_STUDENT_CODE_INVALID: '授权已过期，请重新验证。', WECHAT_STUDENT_PERMISSION_REQUIRED: '微信认证暂不可用，请稍后重试。',
    WECHAT_STUDENT_RATE_LIMITED: '验证次数较多，请稍后重试。', WECHAT_STUDENT_NETWORK_UNAVAILABLE: '连接微信失败，请重试。',
    WECHAT_STUDENT_TOKEN_EXPIRED: '微信连接已更新，请重试。', WECHAT_STUDENT_LOGIN_REQUIRED: '请重新使用微信登录后验证。',
    MEMBER_STUDENT_VERIFICATION_UNAVAILABLE: '学生认证暂未开放。', MEMBER_STUDENT_TEST_CONFIGURATION_REQUIRED: '学生认证正在准备中，请稍后再来。',
    SESSION_CHANGED: '账户已变化，请重新进入。', AUTH_REQUIRED: '请先登录。', MEMBER_PHONE_REQUIRED: '请先绑定手机号并加入会员。', MEMBERSHIP_REQUIRED: '请先加入会员。',
    MEMBER_REWARD_COUPON_UNAVAILABLE: '学生礼券暂不可用，请稍后重试。', COUPON_SOLD_OUT: '学生礼券暂不可用，请稍后重试。' })[error?.message] || '暂时无法确认认证结果，请重试。';
}

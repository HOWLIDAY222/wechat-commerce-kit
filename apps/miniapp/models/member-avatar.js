export function emptyMemberAvatar() { return { available: false, hasAvatar: false, revision: 0, updatedAt: null }; }
export function readMemberAvatar(value) {
  if (!value || typeof value.available !== 'boolean' || typeof value.hasAvatar !== 'boolean' || !Number.isSafeInteger(value.revision) || value.revision < 0 || value.revision > 2147483646 || !(value.updatedAt === null || (typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)))) || (value.hasAvatar && (!value.available || value.revision === 0))) throw new Error('INVALID_MEMBER_AVATAR_RESPONSE');
  return { available: value.available, hasAvatar: value.hasAvatar, revision: value.revision, updatedAt: value.updatedAt };
}
export function localAvatarPath(value) {
  return typeof value === 'string' && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value) && /^(?:wxfile:\/\/|https?:\/\/(?:tmp|usr)\/|\/|[A-Za-z]:[\\/])/.test(value);
}
export function memberAvatarError(error) {
  const messages = {
    AUTH_REQUIRED: '登录已过期，请重新登录后设置头像。', SESSION_CHANGED: '账户已发生变化，请重新加载后继续。',
    MEMBER_PROFILE_PHONE_REQUIRED: '请先绑定手机号，再设置头像。', MEMBER_AVATAR_REVISION_CONFLICT: '头像已在其他页面更新，请点“刷新头像”后重试。',
    MEMBER_AVATAR_UNAVAILABLE: '头像设置暂时不可用，请稍后重试。', INVALID_MEMBER_AVATAR_RESPONSE: '头像同步暂时失败，请刷新头像后重试。',
    IMAGE_FILE_SIZE_INVALID: '请选择不超过3MB的图片。', IMAGE_SIGNATURE_NOT_SUPPORTED: '请使用JPG、PNG或WebP图片。',
    IMAGE_MIME_SIGNATURE_MISMATCH: '图片格式无法识别，请换一张图片。', IMAGE_DECODE_FAILED: '图片无法读取，请换一张图片。',
    IMAGE_PIXEL_LIMIT_EXCEEDED: '图片尺寸过大，请换一张图片。', INVALID_MEMBER_AVATAR: '未能取得头像图片，请重新选择。',
  };
  return messages[error?.message] || '头像同步失败，请刷新头像后重试。';
}

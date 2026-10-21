export const xiaohongshuBrand = Object.freeze({ enabled: true, name: 'MerchantKit', accountId: 'demo-account', profileUrl: 'https://example.invalid/social', qrImageUrl: '/assets/brand/xiaohongshu-profile.jpg' });
export const socialPlatforms = Object.freeze([
  { key: 'XIAOHONGSHU', label: '小红书', hint: '产品体验、穿搭笔记' },
  { key: 'DOUYIN', label: '抖音', hint: '短视频、图文分享' },
  { key: 'WECHAT_MOMENTS', label: '朋友圈', hint: '提交发布截图核验' },
  { key: 'WECHAT_CHANNELS', label: '视频号', hint: '视频体验与日常' },
  { key: 'OTHER', label: '其他平台', hint: '按活动要求参与' },
]);
const statuses = { PENDING: '待审核', APPROVED: '已通过', REJECTED: '未通过' };
export const socialCampaigns = Object.freeze(['XIAOHONGSHU_FOLLOW', 'SOCIAL_POST', 'SOCIAL_INTERACTION', 'SOCIAL_REPOST']);
export const socialInteractions = Object.freeze([{key:'LIKE',label:'点赞'},{key:'COMMENT',label:'评论'},{key:'FAVORITE',label:'收藏'}]);
const proofPrefix = '/api/miniprogram/member-operations/proofs/';
export function localSocialImage(value) { return typeof value === 'string' && value.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(value) && /^(?:wxfile:\/\/|https?:\/\/(?:tmp|usr)\/|\/|[A-Za-z]:[\\/])/.test(value); }
export function readSocialProof(value) {
  if (!value || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value.id) || value.url !== proofPrefix + value.id) throw new Error('INVALID_SOCIAL_PROOF_RESPONSE');
  return { id: value.id, url: value.url };
}
export function socialPostLink(value) {
  if (typeof value !== 'string' || value.length > 1000) return '';
  const link = value.trim();
  if (!/^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::443)?(?:[/?#][^\s\u0000-\u001f]*)?$/.test(link) || /[\\\s\u0000-\u001f]/.test(link)) return '';
  return link;
}
export function socialSubmissionPayload(form) {
  if (!form || !socialCampaigns.includes(form.campaignKey) || !socialPlatforms.some(item => item.key === form.platform)) throw new Error('INVALID_SOCIAL_SUBMISSION');
  const postUrl = String(form.postUrl || '').trim(), note = String(form.note || '').trim(), proofKeys = Array.isArray(form.proofKeys) ? [...new Set(form.proofKeys)] : [];
  if (note.length < 2 || note.length > 1000 || proofKeys.length > 3 || proofKeys.some(key => typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(key)) || (postUrl && !socialPostLink(postUrl))) throw new Error('INVALID_SOCIAL_SUBMISSION');
  if (!proofKeys.length || form.campaignKey === 'XIAOHONGSHU_FOLLOW' && form.platform !== 'XIAOHONGSHU' || form.platform === 'WECHAT_MOMENTS' && postUrl) throw new Error('SOCIAL_PROOF_REQUIRED');
  if (form.campaignKey === 'SOCIAL_INTERACTION' ? !socialInteractions.some(item=>item.key===form.interactionType) : form.interactionType !== undefined) throw new Error('INVALID_SOCIAL_SUBMISSION');
  return { campaignKey: form.campaignKey, platform: form.platform, postUrl, note, proofKeys, ...(form.campaignKey==='SOCIAL_INTERACTION'?{interactionType:form.interactionType}:{}) };
}
export function socialSubmissionPresentation(value, dateLabel) {
  return (Array.isArray(value) ? value : []).filter(item => item && typeof item.id === 'string' && socialCampaigns.includes(item.campaignKey)).map(item => ({ ...item,
    statusLabel: statuses[item.status] || '待确认', title: item.campaignKey === 'XIAOHONGSHU_FOLLOW' ? '关注品牌小红书' : (socialPlatforms.find(platform => platform.key === item.platform)?.label || '社媒') + (item.campaignKey==='SOCIAL_INTERACTION' ? (socialInteractions.find(choice=>choice.key===item.interactionType)?.label||'互动') : item.campaignKey==='SOCIAL_REPOST'?'转发':'发帖'),
    dateLabel: dateLabel(item.createdAt), proofs: (item.proofs || []).flatMap(proof => { try { return [readSocialProof(proof)]; } catch { return []; } }),
    rewardLabel: item.status === 'APPROVED' && Number.isSafeInteger(item.rewardPoints) && item.rewardPoints > 0 ? '+' + item.rewardPoints + '积分' : '',
  }));
}
export function socialFingerprint(payload) { const text = JSON.stringify(payload); let hash = 2166136261; for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); } return text.length + ':' + (hash >>> 0).toString(16); }
export function memberSocialError(error) {
  return ({ SOCIAL_PROOF_REQUIRED: '请添加核验截图。关注品牌小红书和朋友圈分享必须提供截图。', INVALID_SOCIAL_SUBMISSION: '请检查发布链接、说明和截图后再提交。',
    SOCIAL_PROOF_UPLOAD_FAILED: '截图上传未完成，图片仍保留在当前页面，可重试提交。', SOCIAL_PROOF_DOWNLOAD_FAILED: '核验截图暂时无法显示，请稍后重试。', INVALID_SOCIAL_PROOF_RESPONSE: '截图返回内容无法确认，请重新加载后核对。',
    INVALID_SOCIAL_IMAGE: '未能读取图片，请重新选择。', IMAGE_FILE_SIZE_INVALID: '请选择不超过3MB的截图。', IMAGE_SIGNATURE_NOT_SUPPORTED: '请使用JPG、PNG或WebP图片。',
    MEMBER_SOCIAL_DISABLED: '这项社媒活动尚未开放，当前可查看规则，暂不能提交核验。', MEMBER_OPERATIONS_DISABLED: '活动尚未开放，暂不能提交核验。',
    MEMBER_SOCIAL_PROOF_INVALID: '截图无法用于本次提交，请重新选择。', MEMBER_SOCIAL_PROOF_REQUIRED: '请补充发布截图，再提交核验。',
    MEMBER_SOCIAL_REVISION_CONFLICT: '审核记录已经更新，请刷新记录后再提交。',
    MEMBER_OPERATIONS_DUPLICATE_CONTENT: '这份材料已用于其他申请，请在审核记录中修改原申请，或提供新的发布材料。',
  })[error?.message] || '';
}

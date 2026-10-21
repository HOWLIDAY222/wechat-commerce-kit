import { xiaohongshuBrand, socialSubmissionPresentation } from './member-social';
const statuses = { AVAILABLE: '去完成', DISABLED: '查看说明', PENDING: '审核中', COMPLETED: '已完成', LIMIT_REACHED: '已达上限' };
const applicationLabels = { PENDING: '待审核', APPROVED: '已通过', REJECTED: '未通过', EXPIRED:'已过期' };
const legacyKeys = ['OFFICIAL_ACCOUNT', 'COMMUNITY_INTERACTION', 'COMMUNITY_SHARE', 'FIRST_POST', 'POST'];
const communityKeys = ['SOCIAL_FIRST_POST', 'SOCIAL_POST', 'SOCIAL_INTERACTION', 'SOCIAL_REPOST'];
const routes = {
  PROFILE: '/pages/member-profile/index', PREFERENCES: '/pages/member-surveys/index?id=PREFERENCES',
  ENTERPRISE: '/pages/member-earn/index?contact=ENTERPRISE', XIAOHONGSHU_FOLLOW: '/pages/member-community/index?tab=follow',
  INVITE: '/pages/member-invite/index', STUDENT: '/pages/member-student/index',
  STYLE_SURVEY: '/pages/member-surveys/index?id=STYLE_SURVEY', UNDERWEAR_SURVEY: '/pages/member-surveys/index?id=UNDERWEAR_SURVEY',
  SOCIAL_FIRST_POST: '/pages/member-community/index?tab=share', SOCIAL_POST: '/pages/member-community/index?tab=share',
  SOCIAL_INTERACTION: '/pages/member-community/index?tab=interaction', SOCIAL_REPOST: '/pages/member-community/index?tab=repost',
};

export function operationsPresentation(value) {
  if (!value) return {};
  const tasks = (value.tasks || []).filter(task => !legacyKeys.includes(task.key)).map(task => task.key === 'STUDENT'
    ? { ...task, route: routes.STUDENT, description: '通过微信认证，领取学生权益', rewardLabel: task.enabled && value.student?.verification?.available ? '+100' : '', stateLabel: value.student?.valid ? '查看权益' : task.enabled && value.student?.verification?.available ? '去认证' : '暂未开放', actionDisabled: !task.enabled || !value.student?.verification?.available, isCommunity: false, icon: 'catalog' }
    : ({ ...task, route: routes[task.key] || '',
    rewardLabel: task.enabled && Number.isSafeInteger(task.rewardPoints) && task.rewardPoints > 0 ? `+${task.rewardPoints}` : '',
    stateLabel: statuses[task.state] || '查看说明', isCommunity: communityKeys.includes(task.key),
    icon: communityKeys.includes(task.key) ? 'heart' : task.key === 'INVITE' ? 'account' : task.key === 'PROFILE' ? 'account' : 'catalog',
  }));
  const applications = (value.myApplications || []).map(item => ({ ...item, statusLabel: applicationLabels[item.status] || '状态待确认', dateLabel: dateLabel(item.createdAt) }));
  const comments = (value.comments || []).map(item => ({ ...item, dateLabel: dateLabel(item.createdAt), authorName: item.authorName || '品牌会员' }));
  const myComments = (value.myComments || []).map(item => ({ ...item, statusLabel: applicationLabels[item.status] || '待人工审核', dateLabel: dateLabel(item.createdAt) }));
  const posts = (value.posts || []).map(item => { const replies = comments.filter(comment => comment.postId === item.id); return { ...item, dateLabel: dateLabel(item.createdAt), authorName: item.authorName || '品牌会员', comments: replies, commentCount: replies.length, commentsEmpty: replies.length === 0 }; });
  const myPosts = (value.myPosts || []).map(item => ({ ...item, statusLabel: applicationLabels[item.status] || '待人工审核', dateLabel: dateLabel(item.createdAt) }));
  const profile = tasks.find(task => task.key === 'PROFILE');
  const xiaohongshuAccount = { ...xiaohongshuBrand, ...(value.xiaohongshuAccount || {}) };
  const mySocialSubmissions = socialSubmissionPresentation(value.mySocialSubmissions, dateLabel);
  const studentAvailable = value.student?.verification?.available === true && tasks.some(task => task.key === 'STUDENT' && task.enabled);
  const student = { ...value.student, valid: studentAvailable && value.student?.valid === true,
    benefitsEnabled: studentAvailable && value.student?.benefitsEnabled === true && Array.isArray(value.student?.coupons) && value.student.coupons.length === 2,
    coupons: studentAvailable && Array.isArray(value.student?.coupons) ? value.student.coupons : [],
    verification: value.student?.verification || { provider: 'WECHAT', status: 'PENDING', available: false } };
  return { ...value, student, tasks, basicTasks: tasks.filter(task => !task.isCommunity), communityTasks: tasks.filter(task => task.isCommunity),
    myApplications: applications, posts, myPosts, comments, myComments, myCommentsEmpty: myComments.length === 0, profileClaimable: !!(profile?.enabled && profile.state === 'AVAILABLE'),
    basicTasksEmpty: tasks.every(task => task.isCommunity), communityTasksEmpty: tasks.every(task => !task.isCommunity),
    lotteriesEmpty: (value.lotteries || []).length === 0, surveysEmpty: (value.surveys || []).length === 0, postsEmpty: posts.length === 0, myPostsEmpty: myPosts.length === 0,
    enterpriseVisible: !!(value.enterpriseContact?.enabled && safeQrImage(value.enterpriseContact.qrImageUrl)),
    officialVisible: false, xiaohongshuAccount, xiaohongshuVisible: !!xiaohongshuAccount.enabled,
    mySocialSubmissions, mySocialSubmissionsEmpty: !mySocialSubmissions.length,
    lotteries: (value.lotteries || []).map(item => ({ ...item, uniformPoints:item.distribution==='UNIFORM_POINTS'&&Number.isSafeInteger(item.minimumPoints)&&Number.isSafeInteger(item.maximumPoints)&&item.minimumPoints>=1&&item.maximumPoints<=100&&item.minimumPoints<=item.maximumPoints,
      uniformRangeLabel:item.minimumPoints+'—'+item.maximumPoints+' 积分', uniformProbabilityLabel:(Math.round(10000/(item.maximumPoints-item.minimumPoints+1))/100)+'%',
      prizes: (item.prizes || []).map(prize => ({ ...prize, probabilityLabel: typeof prize.probability === 'number' && prize.probability >= 0 && prize.probability <= 1 ? (Math.round(prize.probability * 10000) / 100) + '%' : '', stockLabel: Number.isSafeInteger(prize.remainingStock) ? String(prize.remainingStock) : '' })), canDraw: !!(value.registered && item.enabled && item.remainingDraws > 0 && value.pointsBalance >= item.costPoints),
      statusLabel: !item.enabled ? '活动暂未开放' : item.remainingDraws <= 0 ? '参与次数已用完' : value.pointsBalance < item.costPoints ? '积分不足' : '使用积分参与' })),
    surveys: (value.surveys || []).map(item => ({ ...item, statusLabel: item.completed ? '已完成' : item.enabled ? '填写问卷' : '暂未开放', rewardLabel: item.enabled && item.rewardPoints > 0 ? `完成后可得 ${item.rewardPoints} 积分` : '' })),
  };
}

export function dateLabel(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '';
  return new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ');
}
export function safeQrImage(value) { return typeof value === 'string' && /^https:\/\//.test(value) && value.length <= 2048; }
export function memberOperationsError(error) {
  const code = typeof error === 'string' ? error : error?.message;
  return ({ AUTH_REQUIRED: '请先登录，再查看会员任务。', SESSION_CHANGED: '账户已变化，请重新进入。',
    MEMBER_OPERATIONS_DISABLED: '这项活动暂未开放，请留意后续安排。', MEMBER_STUDENT_VERIFICATION_UNAVAILABLE: '微信学生身份认证暂未开放。', MEMBERSHIP_REQUIRED: '请先加入品牌会员。', MEMBER_PHONE_REQUIRED: '请先到个人中心绑定手机号。',
    POINTS_INSUFFICIENT: '当前积分不足，请刷新余额。', MEMBER_OPERATIONS_REVISION_CONFLICT: '审核记录已更新，请刷新后再提交。',
    INVALID_MEMBER_OPERATION: '请检查填写内容后重试。', MEMBER_OPERATIONS_UNAVAILABLE: '会员服务暂时无法使用，请稍后重试。',
    MEMBER_OPERATIONS_ALREADY_COMPLETED: '这项任务已完成，请刷新查看。', MEMBER_OPERATIONS_SELF_REFERRAL: '不能使用自己的邀请码。',
    MEMBER_OPERATIONS_REFERRAL_ALREADY_BOUND: '当前账户已经绑定过邀请关系。', MEMBER_OPERATIONS_LIMIT_REACHED: '已达到本项活动的参与上限。',
    MEMBER_CUSTOMER_REQUIRED: '当前账户暂不能办理顾客会员权益，请联系品牌客服。',
    MEMBER_OPERATIONS_PROFILE_INCOMPLETE: '请先完善会员资料，再核验资料奖励。',
    MEMBER_OPERATIONS_REQUEST_CHANGED: '上次请求的内容已变化，请先核对原记录，勿创建新的扣分请求。',
    MEMBER_OPERATIONS_INVALID_REFERRAL: '邀请码无效，或不能使用自己的邀请码。',
    MEMBER_OPERATIONS_REFERRAL_BOUND: '当前账户已经绑定过其他邀请关系。',
    MEMBER_OPERATIONS_NEW_MEMBER_REQUIRED: '邀请码仅适用于注册 24 小时内且没有历史交易的新账户。',
    MEMBER_OPERATIONS_COUPON_UNAVAILABLE: '此奖项对应的优惠券暂时无法发放，请联系客服核对。',
    MEMBER_OPERATIONS_NOT_FOUND: '这项活动或内容已不存在，请刷新列表。',
  })[code] || '暂时无法确认操作结果，请刷新记录后核对；涉及积分的重试会沿用原请求。';
}

export function createMemberRequestId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.floor(Math.random() * 16); return (c === 'x' ? r : (r & 3) | 8).toString(16); });
}

export function surveyQuestions(survey, answers = {}) {
  return (survey?.questions || []).map((question, index) => ({ ...question, ordinal: index + 1,
    answerText: typeof answers[question.id] === 'string' ? answers[question.id] : '',
    choices: (question.options || []).map(option => ({ value: option, selected: Array.isArray(answers[question.id]) ? answers[question.id].includes(option) : answers[question.id] === option })),
  }));
}

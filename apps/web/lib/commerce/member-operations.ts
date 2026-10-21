import { z } from "zod";
import { beijingCalendarDate } from "@/lib/commerce/order-dispatch-estimate";
import { defaultSocialConfig, defaultXiaohongshuAccount, socialConfigSchema, socialSubmissionSchema, socialTaskKeys, xiaohongshuAccountSchema } from "@/lib/commerce/member-social";
import { defaultMemberSurveys } from "@/lib/commerce/member-surveys";

export const taskKeys = ["PROFILE", "PREFERENCES", "ENTERPRISE", "OFFICIAL_ACCOUNT", "INVITE", "STUDENT", "STYLE_SURVEY", "UNDERWEAR_SURVEY", "COMMUNITY_INTERACTION", "COMMUNITY_SHARE", "FIRST_POST", "POST", "XIAOHONGSHU_FOLLOW", "SOCIAL_FIRST_POST", "SOCIAL_POST", "SOCIAL_INTERACTION", "SOCIAL_REPOST"] as const;
export type MemberTaskKey = typeof taskKeys[number];
export const taskDefinitions: Record<MemberTaskKey, { title: string; description: string; rewardPoints: number; limit: number | null; period: "LIFETIME" | "DAY" | "MONTH"; route: string }> = {
  PROFILE: { title: "完善会员资料", description: "填写姓名、性别和出生日期后领取。", rewardPoints: 100, limit: 1, period: "LIFETIME", route: "/pages/member-profile/index" },
  PREFERENCES: { title: "填写穿着偏好", description: "完成穿着偏好问卷。", rewardPoints: 100, limit: 1, period: "LIFETIME", route: "/pages/member-surveys/index?id=PREFERENCES" },
  ENTERPRISE: { title: "添加品牌顾问", description: "添加后提交核验申请，由工作人员确认。", rewardPoints: 50, limit: 1, period: "LIFETIME", route: "/pages/member-earn/index?contact=ENTERPRISE" },
  OFFICIAL_ACCOUNT: { title: "关注品牌公众号", description: "关注后提交核验申请，由工作人员确认。", rewardPoints: 50, limit: 1, period: "LIFETIME", route: "/pages/member-earn/index?contact=OFFICIAL_ACCOUNT" },
  INVITE: { title: "邀请新会员", description: "新会员注册及有效消费权益由系统核验后自动发放。", rewardPoints: 100, limit: null, period: "LIFETIME", route: "/pages/member-invite/index" },
  STUDENT: { title: "学生身份认证", description: "由微信核验学生身份，首次认证获得100积分，学生权益每180天重新认证。", rewardPoints: 100, limit: 1, period: "LIFETIME", route: "/pages/member-student/index" },
  STYLE_SURVEY: { title: "参与风格问卷", description: "完成品牌风格问卷。", rewardPoints: 50, limit: 1, period: "LIFETIME", route: "/pages/member-surveys/index?id=STYLE_SURVEY" },
  UNDERWEAR_SURVEY: { title: "参与内裤体验问卷", description: "分享你的内裤穿着体验。", rewardPoints: 300, limit: 1, period: "LIFETIME", route: "/pages/member-surveys/index?id=UNDERWEAR_SURVEY" },
  COMMUNITY_INTERACTION: { title: "社区互动", description: "点赞、收藏或评论其他会员的内容，评论通过审核后计入。", rewardPoints: 5, limit: 5, period: "DAY", route: "/pages/member-community/index" },
  COMMUNITY_SHARE: { title: "分享社区内容", description: "其他会员实际访问分享内容后计入，分享按钮不直接发分。", rewardPoints: 5, limit: 5, period: "DAY", route: "/pages/member-community/index" },
  FIRST_POST: { title: "发布首篇社区内容", description: "首篇内容通过审核后获得。", rewardPoints: 100, limit: 1, period: "LIFETIME", route: "/pages/member-community/index" },
  POST: { title: "发布社区内容", description: "后续内容通过审核后获得。", rewardPoints: 20, limit: 5, period: "MONTH", route: "/pages/member-community/index" },
  XIAOHONGSHU_FOLLOW: { title: "关注品牌小红书", description: "关注后提交截图，由工作人员核验。", rewardPoints: 50, limit: 1, period: "LIFETIME", route: "/pages/member-community/index?tab=follow" },
  SOCIAL_FIRST_POST: { title: "首次社媒分享", description: "首次品牌体验分享，经审核通过后领取。", rewardPoints: 5, limit: 1, period: "LIFETIME", route: "/pages/member-community/index" },
  SOCIAL_POST: { title: "持续社媒分享", description: "后续真实品牌体验分享，每篇核验通过后领取。", rewardPoints: 20, limit: null, period: "LIFETIME", route: "/pages/member-community/index" },
  SOCIAL_INTERACTION: { title: "社媒互动", description: "完成品牌相关点赞、评论或收藏，截图审核通过后领取；同一内容同一行为限一次。", rewardPoints: 5, limit: null, period: "LIFETIME", route: "/pages/member-community/index?tab=interaction" },
  SOCIAL_REPOST: { title: "社媒转发", description: "完成品牌相关转发，截图审核通过后领取；同一内容限一次。", rewardPoints: 5, limit: null, period: "LIFETIME", route: "/pages/member-community/index?tab=repost" },
};
const text = (min: number, max: number) => z.string().trim().min(min).max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value));
const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const requestId = z.string().regex(/^[A-Za-z0-9_-]{8,80}$/);
const imageUrl = z.string().max(500).refine(value => !value || value.startsWith("/uploads/") && !value.includes("..") || /^https:\/\/[^\s@]+$/i.test(value));
const contactSchema = z.object({ enabled: z.boolean(), name: text(0, 80), qrImageUrl: imageUrl }).strict();
export const surveyQuestionSchema = z.object({ id, title: text(1, 160), type: z.enum(["SINGLE", "MULTIPLE", "TEXT"]), required: z.boolean(), options: z.array(text(1, 120)).max(30) }).strict().refine(question => question.type === "TEXT" ? question.options.length === 0 : question.options.length >= 2 && new Set(question.options).size === question.options.length);
const surveySchema = z.object({ id: z.enum(["PREFERENCES", "STYLE_SURVEY", "UNDERWEAR_SURVEY"]), title: text(1, 80), enabled: z.boolean(), questions: z.array(surveyQuestionSchema).min(1).max(20) }).strict().refine(survey => new Set(survey.questions.map(question => question.id)).size === survey.questions.length);
const prizeSchema = z.object({ id, title: text(1, 80), kind: z.enum(["POINTS", "COUPON", "NONE"]), points: z.number().int().min(0).max(100), couponTemplateId: z.string().max(120).nullable(), weight: z.number().int().min(1).max(10_000), stock: z.number().int().min(0).max(1_000_000).nullable() }).strict().refine(prize => prize.kind === "POINTS" ? prize.points > 0 && prize.couponTemplateId === null : prize.kind === "COUPON" ? prize.points === 0 && !!prize.couponTemplateId && prize.stock !== null : prize.points === 0 && prize.couponTemplateId === null);
export const lotterySchema = z.object({ id, title: text(1, 80), enabled: z.boolean(), costPoints: z.number().int().min(1).max(100_000), maxDraws: z.number().int().min(1).max(100), distribution: z.enum(["WEIGHTED", "UNIFORM_POINTS"]).default("WEIGHTED"), minimumPoints: z.number().int().min(1).max(100).default(1), maximumPoints: z.number().int().min(1).max(100).default(100), prizes: z.array(prizeSchema).min(1).max(12) }).strict().refine(lottery => lottery.minimumPoints <= lottery.maximumPoints && new Set(lottery.prizes.map(prize => prize.id)).size === lottery.prizes.length && (lottery.distribution === "UNIFORM_POINTS" || lottery.prizes.every(prize => prize.stock === null) || lottery.prizes.some(prize => prize.kind === "NONE" && prize.stock === null)));
export const defaultStudentBenefits = () => ({ enabled: false, couponTemplateIds: [] as string[], firstSocialPoints: 1500 });
const studentBenefitsSchema = z.object({ enabled: z.boolean(), couponTemplateIds: z.array(z.union([id, z.literal("")])).max(2).refine(ids => new Set(ids.filter(Boolean)).size === ids.filter(Boolean).length), firstSocialPoints: z.number().int().min(1).max(100_000) }).strict().refine(value => !value.enabled || value.couponTemplateIds.length === 2 && value.couponTemplateIds.every(Boolean));

const completeMemberOperationsConfigSchema = z.object({
  tasks: z.record(z.enum(taskKeys), z.object({ enabled: z.boolean(), rewardPoints: z.number().int().min(1).max(100_000) }).strict()),
  officialAccount: contactSchema, enterpriseContact: contactSchema,
  xiaohongshuAccount: xiaohongshuAccountSchema, social: socialConfigSchema,
  surveys: z.array(surveySchema).length(3).refine(surveys => new Set(surveys.map(survey => survey.id)).size === 3),
  lotteries: z.array(lotterySchema).max(3).refine(lotteries => new Set(lotteries.map(lottery => lottery.id)).size === lotteries.length),
  community: z.object({ enabled: z.boolean() }).strict(), studentBenefits: studentBenefitsSchema,
}).strict();
// Fill only newly introduced fields. Existing switches, rewards and merchant
// settings survive; unsupported fields still fail the strict schema.
export const memberOperationsConfigSchema = z.preprocess(value => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const source = value as Record<string, unknown>, tasks = source.tasks;
  if (!tasks || typeof tasks !== "object" || Array.isArray(tasks)) return value;
  return { ...source, tasks: { ...Object.fromEntries(socialTaskKeys.map(key => [key, { enabled: false, rewardPoints: key === "XIAOHONGSHU_FOLLOW" ? 50 : key === "SOCIAL_POST" ? 20 : 5 }])), ...tasks },
    xiaohongshuAccount: Object.hasOwn(source, "xiaohongshuAccount") ? source.xiaohongshuAccount : defaultXiaohongshuAccount(), social: Object.hasOwn(source, "social") ? source.social : defaultSocialConfig(), studentBenefits: Object.hasOwn(source, "studentBenefits") ? source.studentBenefits : defaultStudentBenefits() };
}, completeMemberOperationsConfigSchema);
export type MemberOperationsConfig = z.infer<typeof completeMemberOperationsConfigSchema>;
export function defaultMemberOperationsConfig(): MemberOperationsConfig {
  const tasks = Object.fromEntries(taskKeys.map(key => [key, { enabled: false, rewardPoints: taskDefinitions[key].rewardPoints }])) as MemberOperationsConfig["tasks"];
  return { tasks, officialAccount: { enabled: false, name: "MerchantKit", qrImageUrl: "" }, enterpriseContact: { enabled: false, name: "品牌顾问", qrImageUrl: "" }, community: { enabled: false }, xiaohongshuAccount: defaultXiaohongshuAccount(), social: defaultSocialConfig(),
    studentBenefits: defaultStudentBenefits(), surveys: defaultMemberSurveys(), lotteries: [{ id: "member-points", title: "会员积分抽奖", enabled: false, costPoints: 20, maxDraws: 3, distribution: "UNIFORM_POINTS", minimumPoints: 1, maximumPoints: 100, prizes: [{ id: "points-20", title: "20积分", kind: "POINTS", points: 20, couponTemplateId: null, weight: 10, stock: 100 }, { id: "none", title: "谢谢参与", kind: "NONE", points: 0, couponTemplateId: null, weight: 90, stock: null }] }] };
}

export const memberOperationInputSchema = z.discriminatedUnion("action", [
  socialSubmissionSchema,
  z.object({ action: z.literal("claim_task"), taskKey: z.literal("PROFILE") }).strict(),
  z.object({ action: z.literal("submit_application"), taskKey: z.enum(["ENTERPRISE", "OFFICIAL_ACCOUNT", "STUDENT"]), detail: z.object({ school: text(2, 120).optional(), graduationYear: z.number().int().min(1900).max(2200).optional(), note: text(0, 1000), proofKeys: z.array(z.string().regex(/^msu_[a-f0-9]{32}$/)).min(1).max(3).optional() }).strict(), expectedRevision: z.number().int().min(0).max(2_000_000_000).optional() }).strict(),
  z.object({ action: z.literal("submit_survey"), surveyId: z.enum(["PREFERENCES", "STYLE_SURVEY", "UNDERWEAR_SURVEY"]), answers: z.record(id, z.union([text(0, 1000), z.array(text(1, 120)).max(30)])) }).strict(),
  z.object({ action: z.literal("create_referral") }).strict(),
  z.object({ action: z.literal("bind_referral"), code: id }).strict(),
  z.object({ action: z.literal("draw"), lotteryId: id, requestId }).strict(),
  z.object({ action: z.literal("create_post"), text: text(20, 1000), requestId }).strict(),
  z.object({ action: z.literal("create_comment"), postId: id, text: text(2, 500), requestId }).strict(),
  z.object({ action: z.literal("react_post"), postId: id, reaction: z.enum(["LIKE", "FAVORITE"]), active: z.boolean() }).strict(),
  z.object({ action: z.literal("report_post"), postId: id, reason: text(2, 300) }).strict(),
  z.object({ action: z.literal("create_share"), postId: id }).strict(),
  z.object({ action: z.literal("visit_share"), token: id }).strict(),
]);
export type MemberOperationInput = z.infer<typeof memberOperationInputSchema>;
export const memberOperationsAdminInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("review_application"), id, decision: z.enum(["APPROVED", "REJECTED"]), note: text(2, 1000), verifiedContentKey: text(2, 160).optional(), expectedRevision: z.number().int().min(1).max(2_000_000_000) }).strict(),
  z.object({ action: z.literal("review_post"), id, decision: z.enum(["APPROVED", "REJECTED"]), note: text(2, 1000), expectedRevision: z.number().int().min(1).max(2_000_000_000) }).strict(),
  z.object({ action: z.literal("review_comment"), id, decision: z.enum(["APPROVED", "REJECTED"]), note: text(2, 1000), expectedRevision: z.number().int().min(1).max(2_000_000_000) }).strict(),
  z.object({ action: z.literal("review_referral"), id, decision: z.enum(["APPROVED", "REJECTED"]), note: text(2, 1000), expectedRevision: z.number().int().min(1).max(2_000_000_000) }).strict(),
  z.object({ action: z.literal("moderate_post"), id, note: text(2, 1000), expectedRevision: z.number().int().min(1).max(2_000_000_000) }).strict(),
  z.object({ action: z.literal("moderate_comment"), id, note: text(2, 1000), expectedRevision: z.number().int().min(1).max(2_000_000_000) }).strict(),
  z.object({ action: z.literal("review_report"), id, decision: z.enum(["APPROVED", "REJECTED"]), note: text(2, 1000), expectedRevision: z.number().int().min(1).max(2_000_000_000) }).strict(),
]);
export type MemberOperationsAdminInput = z.infer<typeof memberOperationsAdminInputSchema>;
export function taskPeriod(key: MemberTaskKey, now = new Date()) { const day = beijingCalendarDate(now); return taskDefinitions[key].period === "LIFETIME" ? "LIFETIME" : taskDefinitions[key].period === "MONTH" ? day.slice(0, 7) : day; }
export function taskLimitLabel(key: MemberTaskKey) { const definition = taskDefinitions[key]; if (key === "INVITE") return "具体额度以邀请权益规则为准"; return definition.limit === null ? "同一凭据不重复奖励，次数不限" : definition.period === "LIFETIME" ? "每位会员限一次" : `${definition.period === "DAY" ? "每日" : "每月"}最多${definition.limit}次`; }
export function validSurveyAnswers(survey: MemberOperationsConfig["surveys"][number], answers: Record<string, string | string[]>) {
  if (Object.keys(answers).some(key => !survey.questions.some(question => question.id === key))) return false;
  return survey.questions.every(question => {
    const answer = answers[question.id];
    if (answer === undefined || answer === "" || Array.isArray(answer) && answer.length === 0) return !question.required;
    if (question.type === "TEXT") return typeof answer === "string" && answer.length <= 1000;
    if (question.type === "SINGLE") return typeof answer === "string" && question.options.includes(answer);
    return Array.isArray(answer) && new Set(answer).size === answer.length && answer.every(value => question.options.includes(value));
  });
}

import { memberReviewPageSize, normalizeMemberReviewQuery, type MemberReviewQuery } from "@/lib/commerce/member-review-queue";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@prisma/client";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { isMainlandPhone, normalizeMainlandPhone } from "@/lib/providers/sms";
import { changeMemberPoints, getPointsRule } from "@/lib/services/member-points-service";
import { defaultMemberOperationsConfig, memberOperationsConfigSchema, memberOperationInputSchema, memberOperationsAdminInputSchema, taskDefinitions, taskKeys, taskLimitLabel, taskPeriod, validSurveyAnswers,
  type MemberOperationsConfig, type MemberOperationInput, type MemberOperationsAdminInput, type MemberTaskKey } from "@/lib/commerce/member-operations";
import { upgradeLegacyMemberSurveys } from "@/lib/commerce/member-surveys";
import { canonicalSocialUrl, needsManualContentReference, selectSocialReward, socialPlatforms, socialProofUrl } from "@/lib/commerce/member-social";
import { bindSocialProofs } from "@/lib/services/member-social-proof-service";
import { studentCertification, studentValidityDays, studentVerification, studentVerificationUnavailable, studentVerificationInputSchema, studentTestIdentitiesKey } from "@/lib/commerce/member-student";
import { quickCheckWeChatStudent } from "@/lib/providers/wechat-student";
import { issueEventMemberCoupon } from "@/lib/services/membership-service";
import { getReferralRewardOverview, readMemberRewardPolicy } from "@/lib/services/member-automation-rewards-service";

type Tx = Prisma.TransactionClient;
type Reader = Pick<Tx, "$queryRaw">;
type Payload = Record<string, unknown>;
type OpsRecord = { id: string; kind: string; userId: string; subjectId: string; state: string; payload: Payload; points: number; revision: number; createdAt: Date; updatedAt: Date };
type Setting = { revision: number; config: MemberOperationsConfig; updatedAt: Date | null };
const field = (payload: Payload, name: string) => typeof payload[name] === "string" ? payload[name] as string : "";
const recordId = (kind: string, userId: string, subject: string) => "mo_" + createHash("sha256").update(JSON.stringify([kind, userId, subject])).digest("hex");
const disabled = () => Error("MEMBER_OPERATIONS_DISABLED");
async function ready() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") throw Error("MEMBER_OPERATIONS_UNAVAILABLE");
  const rows = await prisma.$queryRaw<Array<{ settings: string | null; records: string | null }>>`SELECT to_regclass('public.member_operation_settings')::text AS settings, to_regclass('public.member_operation_records')::text AS records`;
  if (!rows[0]?.settings || !rows[0]?.records) throw Error("MEMBER_OPERATIONS_UNAVAILABLE");
}
async function setting(reader: Reader = prisma): Promise<Setting> {
  const rows = await reader.$queryRaw<Array<{ revision: number; config: unknown; updatedAt: Date }>>`SELECT revision, config, updated_at AT TIME ZONE 'UTC' AS "updatedAt" FROM member_operation_settings WHERE id = 'member-operations'`;
  if (!rows[0]) return { revision: 0, config: defaultMemberOperationsConfig(), updatedAt: null };
  const parsed = memberOperationsConfigSchema.safeParse(rows[0].config);
  if (!parsed.success) throw Error("MEMBER_OPERATIONS_UNAVAILABLE");
  return { revision: rows[0].revision, config: upgradeLegacyMemberSurveys(parsed.data), updatedAt: rows[0].updatedAt };
}
async function userForOperation(tx: Tx, userId: string) {
  const user = await tx.user.findFirst({ where: { id: userId, status: "ACTIVE", role: "CUSTOMER" }, select: { id: true, phone: true, createdAt: true } });
  if (!user) throw Error("MEMBER_CUSTOMER_REQUIRED");
  if (!user.phone || !isMainlandPhone(normalizeMainlandPhone(user.phone))) throw Error("MEMBER_PHONE_REQUIRED");
  const membership = await tx.memberProfile.findUnique({ where: { userId }, select: { id: true, joinedAt: true } });
  if (!membership) throw Error("MEMBERSHIP_REQUIRED");
  return { ...user, joinedAt: membership.joinedAt };
}
async function admin(tx: Tx, actorId: string) {
  if (!await tx.user.findFirst({ where: { id: actorId, status: "ACTIVE", role: { in: ["OWNER", "ADMIN"] } }, select: { id: true } })) throw Error("ADMIN_REQUIRED");
}
async function lockUser(tx: Tx, userId: string) { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"member-operations:" + userId}))`; }
async function readRecord(id: string, reader: Reader = prisma) {
  const rows = await reader.$queryRaw<OpsRecord[]>`SELECT id, kind, user_id AS "userId", subject_id AS "subjectId", state, payload, points, revision, created_at AT TIME ZONE 'UTC' AS "createdAt", updated_at AT TIME ZONE 'UTC' AS "updatedAt" FROM member_operation_records WHERE id = ${id}`;
  return rows[0] ?? null;
}
async function bySubject(kind: string, userId: string, subject: string, reader: Reader = prisma) {
  const rows = await reader.$queryRaw<OpsRecord[]>`SELECT id, kind, user_id AS "userId", subject_id AS "subjectId", state, payload, points, revision, created_at AT TIME ZONE 'UTC' AS "createdAt", updated_at AT TIME ZONE 'UTC' AS "updatedAt" FROM member_operation_records WHERE kind = ${kind} AND user_id = ${userId} AND subject_id = ${subject}`;
  return rows[0] ?? null;
}
async function insertRecord(tx: Tx, input: { id?: string; kind: string; userId: string; subject: string; state: string; payload: Payload; points?: number }) {
  const id = input.id ?? recordId(input.kind, input.userId, input.subject);
  const rows = await tx.$queryRaw<OpsRecord[]>`INSERT INTO member_operation_records (id, kind, user_id, subject_id, state, payload, points)
    VALUES (${id}, ${input.kind}, ${input.userId}, ${input.subject}, ${input.state}, ${JSON.stringify(input.payload)}::jsonb, ${input.points ?? 0})
    ON CONFLICT DO NOTHING RETURNING id, kind, user_id AS "userId", subject_id AS "subjectId", state, payload, points, revision, created_at AT TIME ZONE 'UTC' AS "createdAt", updated_at AT TIME ZONE 'UTC' AS "updatedAt"`;
  return rows[0] ?? null;
}
async function updateRecord(tx: Tx, record: OpsRecord, state: string, payload: Payload) {
  const rows = await tx.$queryRaw<OpsRecord[]>`UPDATE member_operation_records SET state = ${state}, payload = ${JSON.stringify(payload)}::jsonb, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ${record.id} AND revision = ${record.revision}
    RETURNING id, kind, user_id AS "userId", subject_id AS "subjectId", state, payload, points, revision, created_at AT TIME ZONE 'UTC' AS "createdAt", updated_at AT TIME ZONE 'UTC' AS "updatedAt"`;
  if (!rows[0]) throw Error("MEMBER_OPERATIONS_REVISION_CONFLICT");
  return rows[0];
}
async function writeAudit(tx: Tx, actorId: string, action: string, targetId: string, detail: Prisma.InputJsonObject = {}) {
  await tx.auditLog.create({ data: { actorId, actorType: action.startsWith("admin.") ? "admin" : "user", action, targetType: "member-operation", targetId, detail } });
}
async function claim(tx: Tx, userId: string, taskKey: MemberTaskKey, sourceId: string, current: Setting, actorId?: string) {
  if (taskKey === "STUDENT" && sourceId !== "WECHAT_VERIFIED") throw studentVerificationUnavailable();
  if (["COMMUNITY_INTERACTION", "COMMUNITY_SHARE", "FIRST_POST", "POST"].includes(taskKey)) throw disabled();
  const rule = current.config.tasks[taskKey];
  if (!rule.enabled) throw disabled();
  const period = taskPeriod(taskKey), subject = `${taskKey}:${period}:${sourceId}`, id = recordId("CLAIM", userId, subject);
  const existing = await readRecord(id, tx);
  if (existing) return { rewardPoints: 0, alreadyClaimed: true };
  if (taskKey === "COMMUNITY_INTERACTION") {
    const prior = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM member_operation_records WHERE kind = 'CLAIM' AND user_id = ${userId} AND payload->>'taskKey' = ${taskKey} AND payload->>'sourceId' = ${sourceId} LIMIT 1`;
    if (prior.length) return { rewardPoints: 0, alreadyClaimed: true };
  }
  const counts = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM member_operation_records WHERE kind = 'CLAIM' AND user_id = ${userId} AND payload->>'taskKey' = ${taskKey} AND payload->>'period' = ${period}`;
  if (taskDefinitions[taskKey].limit !== null && Number(counts[0].count) >= taskDefinitions[taskKey].limit!) throw Error("MEMBER_OPERATIONS_LIMIT_REACHED");
  const saved = await insertRecord(tx, { id, kind: "CLAIM", userId, subject, state: "REWARDED", payload: { taskKey, period, sourceId, ruleRevision: current.revision }, points: rule.rewardPoints });
  if (!saved) return { rewardPoints: 0, alreadyClaimed: true };
  await changeMemberPoints(tx, userId, { eventKey: "member-operation:" + id, delta: rule.rewardPoints, reason: "会员任务：" + taskDefinitions[taskKey].title, actorId });
  await writeAudit(tx, actorId ?? userId, actorId ? "admin.member.task.rewarded" : "member.task.rewarded", id, { taskKey, points: rule.rewardPoints, ruleRevision: current.revision });
  return { rewardPoints: rule.rewardPoints, alreadyClaimed: false };
}
async function optionalClaim(tx: Tx, userId: string, key: MemberTaskKey, sourceId: string, current: Setting, actorId?: string) {
  if (!current.config.tasks[key].enabled) return { rewardPoints: 0, alreadyClaimed: false };
  try { return await claim(tx, userId, key, sourceId, current, actorId); }
  catch (error) { if (error instanceof Error && error.message === "MEMBER_OPERATIONS_LIMIT_REACHED") return { rewardPoints: 0, alreadyClaimed: false }; throw error; }
}
function applicationDto(record: OpsRecord) {
  const student = field(record.payload, "taskKey") === "STUDENT" && record.state === "APPROVED" ? studentCertification(record.payload, record.updatedAt) : null;
  const detail = record.payload.detail && typeof record.payload.detail === "object" ? record.payload.detail as Payload : {};
  return { id: record.id, taskKey: field(record.payload, "taskKey"), status: student && !student.valid ? "EXPIRED" : record.state, note: field(record.payload, "reviewNote"), revision: record.revision, createdAt: record.createdAt.toISOString(),
    ...(student ? { certification: student } : {}), proofs: Array.isArray(detail.proofKeys) ? detail.proofKeys.filter((id): id is string => typeof id === "string" && /^msu_[a-f0-9]{32}$/.test(id)).map(id => ({ id, url: socialProofUrl(id) })) : [] };
}
function ownPostDto(record: OpsRecord) { return { id: record.id, requestId: record.subjectId, text: field(record.payload, "text"), status: record.state, note: field(record.payload, "reviewNote"), revision: record.revision, createdAt: record.createdAt.toISOString() }; }
function isComment(record: OpsRecord) { return record.kind === "POST" && field(record.payload, "contentType") === "COMMENT"; }
function isSocialApplication(record: OpsRecord) { return record.kind === "APPLICATION" && field(record.payload, "applicationType") === "SOCIAL_POST"; }
function socialApplicationDto(record: OpsRecord) {
  const ids = Array.isArray(record.payload.proofKeys) ? record.payload.proofKeys.filter((id): id is string => typeof id === "string" && /^msu_[a-f0-9]{32}$/.test(id)) : [];
  return { id: record.id, requestId: field(record.payload, "requestId"), campaignKey: field(record.payload, "campaignKey"), interactionType: field(record.payload, "interactionType"), platform: field(record.payload, "platform"),
    postUrl: field(record.payload, "postUrl"), note: field(record.payload, "note"), proofs: ids.map(id => ({ id, url: socialProofUrl(id) })), status: record.state,
    reviewNote: field(record.payload, "reviewNote"), rewardPoints: Number(record.payload.rewardPoints) || 0, revision: record.revision, createdAt: record.createdAt.toISOString() };
}
async function socialRewardAvailability(tx: Tx, userId: string, config: MemberOperationsConfig) {
  const rows = await tx.$queryRaw<Array<{ approvedBefore: bigint; firstClaims: bigint; monthlyClaims: bigint }>>`SELECT
    count(*) FILTER(WHERE kind='APPLICATION' AND payload->>'applicationType'='SOCIAL_POST' AND payload->>'campaignKey'='SOCIAL_POST' AND state='APPROVED') AS "approvedBefore",
    count(*) FILTER(WHERE kind='CLAIM' AND payload->>'taskKey'='SOCIAL_FIRST_POST') AS "firstClaims",
    count(*) FILTER(WHERE kind='CLAIM' AND payload->>'taskKey'='SOCIAL_POST' AND payload->>'period'=${taskPeriod("SOCIAL_POST")}) AS "monthlyClaims"
    FROM member_operation_records WHERE user_id=${userId}`;
  const value = rows[0];
  return selectSocialReward({ firstEnabled: config.tasks.SOCIAL_FIRST_POST.enabled, postEnabled: config.tasks.SOCIAL_POST.enabled, approvedBefore: Number(value?.approvedBefore ?? 0) > 0, firstClaims: Number(value?.firstClaims ?? 0), monthlyClaims: Number(value?.monthlyClaims ?? 0) });
}
async function latestStudentRecord(userId: string, reader: Reader = prisma) {
  const rows = await reader.$queryRaw<OpsRecord[]>`SELECT id, kind, user_id AS "userId", subject_id AS "subjectId", state, payload, points, revision, created_at AT TIME ZONE 'UTC' AS "createdAt", updated_at AT TIME ZONE 'UTC' AS "updatedAt" FROM member_operation_records
    WHERE user_id=${userId} AND kind='APPLICATION' AND state='APPROVED' AND payload->>'taskKey'='STUDENT' AND payload->>'proofVersion'='wechat-student-v1' ORDER BY created_at DESC LIMIT 1`;
  return rows[0] ?? null;
}
async function isStudentTestIdentity(tx: Pick<Tx, "siteSetting">, identityHash: string) {
  const value = (await tx.siteSetting.findUnique({ where: { key: studentTestIdentitiesKey } }))?.value;
  if (!value || typeof value !== "object" || Array.isArray(value) || !("identityHashes" in value) || !Array.isArray(value.identityHashes)
    || value.identityHashes.some(item => typeof item !== "string" || !/^[a-f0-9]{64}$/.test(item))) throw Error("MEMBER_STUDENT_TEST_CONFIGURATION_REQUIRED");
  return value.identityHashes.includes(identityHash);
}
async function claimStudentSocialBonus(tx: Tx, record: OpsRecord, current: Setting, actorId: string) {
  if (!current.config.tasks.STUDENT.enabled || !current.config.studentBenefits.enabled) return 0;
  const student = await latestStudentRecord(record.userId, tx);
  if (!student || !studentCertification(student.payload, student.updatedAt).valid || field(record.payload, "studentCycleId") !== field(student.payload, "cycleId")
    || record.createdAt < new Date(field(student.payload, "approvedAt")) || await isStudentTestIdentity(tx, field(student.payload, "identityHash"))) return 0;
  const cycleId = field(student.payload, "cycleId"), subject = "STUDENT_SOCIAL:" + cycleId;
  if (await bySubject("CLAIM", record.userId, subject, tx)) return 0;
  const points = current.config.studentBenefits.firstSocialPoints;
  const saved = await insertRecord(tx, { kind: "CLAIM", userId: record.userId, subject, state: "REWARDED", points,
    payload: { taskKey: "STUDENT_SOCIAL", period: "LIFETIME", cycleId, sourceId: record.id, ruleRevision: current.revision } });
  if (!saved) return 0;
  await changeMemberPoints(tx, record.userId, { eventKey: "member-operation:" + saved.id, delta: points, reason: "学生本期首篇社媒分享", actorId });
  return points;
}
function effectiveMemberOperationsConfig(config: MemberOperationsConfig): MemberOperationsConfig {
  return config;
}
function ownCommentDto(record: OpsRecord) { return { ...ownPostDto(record), requestId: field(record.payload, "requestId"), postId: field(record.payload, "postId") }; }

export async function getMemberOperations(userId: string) {
  await ready();
  const periods = ["LIFETIME", taskPeriod("COMMUNITY_INTERACTION"), taskPeriod("POST")];
  const [current, user, member, pointsRule, own] = await Promise.all([
    setting(), prisma.user.findFirst({ where: { id: userId, status: "ACTIVE" }, select: { phone: true } }), prisma.memberProfile.findUnique({ where: { userId }, select: { pointsBalance: true } }), getPointsRule(),
    prisma.$queryRaw<OpsRecord[]>`SELECT id, kind, user_id AS "userId", subject_id AS "subjectId", state, payload, points, revision, created_at AT TIME ZONE 'UTC' AS "createdAt", updated_at AT TIME ZONE 'UTC' AS "updatedAt" FROM member_operation_records
      WHERE user_id = ${userId} AND kind IN ('CLAIM','SURVEY','REFERRAL_CODE','REFERRAL','DRAW','APPLICATION') AND (kind <> 'CLAIM' OR payload->>'period' = ANY(${periods}::text[])) ORDER BY created_at DESC`,
  ]);
  if (!user) throw Error("ACCOUNT_NOT_FOUND");
  const config = effectiveMemberOperationsConfig(current.config);
  const ownContent = await prisma.$queryRaw<OpsRecord[]>`SELECT id, kind, user_id AS "userId", subject_id AS "subjectId", state, payload, points, revision, created_at AT TIME ZONE 'UTC' AS "createdAt", updated_at AT TIME ZONE 'UTC' AS "updatedAt" FROM member_operation_records WHERE user_id = ${userId} AND kind = 'POST' ORDER BY created_at DESC LIMIT 200`;
  const registered = !!member && !!user.phone;
  const claims = own.filter(record => record.kind === "CLAIM");
  const myApplications = own.filter(record => record.kind === "APPLICATION");
  const studentRecord = myApplications.find(record => field(record.payload, "taskKey") === "STUDENT" && record.payload.proofVersion === "wechat-student-v1");
  const certification = studentRecord?.state === "APPROVED" ? studentCertification(studentRecord.payload, studentRecord.updatedAt) : null;
  const studentTestIdentity = !!studentRecord && (studentRecord.payload.testIdentity === true || await isStudentTestIdentity(prisma, field(studentRecord.payload, "identityHash")));
  const studentBenefitsEnabled = config.tasks.STUDENT.enabled && config.studentBenefits.enabled;
  const now = new Date();
  const studentCoupons = studentBenefitsEnabled ? await prisma.couponTemplate.findMany({ where: { id: { in: config.studentBenefits.couponTemplateIds }, active: true, newcomerOnly: false, deliveryMode: "REWARD", startsAt: { lte: now }, endsAt: { gt: now } }, select: { id: true, title: true, amountCents: true, minimumCents: true } }) : [];
  const socialReward = selectSocialReward({ firstEnabled: config.tasks.SOCIAL_FIRST_POST.enabled, postEnabled: config.tasks.SOCIAL_POST.enabled,
    approvedBefore: myApplications.some(record => isSocialApplication(record) && field(record.payload, "campaignKey") === "SOCIAL_POST" && record.state === "APPROVED"),
    firstClaims: claims.filter(record => field(record.payload, "taskKey") === "SOCIAL_FIRST_POST").length,
    monthlyClaims: claims.filter(record => field(record.payload, "taskKey") === "SOCIAL_POST" && field(record.payload, "period") === taskPeriod("SOCIAL_POST")).length });
  const socialPending = myApplications.some(record => isSocialApplication(record) && field(record.payload, "campaignKey") === "SOCIAL_POST" && record.state === "PENDING");
  const referralCode = own.find(record => record.kind === "REFERRAL_CODE");
  const referralRewardSummary = await getReferralRewardOverview(prisma, userId);
  const referred = referralCode ? await prisma.$queryRaw<Array<{ state: string }>>`SELECT state FROM member_operation_records WHERE kind = 'REFERRAL' AND payload->>'inviterId' = ${userId}` : [];
  const tasks = taskKeys.filter(key => !["COMMUNITY_INTERACTION", "COMMUNITY_SHARE", "FIRST_POST", "POST"].includes(key)).map(key => {
    const definition = taskDefinitions[key], rule = config.tasks[key], period = taskPeriod(key), completed = claims.filter(record => field(record.payload, "taskKey") === key && field(record.payload, "period") === period).length;
    const pending = myApplications.some(record => record.state === "PENDING" && (field(record.payload, "taskKey") === key || ["SOCIAL_FIRST_POST", "SOCIAL_POST"].includes(key) && isSocialApplication(record) && field(record.payload, "campaignKey") === "SOCIAL_POST"));
    const state = !rule.enabled ? "DISABLED" : definition.limit !== null && completed >= definition.limit ? definition.limit === 1 ? "COMPLETED" : "LIMIT_REACHED" : pending ? "PENDING" : "AVAILABLE";
    return { key, title: definition.title, description: definition.description, rewardPoints: rule.rewardPoints, enabled: rule.enabled, state, limitLabel: taskLimitLabel(key), route: definition.route };
  });
  const posts = config.community.enabled ? await prisma.$queryRaw<OpsRecord[]>`SELECT id, kind, user_id AS "userId", subject_id AS "subjectId", state, payload, points, revision, created_at AT TIME ZONE 'UTC' AS "createdAt", updated_at AT TIME ZONE 'UTC' AS "updatedAt" FROM member_operation_records WHERE kind = 'POST' AND COALESCE(payload->>'contentType','POST') <> 'COMMENT' AND state = 'APPROVED' ORDER BY created_at DESC LIMIT 100` : [];
  const postIds = posts.map(post => post.id);
  const comments = postIds.length ? await prisma.$queryRaw<OpsRecord[]>`SELECT c.id, c.kind, c.user_id AS "userId", c.subject_id AS "subjectId", c.state, c.payload, c.points, c.revision, c.created_at AT TIME ZONE 'UTC' AS "createdAt", c.updated_at AT TIME ZONE 'UTC' AS "updatedAt" FROM member_operation_records c
    WHERE c.kind = 'POST' AND c.payload->>'contentType' = 'COMMENT' AND c.state = 'APPROVED' AND c.payload->>'postId' = ANY(${postIds}::text[])
      AND EXISTS (SELECT 1 FROM member_operation_records p WHERE p.id = c.payload->>'postId' AND p.kind = 'POST' AND p.state = 'APPROVED' AND COALESCE(p.payload->>'contentType','POST') <> 'COMMENT') ORDER BY c.created_at ASC LIMIT 200` : [];
  const reactions = postIds.length ? await prisma.$queryRaw<OpsRecord[]>`SELECT id, kind, user_id AS "userId", subject_id AS "subjectId", state, payload, points, revision, created_at AT TIME ZONE 'UTC' AS "createdAt", updated_at AT TIME ZONE 'UTC' AS "updatedAt" FROM member_operation_records WHERE kind = 'REACTION' AND payload->>'postId' = ANY(${postIds}::text[]) AND state = 'ACTIVE'` : [];
  const prizeCounts = await prisma.$queryRaw<Array<{ lotteryId: string; prizeId: string; count: bigint }>>`SELECT payload->>'lotteryId' AS "lotteryId", payload->>'prizeId' AS "prizeId", count(*) AS count FROM member_operation_records WHERE kind = 'DRAW' GROUP BY payload->>'lotteryId', payload->>'prizeId'`;
  const lotteries = config.lotteries.map(lottery => {
    const used = own.filter(record => record.kind === "DRAW" && field(record.payload, "lotteryId") === lottery.id).length;
    const totalWeight = lottery.prizes.reduce((sum, prize) => sum + prize.weight, 0);
    const publicPrizes = lottery.distribution === "UNIFORM_POINTS" ? Array.from({ length: lottery.maximumPoints - lottery.minimumPoints + 1 }, (_, index) => ({ id: "points-" + (lottery.minimumPoints + index), title: (lottery.minimumPoints + index) + "积分", kind: "POINTS", points: lottery.minimumPoints + index, probability: 1 / (lottery.maximumPoints - lottery.minimumPoints + 1), remainingStock: null })) : null;
    return { id: lottery.id, title: lottery.title, enabled: lottery.enabled, costPoints: lottery.costPoints, maxDraws: lottery.maxDraws, remainingDraws: Math.max(0, lottery.maxDraws - used), distribution: lottery.distribution, minimumPoints: lottery.minimumPoints, maximumPoints: lottery.maximumPoints, prizes: publicPrizes ?? lottery.prizes.map(prize => ({ id: prize.id, title: prize.title, kind: prize.kind, points: prize.points, probability: prize.weight / totalWeight,
      remainingStock: prize.stock === null ? null : Math.max(0, prize.stock - Number(prizeCounts.find(count => count.lotteryId === lottery.id && count.prizeId === prize.id)?.count ?? 0)) })) };
  });
  return { pointsBalance: member?.pointsBalance ?? 0, registered, ruleVersion: current.revision, tasks,
    shoppingRule: { enabled: pointsRule.enabled, centsPerPoint: pointsRule.centsPerPoint, pointsPerYuan: 100 / pointsRule.centsPerPoint, settlementLabel: "确认收货后", description: "订单按创建时有效规则，在确认收货后按商品实付金额（不含运费）累计；不足一积分舍去，退款按原规则扣回。" },
    summary: "订单积分按下单时的有效规则结算。会员任务、问卷和抽奖需开放后参与，奖励以实际完成及核验结果为准。", officialAccount: config.officialAccount, enterpriseContact: config.enterpriseContact,
    xiaohongshuAccount: config.xiaohongshuAccount,
    social: { ...config.social, platforms: socialPlatforms, interactionEnabled: registered && config.social.enabled && config.tasks.SOCIAL_INTERACTION.enabled, repostingEnabled: registered && config.social.enabled && config.tasks.SOCIAL_REPOST.enabled, postingEnabled: registered && config.social.enabled && !!socialReward && (config.tasks.SOCIAL_POST.enabled || !socialPending) },
    mySocialSubmissions: myApplications.filter(isSocialApplication).map(socialApplicationDto),
    student: { verification: studentVerification, valid: !!certification?.valid && !studentTestIdentity, testVerified: studentTestIdentity && studentRecord?.payload.isStudent === true, certification, benefitsEnabled: studentBenefitsEnabled, firstSocialPoints: config.studentBenefits.firstSocialPoints, validityDays: studentValidityDays,
      coupons: studentCoupons.map(coupon => ({ templateId: coupon.id, title: coupon.title, amountCents: coupon.amountCents, minimumCents: coupon.minimumCents })), couponCount: studentCoupons.length,
      firstSocialAwarded: !!certification?.cycleId && claims.some(record => field(record.payload, "taskKey") === "STUDENT_SOCIAL" && field(record.payload, "cycleId") === certification.cycleId) },
    community: { enabled: false, postingEnabled: false }, lotteries,
    surveys: config.surveys.map(survey => ({ ...survey, enabled: survey.enabled && config.tasks[survey.id].enabled, rewardPoints: config.tasks[survey.id].rewardPoints, completed: own.some(record => record.kind === "SURVEY" && record.subjectId === survey.id) })),
    referral: { code: referralCode?.id ?? null, invited: referred.length, rewarded: referred.filter(record => record.state === "REWARDED").length, bound: own.some(record => record.kind === "REFERRAL"), rewardSummary: referralRewardSummary },
    myApplications: myApplications.filter(record => !isSocialApplication(record)).map(applicationDto), myPosts: ownContent.filter(record => !isComment(record)).map(ownPostDto), myComments: ownContent.filter(isComment).map(ownCommentDto),
    comments: comments.map(comment => ({ id: comment.id, postId: field(comment.payload, "postId"), authorName: field(comment.payload, "authorName") || "品牌会员", text: field(comment.payload, "text"), createdAt: comment.createdAt.toISOString() })),
    posts: posts.map(post => ({ id: post.id, authorName: field(post.payload, "authorName") || "品牌会员", text: field(post.payload, "text"), createdAt: post.createdAt.toISOString(),
      likeCount: reactions.filter(record => field(record.payload, "postId") === post.id && field(record.payload, "reaction") === "LIKE").length,
      favoriteCount: reactions.filter(record => field(record.payload, "postId") === post.id && field(record.payload, "reaction") === "FAVORITE").length,
      liked: reactions.some(record => record.userId === userId && field(record.payload, "postId") === post.id && field(record.payload, "reaction") === "LIKE"),
      favorited: reactions.some(record => record.userId === userId && field(record.payload, "postId") === post.id && field(record.payload, "reaction") === "FAVORITE") })),
  };
}

export async function verifyWeChatStudent(userId: string, value: unknown, verify = quickCheckWeChatStudent) {
  const parsed = studentVerificationInputSchema.safeParse(value);
  if (!parsed.success) throw Error("INVALID_STUDENT_VERIFICATION");
  await ready();
  const input = parsed.data;
  const appId = appConfig.WECHAT_MINIPROGRAM_APP_ID;
  if (!appId) throw Error("WECHAT_MINIPROGRAM_NOT_CONFIGURED");
  const identityHash = (openId: string) => createHash("sha256").update(appId + ":" + openId).digest("hex");
  const initial = await prisma.$transaction(async tx => {
    await lockUser(tx, userId); await userForOperation(tx, userId);
    const current = await setting(tx);
    if (!current.config.tasks.STUDENT.enabled) throw studentVerificationUnavailable();
    const identity = await tx.weChatIdentity.findUnique({ where: { userId_appId: { userId, appId } }, select: { openId: true } });
    if (!identity) throw Error("WECHAT_STUDENT_LOGIN_REQUIRED");
    const hash = identityHash(identity.openId), testIdentity = await isStudentTestIdentity(tx, hash);
    const prior = await latestStudentRecord(userId, tx), certificate = prior ? studentCertification(prior.payload, prior.updatedAt) : null;
    if (!testIdentity && certificate?.valid && field(prior!.payload, "identityHash") === hash) return { cached: certificate };
    const recent = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM audit_logs WHERE actor_id=${userId} AND action='member.student.check.started' AND created_at>(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')-INTERVAL '1 minute'`;
    if (Number(recent[0]?.count ?? 0) >= 5) throw Error("WECHAT_STUDENT_RATE_LIMITED");
    await writeAudit(tx, userId, "member.student.check.started", "student", { requestId: input.requestId, consentVersion: input.consentVersion });
    return { openId: identity.openId, hash };
  });
  if (initial.cached) return { status: "VERIFIED", rewardPoints: 0, couponsIssued: 0, replayed: true, validUntil: initial.cached.validUntil };
  const checked = await verify(input.code, initial.openId!);
  if (!checked || ![1, 2, 3].includes(checked.bindStatus) || typeof checked.isStudent !== "boolean") throw Error("WECHAT_STUDENT_INVALID_RESPONSE");
  if (checked.bindStatus !== 3 || checked.isStudent !== true) return { status: checked.bindStatus === 2 ? "PENDING" : checked.bindStatus === 1 ? "UNBOUND" : "NOT_STUDENT", rewardPoints: 0, couponsIssued: 0 };
  return prisma.$transaction(async tx => {
    await lockUser(tx, userId); await userForOperation(tx, userId);
    const current = await setting(tx);
    if (!current.config.tasks.STUDENT.enabled || current.config.tasks.STUDENT.rewardPoints !== 100) throw studentVerificationUnavailable();
    const identity = await tx.weChatIdentity.findUnique({ where: { userId_appId: { userId, appId } }, select: { openId: true } });
    if (!identity || identity.openId !== initial.openId) throw Error("WECHAT_STUDENT_LOGIN_REQUIRED");
    const testIdentity = await isStudentTestIdentity(tx, initial.hash!);
    const now = new Date(), validUntil = new Date(now.getTime() + studentValidityDays * 86400000);
    const prior = await latestStudentRecord(userId, tx), certificate = prior ? studentCertification(prior.payload, prior.updatedAt, now) : null;
    if (!testIdentity && certificate?.valid && field(prior!.payload, "identityHash") === initial.hash) return { status: "VERIFIED", rewardPoints: 0, couponsIssued: 0, replayed: true, validUntil: certificate.validUntil };
    const cycleId = randomBytes(16).toString("hex");
    const payload = { taskKey: "STUDENT", applicationType: "WECHAT_STUDENT", verificationProvider: "WECHAT", proofVersion: "wechat-student-v1", bindStatus: 3, isStudent: true,
      testIdentity, identityHash: initial.hash!, consentVersion: input.consentVersion, requestId: input.requestId, approvedAt: now.toISOString(), validUntil: validUntil.toISOString(), cycleId,
      couponTemplateIds: !testIdentity && current.config.studentBenefits.enabled ? current.config.studentBenefits.couponTemplateIds : [] };
    const subject = testIdentity ? "STUDENT_WECHAT_TEST" : "STUDENT_WECHAT:" + cycleId;
    const oldTest = testIdentity ? await bySubject("APPLICATION", userId, subject, tx) : null;
    const record = oldTest ? await updateRecord(tx, oldTest, "APPROVED", payload) : await insertRecord(tx, { kind: "APPLICATION", userId, subject, state: "APPROVED", payload });
    if (!record) throw Error("MEMBER_OPERATIONS_REVISION_CONFLICT");
    if (testIdentity) {
      await writeAudit(tx, userId, "member.student.test.verified", record.id, { rewardsIssued: false });
      return { status: "TEST_VERIFIED", rewardPoints: 0, couponsIssued: 0, replayed: !!oldTest };
    }
    const reward = await optionalClaim(tx, userId, "STUDENT", "WECHAT_VERIFIED", current);
    let couponsIssued = 0;
    if (current.config.studentBenefits.enabled) {
      for (const templateId of current.config.studentBenefits.couponTemplateIds) {
        await issueEventMemberCoupon(tx, { userId, templateId, eventKey: `student:${record.id}:${cycleId}:${templateId}`, source: "STUDENT", reason: "微信学生认证周期权益", expiresAt: validUntil });
        couponsIssued++;
      }
    }
    await writeAudit(tx, userId, "member.student.wechat.verified", record.id, { cycleId, rewardPoints: reward.rewardPoints, couponsIssued, validUntil: validUntil.toISOString() });
    return { status: "VERIFIED", rewardPoints: reward.rewardPoints, couponsIssued, replayed: false, validUntil: validUntil.toISOString() };
  }, { maxWait: 5000, timeout: 15000 });
}

export async function performMemberOperation(userId: string, value: MemberOperationInput) {
  const parsed = memberOperationInputSchema.safeParse(value); if (!parsed.success) throw Error("INVALID_MEMBER_OPERATION");
  await ready(); const input = parsed.data;
  const result = await prisma.$transaction(async tx => {
    // Lottery inventory serializes across users before taking a per-user lock.
    if (input.action === "draw") await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"member-lottery:" + input.lotteryId}))`;
    await lockUser(tx, userId); const user = await userForOperation(tx, userId), current = await setting(tx), { config } = current;
    if (input.action === "claim_task") {
      if (!config.tasks.PROFILE.enabled) throw disabled();
      const profiles = await tx.$queryRaw<Array<{ displayName: string; gender: string | null; birthday: Date | null; registeredAt: Date | null }>>`SELECT display_name AS "displayName", gender, birthday, registered_at AT TIME ZONE 'UTC' AS "registeredAt" FROM member_account_profiles WHERE user_id = ${userId}`;
      const profile = profiles[0];
      if (!profile?.registeredAt || !profile.displayName || !profile.gender || !profile.birthday) throw Error("MEMBER_OPERATIONS_PROFILE_INCOMPLETE");
      return claim(tx, userId, "PROFILE", "LIFETIME", current);
    }
    if (input.action === "submit_application") {
      if (input.taskKey === "STUDENT") throw studentVerificationUnavailable();
      if (!config.tasks[input.taskKey].enabled || input.taskKey === "ENTERPRISE" && !config.enterpriseContact.enabled || input.taskKey === "OFFICIAL_ACCOUNT" && !config.officialAccount.enabled) throw disabled();
      const enterprise = input.taskKey === "ENTERPRISE";
      if (enterprise && !input.detail.proofKeys?.length) throw Error("INVALID_MEMBER_OPERATION");
      if (!enterprise && input.detail.proofKeys?.length) throw Error("INVALID_MEMBER_OPERATION");
      const existing = await bySubject("APPLICATION", userId, input.taskKey, tx);
      if (existing && existing.state !== "REJECTED") {
        if (!isDeepStrictEqual(existing.payload.detail, input.detail)) throw Error("MEMBER_OPERATIONS_REVISION_CONFLICT");
        return { application: applicationDto(existing) };
      }
      if ((existing?.revision ?? 0) !== (input.expectedRevision ?? 0)) throw Error("MEMBER_OPERATIONS_REVISION_CONFLICT");
      const id = existing?.id ?? recordId("APPLICATION", userId, input.taskKey);
      if (enterprise) await bindSocialProofs(tx, userId, id, input.detail.proofKeys!, "ENTERPRISE");
      const payload = { taskKey: input.taskKey, detail: input.detail, ruleRevision: current.revision };
      const result = existing ? await updateRecord(tx, existing, "PENDING", payload) : await insertRecord(tx, { id, kind: "APPLICATION", userId, subject: input.taskKey, state: "PENDING", payload });
      if (!result) throw Error("MEMBER_OPERATIONS_REVISION_CONFLICT");
      await writeAudit(tx, userId, "member.application.submitted", result.id, { taskKey: input.taskKey });
      return { application: applicationDto(result) };
    }
    if (input.action === "submit_survey") {
      const survey = config.surveys.find(survey => survey.id === input.surveyId);
      if (!survey?.enabled || !config.tasks[input.surveyId].enabled) throw disabled();
      if (!validSurveyAnswers(survey, input.answers)) throw Error("INVALID_MEMBER_OPERATION");
      const existing = await bySubject("SURVEY", userId, input.surveyId, tx);
      if (existing) return { completed: true, rewardPoints: 0, alreadyClaimed: true };
      const result = await insertRecord(tx, { kind: "SURVEY", userId, subject: input.surveyId, state: "APPROVED", payload: { surveyId: input.surveyId, title: survey.title, questions: survey.questions, answers: input.answers, ruleRevision: current.revision } });
      if (!result) throw Error("MEMBER_OPERATIONS_REVISION_CONFLICT");
      const reward = await claim(tx, userId, input.surveyId, "LIFETIME", current);
      await writeAudit(tx, userId, "member.survey.submitted", result.id, { surveyId: input.surveyId });
      return { completed: true, ...reward };
    }
    if (input.action === "submit_social_submission") {
      const subject = "social:" + input.requestId, existing = await bySubject("APPLICATION", userId, subject, tx);
      const material = { campaignKey: input.campaignKey, platform: input.platform, postUrl: input.postUrl, note: input.note, proofKeys: input.proofKeys, ...(input.interactionType ? { interactionType: input.interactionType } : {}) };
      if (existing) {
        if (!isSocialApplication(existing)) throw Error("MEMBER_OPERATIONS_REQUEST_CHANGED");
        const unchanged = Object.entries(material).every(([key, value]) => isDeepStrictEqual(existing.payload[key], value));
        if (unchanged && (existing.state !== "REJECTED" || input.expectedRevision !== existing.revision)) return { submission: socialApplicationDto(existing), replayed: true };
        if (existing.state !== "REJECTED") throw Error("MEMBER_OPERATIONS_REQUEST_CHANGED");
      }
      if ((existing?.revision ?? 0) !== (input.expectedRevision ?? 0)) throw Error("MEMBER_OPERATIONS_REVISION_CONFLICT");
      const following = input.campaignKey === "XIAOHONGSHU_FOLLOW";
      const posting = input.campaignKey === "SOCIAL_POST";
      if (following ? !config.xiaohongshuAccount.enabled || !config.tasks.XIAOHONGSHU_FOLLOW.enabled : !config.social.enabled || (posting ? !(config.tasks.SOCIAL_FIRST_POST.enabled || config.tasks.SOCIAL_POST.enabled) : !config.tasks[input.campaignKey].enabled)) throw disabled();
      if (posting) {
        if (!await socialRewardAvailability(tx, userId, config)) throw Error("MEMBER_OPERATIONS_LIMIT_REACHED");
        if (!config.tasks.SOCIAL_POST.enabled) {
          const pending = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM member_operation_records WHERE kind='APPLICATION' AND user_id=${userId} AND payload->>'applicationType'='SOCIAL_POST' AND payload->>'campaignKey'='SOCIAL_POST' AND state='PENDING' AND id<>${existing?.id ?? ""} LIMIT 1`;
          if (pending.length) throw Error("MEMBER_OPERATIONS_LIMIT_REACHED");
        }
      }
      if (following) {
        const claims = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM member_operation_records WHERE kind='CLAIM' AND user_id=${userId} AND payload->>'taskKey'='XIAOHONGSHU_FOLLOW' LIMIT 1`;
        const pending = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM member_operation_records WHERE kind='APPLICATION' AND user_id=${userId} AND payload->>'applicationType'='SOCIAL_POST' AND payload->>'campaignKey'='XIAOHONGSHU_FOLLOW' AND state IN ('PENDING','APPROVED') AND id<>${existing?.id ?? ""} LIMIT 1`;
        if (claims.length || pending.length) throw Error("MEMBER_OPERATIONS_LIMIT_REACHED");
      }
      const minute = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM audit_logs WHERE actor_id=${userId} AND action='member.social.submission.created' AND created_at>(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')-INTERVAL '1 minute'`;
      if (Number(minute[0]?.count ?? 0) >= 5) throw Error("MEMBER_OPERATIONS_RATE_LIMITED");
      const canonicalUrl = canonicalSocialUrl(input.postUrl), evidenceBehavior = input.campaignKey + ":" + (input.interactionType ?? "POST");
      if (canonicalUrl) {
        const duplicates = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM member_operation_records WHERE kind='APPLICATION' AND user_id=${userId} AND payload->>'applicationType'='SOCIAL_POST' AND payload->>'canonicalUrl'=${canonicalUrl} AND COALESCE(payload->>'evidenceBehavior', (payload->>'campaignKey') || ':POST')=${evidenceBehavior} AND id<>${existing?.id ?? ""} LIMIT 1`;
        if (duplicates.length) throw Error("MEMBER_OPERATIONS_DUPLICATE_CONTENT");
      }
      const id = existing?.id ?? recordId("APPLICATION", userId, subject);
      await bindSocialProofs(tx, userId, id, input.proofKeys, "SOCIAL");
      const student = input.campaignKey === "SOCIAL_POST" ? await latestStudentRecord(userId, tx) : null;
      const studentCycleId = student && studentCertification(student.payload, student.updatedAt).valid ? field(student.payload, "cycleId") : "";
      const payload = { applicationType: "SOCIAL_POST", requestId: input.requestId, ...material, canonicalUrl, evidenceBehavior,
        taskKey: input.campaignKey, ruleRevision: current.revision, studentCycleId };
      const record = existing ? await updateRecord(tx, existing, "PENDING", payload) : await insertRecord(tx, { id, kind: "APPLICATION", userId, subject, state: "PENDING", payload });
      if (!record) throw Error("MEMBER_OPERATIONS_REVISION_CONFLICT");
      await writeAudit(tx, userId, "member.social.submission.created", record.id, { campaignKey: input.campaignKey, platform: input.platform, proofCount: input.proofKeys.length });
      return { submission: socialApplicationDto(record), replayed: false };
    }
    if (input.action === "create_referral") {
      if (!config.tasks.INVITE.enabled) throw disabled();
      const existing = await bySubject("REFERRAL_CODE", userId, "CURRENT", tx); if (existing) return { code: existing.id };
      const code = "ref_" + randomBytes(18).toString("hex");
      const record = await insertRecord(tx, { id: code, kind: "REFERRAL_CODE", userId, subject: "CURRENT", state: "ACTIVE", payload: {} });
      if (!record) throw Error("MEMBER_OPERATIONS_REVISION_CONFLICT"); return { code };
    }
    if (input.action === "bind_referral") {
      if (!config.tasks.INVITE.enabled) throw disabled();
      const code = await readRecord(input.code, tx);
      if (!code || code.kind !== "REFERRAL_CODE" || code.state !== "ACTIVE" || code.userId === userId) throw Error("MEMBER_OPERATIONS_INVALID_REFERRAL");
      const existing = await bySubject("REFERRAL", userId, "CURRENT", tx);
      if (existing) { if (field(existing.payload, "inviterId") !== code.userId) throw Error("MEMBER_OPERATIONS_REFERRAL_BOUND"); return { bound: true }; }
      const { referral: referralPolicy } = await readMemberRewardPolicy(tx), now = Date.now();
      if (user.joinedAt.getTime() > now || now - user.joinedAt.getTime() > 24 * 60 * 60 * 1000
        || referralPolicy.enabled && (!referralPolicy.activatedAt || user.joinedAt < new Date(referralPolicy.activatedAt))
        || await tx.order.findFirst({ where: { userId, paymentStatus: { in: ["PAID", "REFUNDED"] } }, select: { id: true } })) throw Error("MEMBER_OPERATIONS_NEW_MEMBER_REQUIRED");
      await userForOperation(tx, code.userId);
      await insertRecord(tx, { kind: "REFERRAL", userId, subject: "CURRENT", state: "PENDING", payload: { inviterId: code.userId, code: code.id, ruleRevision: current.revision } });
      return { bound: true };
    }
    if (input.action === "draw") return draw(tx, userId, input, current);
    // External screenshot tasks are the only social reward entry points.
    throw disabled();
  }, { maxWait: 5_000, timeout: 15_000 });
  return result;
}

async function settleShareVisit(visitId: string, sharerId: string) {
  return prisma.$transaction(async tx => {
    await lockUser(tx, sharerId);
    const visit = await readRecord(visitId, tx);
    if (!visit || visit.kind !== "SHARE_VISIT" || visit.state !== "PENDING" || field(visit.payload, "sharerId") !== sharerId) return;
    const current = await setting(tx);
    if (!current.config.community.enabled || !current.config.tasks.COMMUNITY_SHARE.enabled) { await updateRecord(tx, visit, "REJECTED", visit.payload); return; }
    await userForOperation(tx, sharerId);
    const reward = await optionalClaim(tx, sharerId, "COMMUNITY_SHARE", visit.id, current);
    await updateRecord(tx, visit, "APPROVED", { ...visit.payload, rewardPoints: reward.rewardPoints });
  }, { maxWait: 5_000, timeout: 15_000 });
}

async function draw(tx: Tx, userId: string, input: Extract<MemberOperationInput, { action: "draw" }>, current: Setting) {
  const existing = await bySubject("DRAW", userId, input.requestId, tx);
  if (existing) {
    if (field(existing.payload, "lotteryId") !== input.lotteryId) throw Error("MEMBER_OPERATIONS_REQUEST_CHANGED");
    return { draw: publicDraw(existing), replayed: true };
  }
  const lottery = current.config.lotteries.find(lottery => lottery.id === input.lotteryId); if (!lottery?.enabled) throw disabled();
  const history = await tx.$queryRaw<Array<{ prizeId: string; userId: string }>>`SELECT payload->>'prizeId' AS "prizeId", user_id AS "userId" FROM member_operation_records WHERE kind = 'DRAW' AND payload->>'lotteryId' = ${lottery.id}`;
  if (history.filter(draw => draw.userId === userId).length >= lottery.maxDraws) throw Error("MEMBER_OPERATIONS_LIMIT_REACHED");
  const member = await tx.memberProfile.findUniqueOrThrow({ where: { userId } });
  if (member.pointsBalance < lottery.costPoints) throw Error("POINTS_INSUFFICIENT");
  // Exhausted prize weight becomes the configured no-prize outcome; the public
  // probabilities never improve by silently redistributing sold-out prizes.
  const number = randomInt(lottery.prizes.reduce((sum, prize) => sum + prize.weight, 0));
  let cursor = 0, selected = lottery.prizes[lottery.prizes.length - 1];
  for (const prize of lottery.prizes) { cursor += prize.weight; if (number < cursor) { selected = prize; break; } }
  if (lottery.distribution === "UNIFORM_POINTS") {
    const points = randomInt(lottery.minimumPoints, lottery.maximumPoints + 1);
    selected = { id: "points-" + points, title: points + "积分", kind: "POINTS", points, couponTemplateId: null, weight: 1, stock: null };
  } else if (selected.stock !== null && history.filter(draw => draw.prizeId === selected.id).length >= selected.stock) selected = lottery.prizes.find(prize => prize.kind === "NONE" && prize.stock === null)!;
  const id = recordId("DRAW", userId, input.requestId);
  if (selected.kind === "COUPON") {
    const template = await tx.couponTemplate.findUnique({ where: { id: selected.couponTemplateId! } }), now = new Date();
    if (!template || !template.active || template.startsAt > now || template.endsAt <= now || template.newcomerOnly || !["MANUAL", "PUBLIC"].includes(template.deliveryMode)) throw Error("MEMBER_OPERATIONS_COUPON_UNAVAILABLE");
    const reserve = await tx.couponTemplate.updateMany({ where: { id: template.id, issuedCount: { lt: template.totalLimit } }, data: { issuedCount: { increment: 1 } } });
    if (reserve.count !== 1) throw Error("MEMBER_OPERATIONS_COUPON_UNAVAILABLE");
    await tx.couponClaim.create({ data: { id: "lottery_" + id, userId, templateId: template.id, source: "MANUAL" } });
  }
  // Reserve a coupon before locking a points balance, matching the existing
  // redemption flow's template -> member order. A failed deduction rolls back
  // both the reservation and the claim in this same transaction.
  try { await changeMemberPoints(tx, userId, { eventKey: "member-lottery-cost:" + id, delta: -lottery.costPoints, reason: "会员积分抽奖：" + lottery.title }); }
  catch (error) { if (error instanceof Error && error.message.includes("可用积分不足")) throw Error("POINTS_INSUFFICIENT"); throw error; }
  if (selected.kind === "POINTS") await changeMemberPoints(tx, userId, { eventKey: "member-lottery-prize:" + id, delta: selected.points, reason: "会员抽奖奖励：" + selected.title });
  const record = await insertRecord(tx, { id, kind: "DRAW", userId, subject: input.requestId, state: "APPROVED", points: selected.kind === "POINTS" ? selected.points - lottery.costPoints : -lottery.costPoints,
    payload: { lotteryId: lottery.id, prizeId: selected.id, prizeTitle: selected.title, kind: selected.kind, points: selected.points, costPoints: lottery.costPoints, ruleRevision: current.revision } });
  if (!record) throw Error("MEMBER_OPERATIONS_REVISION_CONFLICT");
  await writeAudit(tx, userId, "member.lottery.drawn", record.id, { lotteryId: lottery.id, prizeId: selected.id, costPoints: lottery.costPoints });
  return { draw: publicDraw(record), replayed: false };
}
function publicDraw(record: OpsRecord) { return { id: record.id, prizeTitle: field(record.payload, "prizeTitle"), kind: field(record.payload, "kind"), points: Number(record.payload.points) || 0, costPoints: Number(record.payload.costPoints) || 0 }; }

export async function getAdminMemberOperations(actorId: string, query: MemberReviewQuery = {}) {
  const { status, page: requestedPage } = normalizeMemberReviewQuery(query);
  await ready(); await admin(prisma, actorId);
  const [current, records, coupons, counts] = await Promise.all([setting(), prisma.$queryRaw<OpsRecord[]>`SELECT id, kind, user_id AS "userId", subject_id AS "subjectId", state, payload, points, revision, created_at AT TIME ZONE 'UTC' AS "createdAt", updated_at AT TIME ZONE 'UTC' AS "updatedAt" FROM member_operation_records WHERE kind IN ('APPLICATION', 'REFERRAL', 'POST', 'REPORT', 'SHARE_VISIT', 'DRAW', 'SURVEY') ORDER BY created_at DESC LIMIT 300`,
    prisma.couponTemplate.findMany({ where: { active: true, newcomerOnly: false, deliveryMode: { in: ["MANUAL", "PUBLIC", "REWARD"] } }, select: { id: true, title: true, deliveryMode: true, amountCents: true, minimumCents: true }, take: 100 }),
    prisma.$queryRaw<Array<{ total: bigint; pending: bigint }>>`SELECT count(*) FILTER(WHERE ${status}='ALL' OR state=${status}) AS total, count(*) FILTER(WHERE state='PENDING') AS pending FROM member_operation_records WHERE kind IN ('APPLICATION','POST','REPORT')`]);
  const total = Number(counts[0]?.total ?? 0), page = Math.min(requestedPage, Math.max(1, Math.ceil(total / memberReviewPageSize)));
  const reviewRecords = await prisma.$queryRaw<OpsRecord[]>`SELECT id, kind, user_id AS "userId", subject_id AS "subjectId", state, payload, points, revision, created_at AT TIME ZONE 'UTC' AS "createdAt", updated_at AT TIME ZONE 'UTC' AS "updatedAt" FROM member_operation_records WHERE kind IN ('APPLICATION','POST','REPORT') AND (${status}='ALL' OR state=${status}) ORDER BY (CASE WHEN ${status}='PENDING' THEN created_at END) ASC, created_at DESC, id DESC LIMIT ${memberReviewPageSize} OFFSET ${(page - 1) * memberReviewPageSize}`;
  const parentIds = [...records, ...reviewRecords].filter(isComment).map(record => field(record.payload, "postId"));
  const parents = parentIds.length ? await prisma.$queryRaw<Array<{ id: string; state: string; payload: Payload }>>`SELECT id,state,payload FROM member_operation_records WHERE id = ANY(${parentIds}::text[]) AND kind = 'POST' AND COALESCE(payload->>'contentType','POST') <> 'COMMENT'` : [];
  const present = (record: OpsRecord) => { const parent = isComment(record) ? parents.find(parent => parent.id === field(record.payload, "postId")) : null; return { ...record, ...(isSocialApplication(record) ? { socialSubmission: socialApplicationDto(record) } : {}), parentPost: parent ? { text: field(parent.payload, "text"), authorName: field(parent.payload, "authorName"), status: parent.state } : null, createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString() }; };
  return { config: effectiveMemberOperationsConfig(current.config), studentVerification, revision: current.revision, updatedAt: current.updatedAt?.toISOString() ?? null, taskDefinitions, couponTemplates: coupons,
    records: records.map(present), review: { records: reviewRecords.map(present), total, pending: Number(counts[0]?.pending ?? 0), page, pageSize: memberReviewPageSize, status } };
}
export async function saveMemberOperationsConfig(actorId: string, value: unknown, expectedRevision: number) {
  const parsed = memberOperationsConfigSchema.safeParse(value);
  if (!parsed.success || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > 2147483646) throw Error("INVALID_MEMBER_OPERATIONS_CONFIG");
  await ready(); return prisma.$transaction(async tx => {
    await admin(tx, actorId);
    // The single settings row gives configuration writes compare-and-swap
    // semantics without changing any existing site setting or commerce row.
    const config = parsed.data, json = JSON.stringify(config);
    if (config.tasks.STUDENT.enabled && config.tasks.STUDENT.rewardPoints !== 100) throw Error("INVALID_MEMBER_OPERATION");
    if (config.studentBenefits.enabled && (!config.tasks.STUDENT.enabled || config.studentBenefits.firstSocialPoints !== 1500)) throw Error("INVALID_MEMBER_OPERATION");
    const { referral: referralPolicy } = await readMemberRewardPolicy(tx);
    if (referralPolicy.enabled && config.tasks.INVITE.rewardPoints !== referralPolicy.inviterRegistrationPoints) throw Error("INVALID_MEMBER_OPERATION");
    if (config.studentBenefits.enabled) {
      const templates = await tx.couponTemplate.findMany({ where: { id: { in: config.studentBenefits.couponTemplateIds } } });
      const now = new Date();
      if (templates.length !== 2 || templates.some(template => !template.active || template.newcomerOnly || template.deliveryMode !== "REWARD" || template.startsAt > now || template.endsAt <= now)
        || !templates.some(template => template.amountCents === 10000 && template.minimumCents === 60000)
        || !templates.some(template => template.amountCents === 40000 && template.minimumCents === 220000)) throw Error("MEMBER_OPERATIONS_STUDENT_COUPON_UNAVAILABLE");
    }
    for (const lottery of config.lotteries.filter(lottery => lottery.enabled && lottery.distribution === "WEIGHTED")) for (const prize of lottery.prizes.filter(prize => prize.kind === "COUPON")) {
      const template = await tx.couponTemplate.findUnique({ where: { id: prize.couponTemplateId! } });
      if (!template || !template.active || template.newcomerOnly || !["MANUAL", "PUBLIC"].includes(template.deliveryMode) || template.endsAt <= new Date()) throw Error("MEMBER_OPERATIONS_COUPON_UNAVAILABLE");
    }
    let rows: Array<{ revision: number }>;
    if (expectedRevision === 0) rows = await tx.$queryRaw<Array<{ revision: number }>>`INSERT INTO member_operation_settings (id, revision, config, updated_by) VALUES ('member-operations', 1, ${json}::jsonb, ${actorId}) ON CONFLICT DO NOTHING RETURNING revision`;
    else rows = await tx.$queryRaw<Array<{ revision: number }>>`UPDATE member_operation_settings SET config = ${json}::jsonb, revision = revision + 1, updated_by = ${actorId}, updated_at = CURRENT_TIMESTAMP WHERE id = 'member-operations' AND revision = ${expectedRevision} RETURNING revision`;
    if (!rows[0]) throw Error("MEMBER_OPERATIONS_REVISION_CONFLICT");
    await writeAudit(tx, actorId, "admin.member.operations.configured", "member-operations", { revision: rows[0].revision, enabledTasks: taskKeys.filter(key => config.tasks[key].enabled), communityEnabled: config.community.enabled, enabledLotteries: config.lotteries.filter(lottery => lottery.enabled).map(lottery => lottery.id) });
    return { revision: rows[0].revision, config };
  });
}
export async function reviewMemberOperation(actorId: string, value: MemberOperationsAdminInput) {
  const parsed = memberOperationsAdminInputSchema.safeParse(value); if (!parsed.success) throw Error("INVALID_MEMBER_OPERATION");
  await ready(); return prisma.$transaction(async tx => {
    await admin(tx, actorId); const input = parsed.data, first = await readRecord(input.id, tx); if (!first) throw Error("MEMBER_OPERATIONS_NOT_FOUND");
    // Referrals reward the inviter, all other reviews reward the record owner.
    const recipient = first.kind === "REFERRAL" ? field(first.payload, "inviterId") : first.userId;
    await lockUser(tx, recipient); const record = await readRecord(input.id, tx); if (!record || record.revision !== input.expectedRevision) throw Error("MEMBER_OPERATIONS_REVISION_CONFLICT");
    const current = await setting(tx); let rewardPoints = 0;
    if (input.action === "review_application") {
      if (record.kind !== "APPLICATION" || record.state !== "PENDING") throw Error("MEMBER_OPERATIONS_REVISION_CONFLICT");
      if (isSocialApplication(record)) {
        let rewardKey: MemberTaskKey | null = null, verifiedContentKeyHash = field(record.payload, "verifiedContentKeyHash");
        if (input.decision === "APPROVED") {
          if (needsManualContentReference(field(record.payload, "postUrl")) && field(record.payload, "campaignKey") !== "XIAOHONGSHU_FOLLOW") {
            const reference = (input.verifiedContentKey || "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
            if (reference.length < 2) throw Error("MEMBER_OPERATIONS_CONTENT_REFERENCE_REQUIRED");
            verifiedContentKeyHash = createHash("sha256").update(JSON.stringify([record.userId, field(record.payload, "platform"), field(record.payload, "campaignKey"), field(record.payload, "interactionType"), reference])).digest("hex");
            const duplicates = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM member_operation_records WHERE kind='APPLICATION' AND user_id=${record.userId} AND state='APPROVED' AND payload->>'verifiedContentKeyHash'=${verifiedContentKeyHash} AND id<>${record.id} LIMIT 1`;
            if (duplicates.length) throw Error("MEMBER_OPERATIONS_DUPLICATE_CONTENT");
          }
          await userForOperation(tx, record.userId);
          const following = field(record.payload, "campaignKey") === "XIAOHONGSHU_FOLLOW";
          if (following) {
            if (!current.config.xiaohongshuAccount.enabled || !current.config.tasks.XIAOHONGSHU_FOLLOW.enabled) throw disabled();
            rewardKey = "XIAOHONGSHU_FOLLOW";
          } else {
            if (!current.config.social.enabled) throw disabled();
            const campaignKey = field(record.payload, "campaignKey");
            rewardKey = campaignKey === "SOCIAL_INTERACTION" || campaignKey === "SOCIAL_REPOST" ? campaignKey : await socialRewardAvailability(tx, record.userId, current.config);
            if (!rewardKey) throw Error("MEMBER_OPERATIONS_LIMIT_REACHED");
          }
          if (!current.config.tasks[rewardKey].enabled) throw disabled();
          rewardPoints = field(record.payload, "campaignKey") === "SOCIAL_POST" ? await claimStudentSocialBonus(tx, record, current, actorId) : 0;
          if (!rewardPoints) rewardPoints = (await claim(tx, record.userId, rewardKey, following ? "LIFETIME" : record.id, current, actorId)).rewardPoints;
        }
        await updateRecord(tx, record, input.decision, { ...record.payload, reviewNote: input.note, reviewedBy: actorId, rewardKey, rewardPoints, verifiedContentKeyHash });
        await writeAudit(tx, actorId, "admin.member.social.reviewed", record.id, { decision: input.decision, rewardKey, rewardPoints });
        return { reviewed: true, rewardPoints };
      }
      const key = field(record.payload, "taskKey") as MemberTaskKey;
      if (!["STUDENT", "OFFICIAL_ACCOUNT", "ENTERPRISE"].includes(key)) throw Error("INVALID_MEMBER_OPERATION");
      if (key === "STUDENT") throw studentVerificationUnavailable();
      if (input.decision === "APPROVED") {
        await userForOperation(tx, record.userId);
        if (key === "ENTERPRISE") {
          const detail = record.payload.detail && typeof record.payload.detail === "object" ? record.payload.detail as Payload : {};
          const proofs = Array.isArray(detail.proofKeys) ? detail.proofKeys.filter((value): value is string => typeof value === "string" && /^msu_[a-f0-9]{32}$/.test(value)) : [];
          if (!proofs.length || proofs.length > 3) throw Error("INVALID_MEMBER_OPERATION");
          await bindSocialProofs(tx, record.userId, record.id, proofs, "ENTERPRISE");
        }
        rewardPoints = (await claim(tx, record.userId, key, "LIFETIME", current, actorId)).rewardPoints;
      }
      await updateRecord(tx, record, input.decision, { ...record.payload, reviewNote: input.note, reviewedBy: actorId });
    } else if (input.action === "review_post") {
      if (record.kind !== "POST" || isComment(record) || record.state !== "PENDING") throw Error("MEMBER_OPERATIONS_REVISION_CONFLICT");
      if (input.decision === "APPROVED") {
        if (!current.config.community.enabled) throw disabled(); await userForOperation(tx, record.userId);
        const previous = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM member_operation_records WHERE kind = 'POST' AND COALESCE(payload->>'contentType','POST') <> 'COMMENT' AND user_id = ${record.userId} AND state = 'APPROVED'`;
        rewardPoints = (await optionalClaim(tx, record.userId, Number(previous[0].count) === 0 ? "FIRST_POST" : "POST", record.id, current, actorId)).rewardPoints;
      }
      await updateRecord(tx, record, input.decision, { ...record.payload, reviewNote: input.note, reviewedBy: actorId });
    } else if (input.action === "review_comment") {
      if (!isComment(record) || record.state !== "PENDING") throw Error("MEMBER_OPERATIONS_REVISION_CONFLICT");
      if (input.decision === "APPROVED") {
        if (!current.config.community.enabled) throw disabled(); await userForOperation(tx, record.userId);
        const parents = await tx.$queryRaw<Array<{ userId: string }>>`SELECT user_id AS "userId" FROM member_operation_records WHERE id = ${field(record.payload, "postId")} AND kind = 'POST' AND COALESCE(payload->>'contentType','POST') <> 'COMMENT' AND state = 'APPROVED' FOR SHARE`;
        if (!parents[0]) throw Error("MEMBER_OPERATIONS_NOT_FOUND");
        if (parents[0].userId !== record.userId) rewardPoints = (await optionalClaim(tx, record.userId, "COMMUNITY_INTERACTION", "comment:" + record.id, current, actorId)).rewardPoints;
      }
      await updateRecord(tx, record, input.decision, { ...record.payload, reviewNote: input.note, reviewedBy: actorId });
    } else if (input.action === "moderate_post" || input.action === "moderate_comment") {
      if (record.kind !== "POST" || isComment(record) !== (input.action === "moderate_comment") || record.state !== "APPROVED") throw Error("MEMBER_OPERATIONS_REVISION_CONFLICT");
      await updateRecord(tx, record, "REJECTED", { ...record.payload, reviewNote: input.note, reviewedBy: actorId });
      await tx.$executeRaw`UPDATE member_operation_records SET state = 'APPROVED', revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE kind = 'REPORT' AND subject_id = ${record.id} AND state = 'PENDING'`;
    } else if (input.action === "review_referral") {
      throw Error("MEMBER_OPERATIONS_REFERRAL_AUTOMATIC");
    } else if (input.action === "review_report") {
      if (record.kind !== "REPORT" || record.state !== "PENDING") throw Error("MEMBER_OPERATIONS_REVISION_CONFLICT");
      if (input.decision === "APPROVED") {
        const post = await readRecord(field(record.payload, "postId"), tx);
        if (!post || post.kind !== "POST") throw Error("MEMBER_OPERATIONS_NOT_FOUND");
        if (post.state === "APPROVED") await updateRecord(tx, post, "REJECTED", { ...post.payload, reviewNote: input.note, reviewedBy: actorId });
      }
      await updateRecord(tx, record, input.decision, { ...record.payload, reviewNote: input.note, reviewedBy: actorId });
    }
    await writeAudit(tx, actorId, "admin.member.operation.reviewed", record.id, { action: input.action, rewardPoints });
    return { reviewed: true, rewardPoints };
  }, { maxWait: 5_000, timeout: 15_000 });
}

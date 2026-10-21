import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultMemberOperationsConfig, memberOperationsConfigSchema, memberOperationInputSchema, memberOperationsAdminInputSchema, taskKeys, taskPeriod, validSurveyAnswers } from "@/lib/commerce/member-operations";

test("all new programs are disabled by default and retain the agreed points amounts", () => {
  const config = defaultMemberOperationsConfig(); assert(memberOperationsConfigSchema.safeParse(config).success);
  assert.equal(taskKeys.length, 17); assert(Object.values(config.tasks).every(task => !task.enabled));
  assert(config.surveys.every(survey => !survey.enabled)); assert(config.lotteries.every(lottery => !lottery.enabled)); assert.equal(config.community.enabled, false);
  assert.deepEqual(taskKeys.map(key => config.tasks[key].rewardPoints), [100,100,50,50,100,100,50,300,5,5,100,20,50,5,20,5,5]);
});
test("each defaults call is an independent draft", () => { const first = defaultMemberOperationsConfig(); first.tasks.PROFILE.enabled = true; assert.equal(defaultMemberOperationsConfig().tasks.PROFILE.enabled, false); });
test("configuration cannot introduce an unsupported rule or unsafe reward amount", () => {
  const config = defaultMemberOperationsConfig();
  assert.equal(memberOperationsConfigSchema.safeParse({ ...config, tasks: { ...config.tasks, UNKNOWN: { enabled: true, rewardPoints: 5 } } }).success, false);
  for (const rewardPoints of [0,-1,1.5,100001]) assert.equal(memberOperationsConfigSchema.safeParse({ ...config, tasks: { ...config.tasks, PROFILE: { enabled: true, rewardPoints } } }).success, false);
});
test("lottery rejects free, impossible, malformed or fallback-free draws", () => {
  for (const patch of [{ costPoints: 0 }, { maxDraws: 0 }, { prizes: [] }, { prizes: [{ id: "points", title: "分", kind: "POINTS", points: 10, couponTemplateId: null, weight: 1, stock: 1 }] }]) {
    const config = defaultMemberOperationsConfig(); const invalid: unknown = { ...config, lotteries: [{ ...config.lotteries[0], distribution: "WEIGHTED", ...patch }, ...config.lotteries.slice(1)] }; assert.equal(memberOperationsConfigSchema.safeParse(invalid).success, false);
  }
});
test("coupon draws require finite inventory and a real selected template", () => {
  const config = defaultMemberOperationsConfig(); config.lotteries[0].prizes[0] = { id: "coupon", title: "券", kind: "COUPON", points: 0, couponTemplateId: null, weight: 10, stock: 10 }; assert.equal(memberOperationsConfigSchema.safeParse(config).success, false);
  config.lotteries[0].prizes[0].couponTemplateId = "template-id"; assert(memberOperationsConfigSchema.safeParse(config).success);
  config.lotteries[0].prizes[0].stock = null; assert.equal(memberOperationsConfigSchema.safeParse(config).success, false);
});
test("contact images allow only HTTPS or uploaded media", () => {
  for (const qrImageUrl of ["/uploads/qr.png", "https://example.invalid/uploads/qr.png", ""]) { const config = defaultMemberOperationsConfig(); config.officialAccount.qrImageUrl = qrImageUrl; assert(memberOperationsConfigSchema.safeParse(config).success); }
  for (const qrImageUrl of ["javascript:alert(1)", "http://insecure.test/a.png", "/uploads/../../.env"]) { const config = defaultMemberOperationsConfig(); config.officialAccount.qrImageUrl = qrImageUrl; assert.equal(memberOperationsConfigSchema.safeParse(config).success, false); }
});
test("questionnaires require all three independent IDs and unique valid questions", () => {
  const config = defaultMemberOperationsConfig(); config.surveys[1].id = "PREFERENCES"; assert.equal(memberOperationsConfigSchema.safeParse(config).success, false);
  const sameQuestion = defaultMemberOperationsConfig(); sameQuestion.surveys[0].questions.push(sameQuestion.surveys[0].questions[0]); assert.equal(memberOperationsConfigSchema.safeParse(sameQuestion).success, false);
});
test("survey answers enforce required choices, uniqueness, question IDs and shape", () => {
  const survey = defaultMemberOperationsConfig().surveys[0];
  assert(validSurveyAnswers(survey, { fit: "适中", focus: ["透气", "柔软"] }));
  const invalidAnswers: Array<Record<string, string | string[]>> = [{ fit: "伪造", focus: ["透气"] }, { fit: "适中", focus: [] }, { fit: "适中", focus: ["透气", "透气"] }, { fit: ["适中"], focus: ["透气"] }, { fit: "适中", focus: ["透气"], phone: "extra" }];
  for (const answers of invalidAnswers) assert.equal(validSurveyAnswers(survey, answers), false);
});
test("daily and monthly limits use Beijing calendar boundaries", () => {
  const now = new Date("2026-10-31T16:00:00Z"); assert.equal(taskPeriod("COMMUNITY_INTERACTION", now), "2026-11-01"); assert.equal(taskPeriod("POST", now), "2026-11"); assert.equal(taskPeriod("PROFILE", now), "LIFETIME");
});
test("customer actions are strict and never accept another user's identity or arbitrary points", () => {
  assert(memberOperationInputSchema.safeParse({ action: "claim_task", taskKey: "PROFILE" }).success);
  for (const value of [{ action: "claim_task", taskKey: "INVITE" }, { action: "claim_task", taskKey: "PROFILE", rewardPoints: 1000 }, { action: "draw", lotteryId: "member-points", requestId: "valid-request", userId: "victim" }, { action: "join_and_grant", points: 1000 }]) assert.equal(memberOperationInputSchema.safeParse(value).success, false);
});
test("student requests take minimal school/year notes and reject IDs or unsafe attachments", () => {
  const request = { action: "submit_application", taskKey: "STUDENT", detail: { school: "测试学校", graduationYear: 2028, note: "请人工核验" } };
  assert(memberOperationInputSchema.safeParse(request).success);
  for (const extra of [{ identityNumber: "123" }, { password: "secret" }, { attachment: "private-unverified-url" }]) assert.equal(memberOperationInputSchema.safeParse({ ...request, detail: { ...request.detail, ...extra } }).success, false);
});
test("draw and posting require valid idempotency keys and bounded content", () => {
  for (const requestId of ["a", "has spaces", "../badkey", "x".repeat(81)]) assert.equal(memberOperationInputSchema.safeParse({ action: "draw", lotteryId: "member-points", requestId }).success, false);
  assert.equal(memberOperationInputSchema.safeParse({ action: "create_post", text: "too short", requestId: "request-key" }).success, false);
  assert(memberOperationInputSchema.safeParse({ action: "create_post", text: "这是一篇用于验证审核流程的真实文本内容，发布前需要人工审核。", requestId: "request-key" }).success);
});
test("share recording needs a real token and cannot request a share-success reward", () => {
  assert(memberOperationInputSchema.safeParse({ action: "visit_share", token: "share_abc123" }).success);
  assert.equal(memberOperationInputSchema.safeParse({ action: "share_success", taskKey: "COMMUNITY_SHARE" }).success, false);
});
test("review requires an explicit decision, nonempty note and known revision", () => {
  assert(memberOperationsAdminInputSchema.safeParse({ action: "review_application", id: "mo_123", decision: "APPROVED", note: "已核验", expectedRevision: 1 }).success);
  for (const patch of [{ expectedRevision: 0 }, { note: "" }, { decision: "AUTO" }, { points: 1000 }]) assert.equal(memberOperationsAdminInputSchema.safeParse({ action: "review_application", id: "mo_123", decision: "APPROVED", note: "已核验", expectedRevision: 1, ...patch }).success, false);
});
test("comments require a genuine parent, bounded text and an idempotency key", () => {
  const input = { action: "create_comment", postId: "mo_parent_123", text: "穿着感受很实用", requestId: "comment-request-123" };
  assert(memberOperationInputSchema.safeParse(input).success);
  for (const patch of [{ text: "短" }, { text: "x".repeat(501) }, { requestId: "tiny" }, { userId: "other-member" }, { rewardPoints: 100 }]) assert.equal(memberOperationInputSchema.safeParse({ ...input, ...patch }).success, false);
});
test("comment approval and removal require independent revisioned staff decisions", () => {
  assert(memberOperationsAdminInputSchema.safeParse({ action: "review_comment", id: "mo_comment_123", decision: "APPROVED", note: "内容已核验", expectedRevision: 1 }).success);
  assert(memberOperationsAdminInputSchema.safeParse({ action: "moderate_comment", id: "mo_comment_123", note: "违反社区规范", expectedRevision: 2 }).success);
  assert.equal(memberOperationsAdminInputSchema.safeParse({ action: "review_comment", id: "mo_comment_123", decision: "APPROVED", note: "", expectedRevision: 1 }).success, false);
});

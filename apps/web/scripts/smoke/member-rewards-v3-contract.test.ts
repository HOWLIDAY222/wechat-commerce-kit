import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultMemberOperationsConfig, lotterySchema, memberOperationsConfigSchema, memberOperationInputSchema, taskDefinitions, taskLimitLabel } from "@/lib/commerce/member-operations";
import { canonicalSocialUrl, needsManualContentReference, selectSocialReward } from "@/lib/commerce/member-social";
import { studentCertification, studentValidityDays } from "@/lib/commerce/member-student";

const proof = "msu_" + "a".repeat(32);
const social = { action: "submit_social_submission", campaignKey: "SOCIAL_INTERACTION", interactionType: "LIKE", platform: "XIAOHONGSHU", postUrl: "https://www.xiaohongshu.com/explore/real", proofKeys: [proof], note: "请核对本人完成的品牌内容互动", requestId: "reward-v3-interaction" };
test("new rules are explicit disabled drafts with requested reward amounts", () => {
  const config = defaultMemberOperationsConfig();
  for (const [key, points] of [["PROFILE", 100], ["PREFERENCES", 100], ["ENTERPRISE", 50], ["STUDENT", 100], ["SOCIAL_FIRST_POST", 5], ["SOCIAL_POST", 20], ["SOCIAL_INTERACTION", 5], ["SOCIAL_REPOST", 5]] as const) assert.deepEqual(config.tasks[key], { enabled: false, rewardPoints: points });
  assert.equal(config.studentBenefits.enabled, false); assert.equal(config.studentBenefits.firstSocialPoints, 1500);
  assert.equal(config.community.enabled, false); assert.equal(studentValidityDays, 180);
});
test("interaction requires its actual behavior and private screenshot, with no caller reward or identity override", () => {
  for (const interactionType of ["LIKE", "COMMENT", "FAVORITE"]) assert(memberOperationInputSchema.safeParse({ ...social, interactionType }).success);
  for (const patch of [{ interactionType: undefined }, { interactionType: "CLICK" }, { proofKeys: [] }, { userId: "other" }, { rewardPoints: 1500 }, { proofKeys: [proof, proof] }]) assert.equal(memberOperationInputSchema.safeParse({ ...social, ...patch }).success, false);
});
test("reposts and posts require evidence without accepting interaction fields or share callbacks", () => {
  for (const campaignKey of ["SOCIAL_POST", "SOCIAL_REPOST"]) {
    assert(memberOperationInputSchema.safeParse({ ...social, campaignKey, interactionType: undefined }).success);
    assert.equal(memberOperationInputSchema.safeParse({ ...social, campaignKey, interactionType: undefined, proofKeys: [] }).success, false);
    assert.equal(memberOperationInputSchema.safeParse({ ...social, campaignKey }).success, false);
  }
});
test("ongoing social rewards have no cumulative task cap", () => {
  for (const key of ["SOCIAL_POST", "SOCIAL_INTERACTION", "SOCIAL_REPOST"] as const) { assert.equal(taskDefinitions[key].limit, null); assert.match(taskLimitLabel(key), /次数不限/); }
  assert.equal(selectSocialReward({ firstEnabled: true, postEnabled: true, approvedBefore: true, firstClaims: 1, monthlyClaims: 100000 }), "SOCIAL_POST");
});
test("legacy merchant choices survive newly added task and student defaults", () => {
  const old: Record<string, any> = JSON.parse(JSON.stringify(defaultMemberOperationsConfig()));
  delete old.studentBenefits; delete old.tasks.SOCIAL_INTERACTION; delete old.tasks.SOCIAL_REPOST; old.tasks.PROFILE = { enabled: true, rewardPoints: 137 };
  const result = memberOperationsConfigSchema.parse(old);
  assert.deepEqual(result.tasks.PROFILE, old.tasks.PROFILE); assert.equal(result.tasks.SOCIAL_INTERACTION.enabled, false); assert.equal(result.studentBenefits.enabled, false);
});
test("student rights cannot enable without two distinct configured coupon templates", () => {
  const config = defaultMemberOperationsConfig(); config.studentBenefits.enabled = true;
  assert.equal(memberOperationsConfigSchema.safeParse(config).success, false);
  config.studentBenefits.couponTemplateIds = ["coupon_100", "coupon_400"]; assert(memberOperationsConfigSchema.safeParse(config).success);
  config.studentBenefits.couponTemplateIds = ["duplicate", "duplicate"]; assert.equal(memberOperationsConfigSchema.safeParse(config).success, false);
});
test("certification expires at the exact 180 day boundary and preserves its immutable cycle", () => {
  const approved = new Date("2026-01-01T00:00:00.000Z"), expires = new Date(approved.getTime() + 180 * 86400000);
  const verified = { cycleId: "wechat_cycle_1", verificationProvider: "WECHAT", proofVersion: "wechat-student-v1", bindStatus: 3, isStudent: true, testIdentity: false, identityHash: "a".repeat(64) };
  assert.equal(studentCertification(verified, approved, new Date(expires.getTime() - 1)).valid, true);
  assert.equal(studentCertification(verified, approved, expires).valid, false);
  assert.equal(studentCertification(verified, approved).cycleId, verified.cycleId);
  assert.equal(studentCertification({ approvedAt: "invalid" }, approved).valid, false);
});
test("lottery defaults cost 20 and each integer between 1 and 100 is eligible", () => {
  const lottery = defaultMemberOperationsConfig().lotteries[0]; assert.equal(lottery.costPoints, 20); assert.equal(lottery.distribution, "UNIFORM_POINTS"); assert.equal(lottery.minimumPoints, 1); assert.equal(lottery.maximumPoints, 100); assert(lotterySchema.safeParse(lottery).success);
  for (const patch of [{ minimumPoints: 0 }, { maximumPoints: 101 }, { minimumPoints: 80, maximumPoints: 70 }]) assert.equal(lotterySchema.safeParse({ ...lottery, ...patch }).success, false);
});
test("stable content identifiers ignore all query strings and route or host aliases", () => {
  assert.equal(canonicalSocialUrl("https://www.xiaohongshu.com/explore/abcdef?review_copy=2#image"), canonicalSocialUrl("https://xiaohongshu.com/discovery/item/abcdef"));
  assert.equal(canonicalSocialUrl("https://www.douyin.com/note/123456?copy=2"), canonicalSocialUrl("https://douyin.com/video/123456#note"));
  assert.equal(needsManualContentReference("https://www.xiaohongshu.com/explore/abcdef?new=1"), false);
});
test("shortlinks and absent or unsupported content identities require reviewer verification", () => {
  for (const value of ["", "https://xhslink.cn/a/first", "https://v.douyin.com/second/", "https://other.example/post/123"]) assert.equal(needsManualContentReference(value), true);
});

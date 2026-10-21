import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultMemberOperationsConfig, memberOperationsConfigSchema, memberOperationInputSchema, taskPeriod } from "@/lib/commerce/member-operations";
import { canonicalSocialUrl, selectSocialReward } from "@/lib/commerce/member-social";
const proof = "msu_" + "a".repeat(32);
const base = { action: "submit_social_submission", campaignKey: "SOCIAL_POST", platform: "XIAOHONGSHU", postUrl: "https://www.xiaohongshu.com/explore/example", note: "真实分享体验，待人工核验。", proofKeys: [proof], requestId: "request-social-1" };
test("new social tasks remain independent disabled drafts and default brand card is available", () => {
  const config = defaultMemberOperationsConfig();
  for (const [key, points] of [["XIAOHONGSHU_FOLLOW", 50], ["SOCIAL_FIRST_POST", 5], ["SOCIAL_POST", 20], ["SOCIAL_INTERACTION", 5], ["SOCIAL_REPOST", 5]] as const) assert.deepEqual(config.tasks[key], { enabled: false, rewardPoints: points });
  assert.equal(config.social.enabled, false); assert.equal(config.xiaohongshuAccount.enabled, false); assert.equal(config.xiaohongshuAccount.accountId, "demo-account");
  assert.equal(taskPeriod("SOCIAL_POST", new Date("2026-10-31T16:00:00Z")), "LIFETIME");
});
test("old saved merchant switches and rewards survive migration defaults without enabling new awards", () => {
  const config = defaultMemberOperationsConfig(); config.tasks.PROFILE = { enabled: true, rewardPoints: 135 }; config.enterpriseContact = { enabled: true, name: "已配置顾问", qrImageUrl: "/uploads/retained.png" };
  const old = JSON.parse(JSON.stringify(config)); delete old.xiaohongshuAccount; delete old.social; for (const key of ["XIAOHONGSHU_FOLLOW", "SOCIAL_FIRST_POST", "SOCIAL_POST"]) delete old.tasks[key];
  const result = memberOperationsConfigSchema.parse(old);
  assert.deepEqual(result.tasks.PROFILE, config.tasks.PROFILE); assert.deepEqual(result.enterpriseContact, config.enterpriseContact); assert.equal(result.tasks.SOCIAL_FIRST_POST.enabled, false);
  assert.equal(memberOperationsConfigSchema.safeParse({ ...old, social: null }).success, false); assert.equal(memberOperationsConfigSchema.safeParse({ ...old, xiaohongshuAccount: null }).success, false);
});
test("social submissions need actual evidence and never accept another account or caller-defined rewards", () => {
  assert(memberOperationInputSchema.safeParse(base).success);
  for (const patch of [{ userId: "victim" }, { rewardPoints: 10000 }, { applicationType: "POST" }, { proofKeys: [proof, proof] }, { postUrl: "", proofKeys: [] }, { requestId: "bad" }, { expectedRevision: -1 }]) assert.equal(memberOperationInputSchema.safeParse({ ...base, ...patch }).success, false);
});
test("Moments and follow proof require private uploaded screenshot IDs, not a share callback or foreign URL", () => {
  assert(memberOperationInputSchema.safeParse({ ...base, platform: "WECHAT_MOMENTS", postUrl: "", proofKeys: [proof] }).success);
  assert(memberOperationInputSchema.safeParse({ ...base, campaignKey: "XIAOHONGSHU_FOLLOW", proofKeys: [proof] }).success);
  for (const patch of [{ platform: "WECHAT_MOMENTS", proofKeys: [] }, { campaignKey: "XIAOHONGSHU_FOLLOW", proofKeys: [] }, { campaignKey: "XIAOHONGSHU_FOLLOW", platform: "DOUYIN", postUrl: "", proofKeys: [proof] }, { proofKeys: ["https://external.invalid/proof.jpg"] }]) assert.equal(memberOperationInputSchema.safeParse({ ...base, ...patch }).success, false);
});
test("social links are HTTPS on the selected platform and cannot inject executable URLs", () => {
  for (const postUrl of ["javascript:alert(1)", "http://www.xiaohongshu.com/explore/a", "https://evil.invalid/content", "https://name:secret@www.xiaohongshu.com/explore/a", "https://www.xiaohongshu.com.evil.invalid/a", "https://127.0.0.1/a"]) assert.equal(memberOperationInputSchema.safeParse({ ...base, postUrl }).success, false);
  assert(memberOperationInputSchema.safeParse({ ...base, platform: "DOUYIN", postUrl: "https://v.douyin.com/example/" }).success);
});
test("tracking parameters cannot make an already submitted content link look new", () => {
  assert.equal(canonicalSocialUrl("https://www.xiaohongshu.com/explore/abc?utm_source=test&xsec_token=secret#here"), canonicalSocialUrl("https://www.xiaohongshu.com/explore/abc"));
});
test("independent first-only and ongoing-only switches always select a reviewable eligible reward", () => {
  assert.equal(selectSocialReward({ firstEnabled: false, postEnabled: true, approvedBefore: false, firstClaims: 0, monthlyClaims: 0 }), "SOCIAL_POST");
  assert.equal(selectSocialReward({ firstEnabled: true, postEnabled: false, approvedBefore: false, firstClaims: 0, monthlyClaims: 0 }), "SOCIAL_FIRST_POST");
  assert.equal(selectSocialReward({ firstEnabled: true, postEnabled: false, approvedBefore: true, firstClaims: 1, monthlyClaims: 0 }), null);
  assert.equal(selectSocialReward({ firstEnabled: false, postEnabled: true, approvedBefore: true, firstClaims: 0, monthlyClaims: 500 }), "SOCIAL_POST");
});

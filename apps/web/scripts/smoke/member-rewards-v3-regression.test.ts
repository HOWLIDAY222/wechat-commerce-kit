import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import type { MemberOperationInput } from "@/lib/commerce/member-operations";
import type { Prisma } from "@prisma/client";

async function main() {
  const database = new URL(process.env.DATABASE_URL || "");
  assert.equal(database.pathname, "/vk_member_rewards_v3_smoke_20261018");
  assert(["127.0.0.1", "localhost"].includes(database.hostname)); assert.equal(process.env.COMMERCE_STORAGE, "prisma");
  assert(resolve(process.env.UPLOAD_DIR || "").replaceAll("\\", "/").includes("/community-fixtures/qa-uploads/"));
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw Error("No external network is allowed in member rewards QA"); };
  const { prisma } = await import("@/lib/db/prisma");
  const { defaultMemberOperationsConfig } = await import("@/lib/commerce/member-operations");
  const { verifyWeChatStudent, performMemberOperation: perform, reviewMemberOperation: review, getMemberOperations: overview, saveMemberOperationsConfig: configure } = await import("@/lib/services/member-operations-service");
  const { uploadSocialProof: upload, readSocialProof: readProof } = await import("@/lib/services/member-social-proof-service");
  const { mergeMembership } = await import("@/lib/services/membership-service");
  const { memberRewardPhoneIdentity } = await import("@/lib/services/member-automation-rewards-service");
  const { defaultMemberRewardPolicy, MEMBER_REWARD_POLICY_KEY } = await import("@/lib/commerce/member-reward-policy");
  const {studentConsentVersion,studentTestIdentitiesKey}=await import("@/lib/commerce/member-student");
  const appId=process.env.WECHAT_MINIPROGRAM_APP_ID!;assert(appId);
  const originalPolicy = await prisma.siteSetting.findUnique({ where: { key: MEMBER_REWARD_POLICY_KEY } });
  const suffix = randomUUID(), users: string[] = [], coupons: string[] = []; let sequence = 0, revision = 0;
  const config = defaultMemberOperationsConfig();
  assert.equal((await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM member_operation_settings WHERE id='member-operations'`).length, 0, "Fresh isolated operations settings required");
  async function user(role: "CUSTOMER" | "ADMIN" = "CUSTOMER") {
    const value = await prisma.user.create({ data: { name: "rewards-v3-" + suffix, role, phone: "138" + String(++sequence).padStart(8, "0"), ...(role === "CUSTOMER" ? { membership: { create: { pointsBalance: 5000 } } } : {}) } }); users.push(value.id);if(role==="CUSTOMER")await prisma.weChatIdentity.create({data:{userId:value.id,appId,openId:"wechat-"+value.id}});return value.id;
  }
  const verify=(userId:string)=>verifyWeChatStudent(userId,{code:"isolated-code-"+randomUUID(),requestId:"isolated-"+randomUUID(),consentVersion:studentConsentVersion},async()=>({bindStatus:3 as const,isStudent:true}));
  const certificate=async(userId:string)=>(await prisma.$queryRaw<Array<{id:string;revision:number;payload:Record<string,any>}>>`SELECT id,revision,payload FROM member_operation_records WHERE user_id=${userId} AND payload->>'proofVersion'='wechat-student-v1' ORDER BY created_at DESC LIMIT 1`)[0];
  const balance = async (userId: string) => (await prisma.memberProfile.findUniqueOrThrow({ where: { userId } })).pointsBalance;
  const run = (userId: string, input: object) => perform(userId, input as MemberOperationInput) as Promise<any>;
  async function proof(userId: string, purpose: "SOCIAL" | "STUDENT" | "ENTERPRISE" = "SOCIAL", requestId?: string) {
    await prisma.auditLog.updateMany({ where: { actorId: userId, action: "member.social.proof.uploaded" }, data: { createdAt: new Date(Date.now() - 120000) } });
    const seed = ++sequence;
    const bytes = await sharp({ create: { width: 120, height: 100, channels: 3, background: { r: seed % 250, g: seed * 11 % 250, b: seed * 3 % 250 } } }).png().toBuffer();
    return (await upload(userId, requestId || "v3-proof-" + seed, new File([new Uint8Array(bytes)], "proof.png", { type: "image/png" }), purpose)).id;
  }
  async function submit(userId: string, campaignKey = "SOCIAL_POST", extra: object = {}) {
    await prisma.auditLog.updateMany({ where: { actorId: userId, action: "member.social.submission.created" }, data: { createdAt: new Date(Date.now() - 120000) } });
    const key = "v3-post-" + ++sequence;
    return run(userId, { action: "submit_social_submission", campaignKey, platform: "XIAOHONGSHU", postUrl: "https://www.xiaohongshu.com/explore/" + key, note: "核验真实品牌内容及本人完成行为", proofKeys: [await proof(userId)], requestId: key, ...extra });
  }
  const approve = (adminId: string, item: { id: string; revision: number }, verifiedContentKey?: string) => review(adminId, { action: "review_application", id: item.id, decision: "APPROVED", note: "隔离环境核对本人截图及实际任务", expectedRevision: item.revision, ...(verifiedContentKey ? { verifiedContentKey } : {}) });
  const protectedTables = ["orders", "order_items", "payment_intents", "shipments", "refunds", "products", "product_skus"];
  async function protectedState() { const result: Record<string, string | null> = {}; for (const table of protectedTables) { assert(/^[a-z_]+$/.test(table)); result[table] = (await prisma.$queryRawUnsafe<Array<{ hash: string | null }>>(`SELECT md5(string_agg(row_to_json(t)::text, ',' ORDER BY row_to_json(t)::text)) AS hash FROM ${table} t`))[0].hash; } return result; }
  try {
    await prisma.siteSetting.create({data:{key:studentTestIdentitiesKey,value:{identityHashes:[]}}});
    const admin = await user("ADMIN"), ordinary = await user(), student = await user(), other = await user();
    const before = await protectedState();
    for (const [amountCents, minimumCents] of [[10000, 60000], [40000, 220000]]) {
      const coupon = await prisma.couponTemplate.create({ data: { title: "学生周期隔离券-" + suffix, amountCents, minimumCents, deliveryMode: "REWARD", active: true, totalLimit: 1000, startsAt: new Date(Date.now() - 10000), endsAt: new Date(Date.now() + 400 * 86400000) } }); coupons.push(coupon.id);
    }
    config.studentBenefits = { enabled: true, couponTemplateIds: coupons, firstSocialPoints: 1500 }; config.social.enabled = true; config.enterpriseContact.enabled = true;
    for (const key of ["STUDENT", "ENTERPRISE", "INVITE", "SOCIAL_INTERACTION", "SOCIAL_REPOST", "SOCIAL_FIRST_POST", "SOCIAL_POST"] as const) config.tasks[key].enabled = true;
    config.lotteries[0].enabled = true; config.lotteries[0].maxDraws = 100;
    revision = (await configure(admin, config, revision)).revision;
    await test("submitted screenshots do not award before review; interaction and repost each award five once", async () => {
      const interaction = await submit(ordinary, "SOCIAL_INTERACTION", { interactionType: "LIKE" }); assert.equal(await balance(ordinary), 5000);
      assert.equal((await approve(admin, interaction.submission)).rewardPoints, 5); assert.equal(await balance(ordinary), 5005);
      await assert.rejects(approve(admin, interaction.submission), /REVISION_CONFLICT/);
      const repost = await submit(ordinary, "SOCIAL_REPOST"); assert.equal((await approve(admin, repost.submission)).rewardPoints, 5); assert.equal(await balance(ordinary), 5010);
    });
    await test("canonical content and exact evidence cannot earn twice, while different real actions stay distinct", async () => {
      const url = "https://www.xiaohongshu.com/explore/dedup-v3", material = await proof(ordinary);
      const first = await submit(ordinary, "SOCIAL_INTERACTION", { interactionType: "LIKE", postUrl: url, proofKeys: [material] }); await approve(admin, first.submission);
      await assert.rejects(submit(ordinary, "SOCIAL_INTERACTION", { interactionType: "LIKE", postUrl: url + "?review_copy=2" }), /DUPLICATE_CONTENT/);
      await assert.rejects(submit(ordinary, "SOCIAL_INTERACTION", { interactionType: "LIKE", postUrl: "https://xiaohongshu.com/discovery/item/dedup-v3" }), /DUPLICATE_CONTENT/);
      await assert.rejects(submit(ordinary, "SOCIAL_REPOST", { proofKeys: [material] }), /PROOF_NOT_FOUND|DUPLICATE_CONTENT/);
      const comment = await submit(ordinary, "SOCIAL_INTERACTION", { interactionType: "COMMENT", postUrl: url }); assert.equal((await approve(admin, comment.submission)).rewardPoints, 5);
    });
    await test("first post awards five, subsequent posts keep awarding twenty after five approved posts", async () => {
      const first = await submit(other); assert.equal((await approve(admin, first.submission)).rewardPoints, 5);
      for (let index = 0; index < 7; index++) {
        await prisma.$executeRaw`UPDATE audit_logs SET created_at=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')-INTERVAL '2 minutes' WHERE actor_id=${other} AND action='member.social.submission.created'`;
        const next = await submit(other); assert.equal((await approve(admin, next.submission)).rewardPoints, 20);
      }
      assert.equal(await balance(other), 5145);
    });
    await test("URL-free evidence needs a reviewed normalized content reference and cannot reward it twice", async () => {
      await prisma.$executeRaw`UPDATE audit_logs SET created_at=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')-INTERVAL '2 minutes' WHERE actor_id=${ordinary} AND action='member.social.submission.created'`;
      const first = await submit(ordinary, "SOCIAL_REPOST", { platform: "WECHAT_MOMENTS", postUrl: "" });
      await assert.rejects(approve(admin, first.submission), /CONTENT_REFERENCE_REQUIRED/);
      const before = await balance(ordinary); assert.equal((await approve(admin, first.submission, "  2026-10-18   12:30 ")).rewardPoints, 5);
      const duplicate = await submit(ordinary, "SOCIAL_REPOST", { platform: "WECHAT_MOMENTS", postUrl: "" });
      await assert.rejects(approve(admin, duplicate.submission, "2026-10-18 12:30"), /DUPLICATE_CONTENT/); assert.equal(await balance(ordinary), before + 5);
      const short = await submit(ordinary, "SOCIAL_REPOST", { postUrl: "https://xhslink.cn/a/first" });
      await assert.rejects(approve(admin, short.submission), /CONTENT_REFERENCE_REQUIRED/);
      assert.equal((await approve(admin, short.submission, "2026-10-18 15:00")).rewardPoints, 5);
      const anotherShort = await submit(ordinary, "SOCIAL_REPOST", { postUrl: "https://xhslink.cn/a/second" });
      await assert.rejects(approve(admin, anotherShort.submission, "2026-10-18 15:00"), /DUPLICATE_CONTENT/);
      assert.equal(await balance(ordinary), before + 10);
    });
    let certification: { id: string; revision: number };
    await test("only WeChat verification grants student points and two expiring coupons, with parallel retries issuing once",async()=>{
 const socialProof=await proof(student);
 await assert.rejects(run(student,{action:"submit_application",taskKey:"STUDENT",detail:{school:"隔离大学",graduationYear:2028,note:"截图不能替代微信认证",proofKeys:[socialProof]}}),/MEMBER_STUDENT_VERIFICATION_UNAVAILABLE/);
 await assert.rejects(proof(student,"STUDENT"),/MEMBER_STUDENT_VERIFICATION_UNAVAILABLE/);
 const results=await Promise.all([verify(student),verify(student)]);assert.equal(results.reduce((n,r)=>n+r.rewardPoints,0),100);assert.equal(results.reduce((n,r)=>n+r.couponsIssued,0),2);
 certification=await certificate(student);assert.equal(await balance(student),5100);
 const view=await overview(student);assert.equal(view.student.valid,true);assert.equal(view.student.coupons.length,2);assert.equal(view.student.firstSocialAwarded,false);
 const claims=await prisma.couponClaim.findMany({where:{userId:student,source:"STUDENT"}});assert.equal(claims.length,2);for(const claim of claims)assert.equal(claim.expiresAt?.toISOString(),view.student.certification?.validUntil);
});
    await test("valid students first new social post totals fifteen hundred once per cycle", async () => {
      const first = await submit(student); assert.equal((await approve(admin, first.submission)).rewardPoints, 1500); assert.equal(await balance(student), 6600);
      assert.equal((await overview(student)).student.firstSocialAwarded, true);
      const second = await submit(student); assert.equal((await approve(admin, second.submission)).rewardPoints, 20); assert.equal(await balance(student), 6620);
    });
    await test("expired WeChat certification renews into an immutable new cycle without repeating first-only points",async()=>{
 const expiredAt=new Date(Date.now()-1000),approvedAt=new Date(expiredAt.getTime()-180*86400000),oldId=certification.id;
 await prisma.$executeRaw`UPDATE member_operation_records SET payload=payload || ${JSON.stringify({validUntil:expiredAt.toISOString(),approvedAt:approvedAt.toISOString()})}::jsonb WHERE id=${oldId}`;
 const history=(await prisma.$queryRaw<Array<{payload:unknown}>>`SELECT payload FROM member_operation_records WHERE id=${oldId}`)[0].payload;
 assert.equal((await overview(student)).student.valid,false);
 const renewed=await verify(student);assert.equal(renewed.rewardPoints,0);assert.equal(renewed.couponsIssued,2);assert.equal(await balance(student),6620);
 certification=await certificate(student);assert.notEqual(certification.id,oldId);assert.equal(await prisma.couponClaim.count({where:{userId:student,source:"STUDENT"}}),4);
 assert.deepEqual((await prisma.$queryRaw<Array<{payload:unknown}>>`SELECT payload FROM member_operation_records WHERE id=${oldId}`)[0].payload,history);
 const post=await submit(student);assert.equal((await approve(admin,post.submission)).rewardPoints,1500);assert.equal(await balance(student),8120);
});
    await test("enterprise application retains actual review before one fifty-point award", async () => {
      await assert.rejects(run(ordinary, { action: "submit_application", taskKey: "ENTERPRISE", detail: { note: "实际添加品牌顾问后核验" } }), /INVALID_MEMBER_OPERATION/);
      const wrongPurpose = await proof(ordinary);
      await assert.rejects(run(ordinary, { action: "submit_application", taskKey: "ENTERPRISE", detail: { note: "必须使用企微私有截图", proofKeys: [wrongPurpose] } }), /PROOF_NOT_FOUND/);
      const ownProof = await proof(ordinary, "ENTERPRISE"); await assert.rejects(readProof(other, ownProof), /PROOF_NOT_FOUND/); assert(await readProof(admin, ownProof));
      const application = await run(ordinary, { action: "submit_application", taskKey: "ENTERPRISE", detail: { note: "实际添加品牌顾问后核验", proofKeys: [ownProof] } }); const before = await balance(ordinary);
      assert.equal((await approve(admin, application.application)).rewardPoints, 50); assert.equal(await balance(ordinary), before + 50);
      await assert.rejects(approve(admin, application.application), /REVISION_CONFLICT/);
    });
    await test("merged private evidence remains readable and WeChat renewal preserves first-only certification points",async()=>{
 const merged=await user(),requestId="v3-merge-shared-proof";
 const sourceProof=await proof(student,"ENTERPRISE",requestId),targetProof=await proof(merged,"ENTERPRISE",requestId);const before=await balance(student)+await balance(merged);
 await prisma.$transaction(tx=>mergeMembership(tx,student,merged),{isolationLevel:"Serializable"});assert.equal(await balance(merged),before);assert(await readProof(merged,sourceProof));assert(await readProof(merged,targetProof));await assert.rejects(readProof(student,sourceProof),/PROOF_NOT_FOUND/);
 const migrated=await prisma.$queryRaw<Array<{requestId:string}>>`SELECT request_id AS "requestId" FROM member_social_uploads WHERE user_id=${merged} AND id=ANY(${[sourceProof,targetProof]}::text[])`;assert.equal(new Set(migrated.map(x=>x.requestId)).size,2);
 await prisma.$executeRaw`UPDATE member_operation_records SET payload=payload || ${JSON.stringify({validUntil:new Date(Date.now()-1000).toISOString()})}::jsonb WHERE id=${certification.id}`;
 const renewed=await verify(merged);assert.equal(renewed.rewardPoints,0);assert.equal(renewed.couponsIssued,2);assert.equal(await balance(merged),before);assert.equal(await prisma.couponClaim.count({where:{userId:merged,source:"STUDENT"}}),6);
});
    await test("uniform lottery publishes correct probabilities, charges twenty and replays without another draw", async () => {
      const lottery = (await overview(ordinary)).lotteries[0]; assert.equal(lottery.costPoints, 20); assert.equal(lottery.prizes.length, 100); assert(lottery.prizes.every(prize => prize.probability === .01));
      const input = { action: "draw", lotteryId: lottery.id, requestId: "v3-uniform-request" }, before = await balance(ordinary);
      const first = await run(ordinary, input), repeat = await run(ordinary, input); assert.deepEqual(repeat.draw, first.draw); assert.equal(repeat.replayed, true);
      assert(first.draw.points >= 1 && first.draw.points <= 100); assert.equal(await balance(ordinary), before - 20 + first.draw.points);
    });
    await test("an old WeChat account newly joining can bind, while old or pre-activation membership cannot", async () => {
      const policy = defaultMemberRewardPolicy(); policy.referral.enabled = true; policy.referral.activatedAt = new Date(Date.now() - 3600000).toISOString();
      await prisma.siteSetting.upsert({ where: { key: MEMBER_REWARD_POLICY_KEY }, create: { key: MEMBER_REWARD_POLICY_KEY, value: policy as Prisma.InputJsonObject }, update: { value: policy as Prisma.InputJsonObject } });
      const fresh = await user(), old = await user(), preActivation = await user();
      await prisma.user.update({ where: { id: fresh }, data: { createdAt: new Date(Date.now() - 400 * 86400000) } });
      await prisma.memberProfile.update({ where: { userId: old }, data: { joinedAt: new Date(Date.now() - 25 * 3600000) } });
      await prisma.memberProfile.update({ where: { userId: preActivation }, data: { joinedAt: new Date(Date.now() - 2 * 3600000) } });
      const code = (await run(ordinary, { action: "create_referral" })).code;
      const beforeFresh = await balance(fresh), beforeInviter = await balance(ordinary);
      assert.equal((await run(fresh, { action: "bind_referral", code })).bound, true);
      assert.equal(await balance(fresh), beforeFresh); assert.equal(await balance(ordinary), beforeInviter);
      await assert.rejects(run(old, { action: "bind_referral", code }), /NEW_MEMBER_REQUIRED/);
      await assert.rejects(run(preActivation, { action: "bind_referral", code }), /NEW_MEMBER_REQUIRED/);
      await assert.rejects(run(ordinary, { action: "bind_referral", code }), /INVALID_REFERRAL/);
    });
    await test("enabled referral policy rejects a conflicting displayed reward without changing saved settings", async () => {
      const invalid = structuredClone(config); invalid.tasks.INVITE.rewardPoints = 999;
      await assert.rejects(configure(admin, invalid, revision), /INVALID_MEMBER_OPERATION/);
      const stored = await prisma.$queryRaw<Array<{ revision: number; points: number }>>`SELECT revision,(config->'tasks'->'INVITE'->>'rewardPoints')::int AS points FROM member_operation_settings WHERE id='member-operations'`;
      assert.equal(stored[0].revision, revision); assert.equal(stored[0].points, 100);
      revision = (await configure(admin, config, revision)).revision;
    });
    await test("orders and fulfillment state are unchanged", async () => { assert.deepEqual(await protectedState(), before); });
  } finally {
    await prisma.$executeRaw`DELETE FROM member_social_uploads WHERE user_id=ANY(${users}::text[])`;
    await prisma.$executeRaw`DELETE FROM member_operation_records WHERE user_id=ANY(${users}::text[])`;
    await prisma.$executeRaw`DELETE FROM member_operation_settings WHERE id='member-operations'`;
    if (originalPolicy) await prisma.siteSetting.upsert({ where: { key: MEMBER_REWARD_POLICY_KEY }, create: { key: MEMBER_REWARD_POLICY_KEY, value: originalPolicy.value as any }, update: { value: originalPolicy.value as any } });
    else await prisma.siteSetting.deleteMany({ where: { key: MEMBER_REWARD_POLICY_KEY } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: users } } });
    const accounts = await prisma.user.findMany({ where: { id: { in: users } }, select: { phone: true } });
    const identities = accounts.filter(account => account.phone).map(account => memberRewardPhoneIdentity(account.phone!));
    if (identities.length) await prisma.$executeRaw`DELETE FROM member_reward_identity_aliases WHERE identity=ANY(${identities}::text[]) OR canonical_identity=ANY(${identities}::text[])`;
    await prisma.pointEntry.deleteMany({ where: { userId: { in: users } } });
    await prisma.couponClaim.deleteMany({ where: { userId: { in: users } } });
    await prisma.siteSetting.deleteMany({where:{key:studentTestIdentitiesKey}});
    await prisma.weChatIdentity.deleteMany({where:{userId:{in:users}}});
    await prisma.memberProfile.deleteMany({ where: { userId: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
    await prisma.couponTemplate.deleteMany({ where: { id: { in: coupons } } });
    globalThis.fetch = originalFetch; await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

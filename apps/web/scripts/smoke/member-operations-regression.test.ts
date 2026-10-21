import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { MemberOperationInput } from "@/lib/commerce/member-operations";

async function main() {
  const database = new URL(process.env.DATABASE_URL || "");
  assert.equal(database.pathname, "/vk_member_subscriptions_smoke_20261018", "Only the disposable member QA database is allowed");
  assert(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(process.env.COMMERCE_STORAGE, "prisma");
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw Error("No member QA gateways are permitted"); };
  const { prisma } = await import("@/lib/db/prisma");
  const { defaultMemberOperationsConfig } = await import("@/lib/commerce/member-operations");
  const { getMemberOperations: overview, performMemberOperation, getAdminMemberOperations: adminGet, saveMemberOperationsConfig: configure, reviewMemberOperation: review } = await import("@/lib/services/member-operations-service");
  const { GET, POST } = await import("@/app/api/miniprogram/member-operations/route");
  const { createSessionToken, hashToken } = await import("@/lib/auth/session");
  const ids: string[] = [], orderIds: string[] = [], suffix = randomUUID(); let hidden = false;
  const originalSetting = await prisma.$queryRaw<Array<{ revision: number; config: unknown; updatedBy: string; createdAt: Date; updatedAt: Date }>>`SELECT revision, config, updated_by AS "updatedBy", created_at AS "createdAt", updated_at AS "updatedAt" FROM member_operation_settings WHERE id = 'member-operations'`;
  let config = defaultMemberOperationsConfig(), revision = 0;
  const recordList = (kind: string, userId: string) => prisma.$queryRaw<Array<{ id: string; state: string; revision: number; payload: Record<string, unknown>; points: number }>>`SELECT id, state, revision, payload, points FROM member_operation_records WHERE kind = ${kind} AND user_id = ${userId} ORDER BY created_at ASC`;
  const run = (userId: string, input: Record<string, unknown>) => performMemberOperation(userId, input as MemberOperationInput);
  async function user(role: "CUSTOMER" | "ADMIN" | "OWNER" = "CUSTOMER", bound = true, member = true) {
    const phone = bound ? "139" + String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0") : null;
    const result = await prisma.user.create({ data: { name: "member-ops-qa-" + suffix, role, phone, ...(member ? { membership: { create: { pointsBalance: 1000 } } } : {}) } });
    ids.push(result.id); return result;
  }
  async function balance(userId: string) { return (await prisma.memberProfile.findUniqueOrThrow({ where: { userId } })).pointsBalance; }
  async function snapshot() {
    const tables = ["users", "orders", "order_items", "payment_intents", "shipments", "refunds", "products", "product_skus", "customer_profiles", "privacy_consents"];
    const result: Record<string, string | null> = {};
    for (const table of tables) { assert(/^[a-z_]+$/.test(table)); const rows = await prisma.$queryRawUnsafe<Array<{ hash: string | null }>>(`SELECT md5(string_agg(row_to_json(t)::text, ',' ORDER BY row_to_json(t)::text)) AS hash FROM ${table} t`); result[table] = rows[0].hash; }
    return result;
  }
  async function token(userId: string) { const bearer = createSessionToken(); await prisma.session.create({ data: { userId, tokenHash: hashToken(bearer), expiresAt: new Date(Date.now() + 120_000) } }); return bearer; }
  async function save(actorId: string) { const result = await configure(actorId, config, revision); revision = result.revision; return result; }
  try {
    assert.equal(originalSetting.length, 0, "QA requires fresh isolated program settings; never overwrite an existing program");
    const owner = await user("OWNER", true, false), admin = await user("ADMIN", true, false), first = await user(), second = await user(), invitee = await user(), guest = await user("CUSTOMER", false, false), noMember = await user("CUSTOMER", true, false);
    await test("fresh drafts are read-only, show existing points and never create program settings or rewards", async () => {
      const before = await snapshot(), result = await overview(first.id);
      assert.equal(result.pointsBalance, 1000); assert(result.tasks.every(task => !task.enabled && task.state === "DISABLED")); assert.equal(result.community.enabled, false);
      assert.equal((await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM member_operation_settings`)[0].count, BigInt(0));
      assert.equal((await recordList("CLAIM", first.id)).length, 0); assert.deepEqual(await snapshot(), before);
    });
    await test("disabled tasks, surveys, community, invitations and lotteries never deduct or issue points", async () => {
      const before = await snapshot(), initial = await balance(first.id);
      for (const action of [{ action: "claim_task", taskKey: "PROFILE" }, { action: "submit_survey", surveyId: "PREFERENCES", answers: {} }, { action: "create_referral" }, { action: "draw", lotteryId: "member-points", requestId: "disabled-draw" }, { action: "create_post", text: "隔离测试的内容不会发布，当前社区处于关闭状态，请拒绝这次请求。", requestId: "disabled-post" }]) await assert.rejects(run(first.id, action), /MEMBER_OPERATIONS_DISABLED/);
      assert.equal(await balance(first.id), initial); assert.equal((await recordList("DRAW", first.id)).length, 0); assert.equal((await recordList("POST", first.id)).length, 0); assert.deepEqual(await snapshot(), before);
    });
    await test("only current admins edit config and stale revisions preserve all rules", async () => {
      await assert.rejects(configure(first.id, config, 0), /ADMIN_REQUIRED/);
      const result = await save(owner.id); assert.equal(result.revision, 1);
      await assert.rejects(configure(admin.id, { ...config, community: { enabled: true } }, 0), /MEMBER_OPERATIONS_REVISION_CONFLICT/);
      assert.equal((await adminGet(owner.id)).config.community.enabled, false);
    });
    await test("profile completion is server-verified and concurrent claims produce one existing-ledger award", async () => {
      config.tasks.PROFILE.enabled = true; await save(owner.id);
      await assert.rejects(run(first.id, { action: "claim_task", taskKey: "PROFILE" }), /MEMBER_OPERATIONS_PROFILE_INCOMPLETE/);
      // The compact form only collects name, gender and birthday. Hidden legacy
      // surname/given-name/region fields must not prevent this reward.
      await prisma.$executeRaw`INSERT INTO member_account_profiles (user_id,surname,given_name,display_name,gender,region,birthday,registered_at) VALUES (${first.id}, '', '', '隔离会员', 'UNSPECIFIED', '[]'::jsonb, DATE '2000-02-29', CURRENT_TIMESTAMP)`;
      const before = await snapshot(), initial = await balance(first.id);
      await Promise.all([run(first.id, { action: "claim_task", taskKey: "PROFILE" }), run(first.id, { action: "claim_task", taskKey: "PROFILE" })]);
      assert.equal(await balance(first.id), initial + 100); assert.equal((await recordList("CLAIM", first.id)).length, 1);
      assert.equal(await prisma.pointEntry.count({ where: { userId: first.id, eventKey: { startsWith: "member-operation:" } } }), 1); assert.deepEqual(await snapshot(), before);
    });
    await test("questionnaires validate actual required choices, issue once and never reward replay", async () => {
      config.tasks.PREFERENCES.enabled = true; config.surveys[0].enabled = true; await save(admin.id);
      const initial = await balance(first.id), before = await snapshot();
      await assert.rejects(run(first.id, { action: "submit_survey", surveyId: "PREFERENCES", answers: { fit: "虚构选项", focus: ["透气"] } }), /INVALID_MEMBER_OPERATION/);
      const payload = { action: "submit_survey", surveyId: "PREFERENCES", answers: { fit: "适中", focus: ["透气", "柔软"] } };
      await Promise.all([run(first.id, payload), run(first.id, payload)]);
      assert.equal(await balance(first.id), initial + 100); assert.equal((await recordList("SURVEY", first.id)).length, 1); assert.deepEqual(await snapshot(), before);
    });
    await test("legacy manual student submissions are rejected without records or reward mutations",async()=>{
 config.tasks.STUDENT.enabled=true;await save(owner.id);
 const initial=await balance(second.id),before=await snapshot();
 await assert.rejects(run(second.id,{action:"submit_application",taskKey:"STUDENT",detail:{school:"隔离测试学校",graduationYear:2028,note:"人工材料不能认证"}}),/MEMBER_STUDENT_VERIFICATION_UNAVAILABLE/);
 assert.equal((await recordList("APPLICATION",second.id)).length,0);assert.equal(await balance(second.id),initial);assert.deepEqual(await snapshot(),before);
});
    await test("unbound or nonmember accounts cannot silently join, collect points or invoke the existing newcomer benefit", async () => {
      await assert.rejects(run(guest.id, { action: "claim_task", taskKey: "PROFILE" }), /MEMBER_PHONE_REQUIRED/);
      await assert.rejects(run(noMember.id, { action: "claim_task", taskKey: "PROFILE" }), /MEMBERSHIP_REQUIRED/);
      assert.equal(await prisma.memberProfile.count({ where: { userId: { in: [guest.id, noMember.id] } } }), 0); assert.equal(await prisma.pointEntry.count({ where: { userId: { in: [guest.id, noMember.id] } } }), 0);
    });
    await test("enabled draw uses crypto outcome and idempotently deducts once, including concurrent retries", async () => {
      config.lotteries[0] = { ...config.lotteries[0], distribution: "WEIGHTED", costPoints: 20, enabled: true, maxDraws: 1, prizes: [{ id: "none", title: "谢谢参与", kind: "NONE", points: 0, couponTemplateId: null, weight: 1, stock: null }] }; await save(owner.id);
      const initial = await balance(first.id), before = await snapshot(), requestId = "same-request-" + suffix;
      const results = await Promise.all([run(first.id, { action: "draw", lotteryId: "member-points", requestId }), run(first.id, { action: "draw", lotteryId: "member-points", requestId })]); assert.equal(results.length, 2);
      assert.equal(await balance(first.id), initial - 20); assert.equal((await recordList("DRAW", first.id)).length, 1);
      await assert.rejects(run(first.id, { action: "draw", lotteryId: "member-points", requestId: "new-request-" + suffix }), /MEMBER_OPERATIONS_LIMIT_REACHED/); assert.deepEqual(await snapshot(), before);
    });
    await test("finite prize stock cannot be overissued across members, net ledger follows each returned outcome", async () => {
      config.lotteries[0] = { ...config.lotteries[0], distribution: "WEIGHTED", id: "finite-points", enabled: true, maxDraws: 1, prizes: [{ id: "single", title: "20积分", kind: "POINTS", points: 20, couponTemplateId: null, weight: 9999, stock: 1 }, { id: "none", title: "谢谢参与", kind: "NONE", points: 0, couponTemplateId: null, weight: 1, stock: null }] }; await save(owner.id);
      const firstBefore = await balance(first.id), secondBefore = await balance(second.id), before = await snapshot();
      await Promise.all([run(first.id, { action: "draw", lotteryId: "finite-points", requestId: "finite-a-" + suffix }), run(second.id, { action: "draw", lotteryId: "finite-points", requestId: "finite-b-" + suffix })]);
      const draws = [...await recordList("DRAW", first.id), ...await recordList("DRAW", second.id)].filter(record => record.payload.lotteryId === "finite-points"); assert.equal(draws.length, 2);
      assert(draws.filter(record => record.payload.prizeId === "single").length <= 1);
      const a = (await recordList("DRAW", first.id)).find(record => record.payload.lotteryId === "finite-points")!, b = (await recordList("DRAW", second.id)).find(record => record.payload.lotteryId === "finite-points")!;
      assert.equal(await balance(first.id), firstBefore + a.points); assert.equal(await balance(second.id), secondBefore + b.points); assert.deepEqual(await snapshot(), before);
    });
    await test("invitation bindings remain idempotent and manual award approvals are forbidden",async()=>{
 config.tasks.INVITE.enabled=true;await save(owner.id);
 const code=String((await run(first.id,{action:"create_referral"}) as {code:string}).code);
 await assert.rejects(run(first.id,{action:"bind_referral",code}),/MEMBER_OPERATIONS_INVALID_REFERRAL/);
 await run(invitee.id,{action:"bind_referral",code});await run(invitee.id,{action:"bind_referral",code});
 const referrals=await recordList("REFERRAL",invitee.id);assert.equal(referrals.length,1);const initial=await balance(first.id),before=await snapshot();
 await assert.rejects(review(owner.id,{action:"review_referral",id:referrals[0].id,decision:"APPROVED",note:"交给系统自动结算",expectedRevision:1}),/MEMBER_OPERATIONS_REFERRAL_AUTOMATIC/);
 assert.equal(await balance(first.id),initial);assert.deepEqual(await snapshot(),before);
 const adminRecord=(await adminGet(owner.id)).records.find(record=>record.id===referrals[0].id)!;
 assert(Math.abs(Date.parse(adminRecord.createdAt)-Date.now())<10000);
});
    await test("legacy community switches cannot reopen posting after social tasks moved to external platforms",async()=>{
 config.community.enabled=true;config.tasks.FIRST_POST.enabled=true;config.tasks.POST.enabled=true;config.tasks.COMMUNITY_INTERACTION.enabled=true;config.tasks.COMMUNITY_SHARE.enabled=true;await save(owner.id);
 const before=await snapshot(),initial=await balance(first.id);
 await assert.rejects(run(first.id,{action:"create_post",text:"已改为小红书抖音等外部平台真实截图核验。",requestId:"legacy-post-"+suffix}),/MEMBER_OPERATIONS_DISABLED/);
 assert.equal((await recordList("POST",first.id)).length,0);assert.equal(await balance(first.id),initial);assert.deepEqual(await snapshot(),before);
});
    await test("legacy comment and reaction actions cannot create activity or collect points",async()=>{
 const initial=await balance(second.id),before=await snapshot();
 for(const input of [{action:"create_comment",postId:"legacy-fixture",text:"不能通过旧评论接口领奖",requestId:"legacy-comment-"+suffix},{action:"react_post",postId:"legacy-fixture",reaction:"LIKE",active:true}]) await assert.rejects(run(second.id,input),/MEMBER_OPERATIONS_DISABLED/);
 assert.equal(await balance(second.id),initial);assert.equal((await recordList("POST",second.id)).length,0);assert.deepEqual(await snapshot(),before);
});
    await test("repeated retired interactions cannot farm rewards or consume external task eligibility",async()=>{
 const initial=await balance(second.id),before=await snapshot();
 for(let i=0;i<6;i++)await assert.rejects(run(second.id,{action:"create_comment",postId:"legacy-fixture",text:"旧接口不再产生奖励"+i,requestId:"legacy-repeat-"+i+suffix}),/MEMBER_OPERATIONS_DISABLED/);
 assert.equal(await balance(second.id),initial);assert.equal((await recordList("CLAIM",second.id)).length,0);assert.deepEqual(await snapshot(),before);
});
    await test("retired in-app sharing and reporting cannot substitute for external evidence",async()=>{
 const initial=await balance(first.id),before=await snapshot();
 for(const input of [{action:"create_share",postId:"legacy-fixture"},{action:"report_post",postId:"legacy-fixture",reason:"旧站内举报不能创建新记录"}]) await assert.rejects(run(first.id,input),/MEMBER_OPERATIONS_DISABLED/);
 assert.equal(await balance(first.id),initial);assert.equal((await recordList("REPORT",first.id)).length,0);assert.deepEqual(await snapshot(),before);
});
    await test("actual HTTP route rejects caller-supplied owner or points and keeps personal output uncached", async () => {
      const bearer = await token(first.id), headers = { authorization: "Bearer " + bearer, host: "qa.invalid", "Content-Type": "application/json" };
      const result = await GET(new Request("http://qa.invalid", { headers })); assert.equal(result.status, 200); assert.match(result.headers.get("cache-control") || "", /no-store/);
      const forged = await POST(new Request("http://qa.invalid", { method: "POST", headers, body: JSON.stringify({ action: "claim_task", taskKey: "PROFILE", userId: second.id, rewardPoints: 1_000_000 }) })); assert.equal(forged.status, 400);
      const evil = await POST(new Request("http://qa.invalid", { method: "POST", headers: { ...headers, origin: "https://evil.invalid" }, body: JSON.stringify({ action: "claim_task", taskKey: "PROFILE" }) })); assert.equal(evil.status, 403);
      const unauth = await GET(new Request("http://qa.invalid", { headers: { authorization: "Bearer invalid" } })); assert.equal(unauth.status, 401);
    });
    await test("missing program storage fails closed without inventing a successful empty overview", async () => {
      const bearer = await token(first.id); await prisma.$executeRawUnsafe("ALTER TABLE member_operation_records RENAME TO member_operation_records_qa_hidden"); hidden = true;
      try { const result = await GET(new Request("http://qa.invalid", { headers: { authorization: "Bearer " + bearer } })); assert.equal(result.status, 503); assert.equal((await result.json()).error, "MEMBER_OPERATIONS_UNAVAILABLE"); }
      finally { await prisma.$executeRawUnsafe("ALTER TABLE member_operation_records_qa_hidden RENAME TO member_operation_records"); hidden = false; }
    });
  } finally {
    if (hidden) await prisma.$executeRawUnsafe("ALTER TABLE member_operation_records_qa_hidden RENAME TO member_operation_records");
    await prisma.$executeRaw`DELETE FROM member_operation_records WHERE user_id = ANY(${ids}::text[])`;
    await prisma.$executeRaw`DELETE FROM member_account_profiles WHERE user_id = ANY(${ids}::text[])`;
    if (!originalSetting.length) await prisma.$executeRaw`DELETE FROM member_operation_settings WHERE id = 'member-operations'`;
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { targetType: "member", targetId: { in: ids } }] } });
    await prisma.pointEntry.deleteMany({ where: { userId: { in: ids } } }); await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } }); await prisma.order.deleteMany({ where: { id: { in: orderIds } } }); await prisma.memberProfile.deleteMany({ where: { userId: { in: ids } } }); await prisma.user.deleteMany({ where: { id: { in: ids } } });
    globalThis.fetch = originalFetch; await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Member operations QA failed"); process.exitCode = 1; });

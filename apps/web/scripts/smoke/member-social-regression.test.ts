import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, rm, stat } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import type { MemberOperationInput } from "@/lib/commerce/member-operations";

async function main() {
  const database = new URL(process.env.DATABASE_URL || "");
  assert.equal(database.pathname, "/vk_member_subscriptions_smoke_20261018"); assert(["127.0.0.1", "localhost"].includes(database.hostname)); assert.equal(process.env.COMMERCE_STORAGE, "prisma");
  const uploadDir = resolve(process.env.UPLOAD_DIR || ""); assert(uploadDir.replaceAll("\\", "/").includes("/community-fixtures/qa-uploads/"), "Social proof QA must have an isolated upload directory");
  const privateRoot = join(dirname(uploadDir), "private-member-social");
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw Error("No social QA gateway/network calls are allowed"); };
  const { prisma } = await import("@/lib/db/prisma");
  const { defaultMemberOperationsConfig } = await import("@/lib/commerce/member-operations");
  const { getMemberOperations: overview, performMemberOperation: perform, reviewMemberOperation: review, saveMemberOperationsConfig: configure } = await import("@/lib/services/member-operations-service");
  const { uploadSocialProof: upload, readSocialProof: read, deleteSocialProof: remove } = await import("@/lib/services/member-social-proof-service");
  const proofRoute = await import("@/app/api/miniprogram/member-operations/proofs/route");
  const privateRoute = await import("@/app/api/miniprogram/member-operations/proofs/[id]/route");
  const operationsRoute = await import("@/app/api/miniprogram/member-operations/route");
  const { createSessionToken, hashToken } = await import("@/lib/auth/session");
  const ids: string[] = [], suffix = randomUUID(); let revision = 0, config = defaultMemberOperationsConfig();
  const allFiles = async () => readdir(privateRoot).catch(() => [] as string[]);
  const beforeFiles = await allFiles();
  const count = async (kind: string, userId: string) => Number((await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM member_operation_records WHERE kind=${kind} AND user_id=${userId}`)[0].count);
  async function user(role: "CUSTOMER" | "ADMIN" = "CUSTOMER", bound = true, member = true) {
    const value = await prisma.user.create({ data: { name: "social-isolated-" + suffix, role, phone: bound ? "137" + String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0") : null, ...(member ? { membership: { create: { pointsBalance: 500 } } } : {}) } }); ids.push(value.id); return value;
  }
  const balance = async (userId: string) => (await prisma.memberProfile.findUniqueOrThrow({ where: { userId } })).pointsBalance;
  const run = async (userId: string, original: object) => { let input = original as Record<string, any>;
    if(input.action==="submit_social_submission"&&input.campaignKey==="SOCIAL_POST"&&!input.proofKeys?.length){await prisma.auditLog.updateMany({where:{actorId:userId,action:{in:["member.social.proof.uploaded","member.social.submission.created"]}},data:{createdAt:new Date(Date.now()-120000)}});const key=userId+":"+input.requestId;let proofId=postProofs.get(key);if(!proofId){proofId=(await upload(userId,"evidence-"+input.requestId,await image(++proofSerial))).id;postProofs.set(key,proofId);}input={...input,proofKeys:[proofId]};}
    return perform(userId, input as MemberOperationInput) as Promise<{ submission: { id: string; revision: number; status: string; rewardPoints: number; proofs: Array<{ id: string }> }; replayed?: boolean }>; };
  let proofSerial = 100;
  const postProofs=new Map<string,string>();
  const post = (requestId: string, postUrl = "https://www.xiaohongshu.com/explore/" + requestId, proofKeys: string[] = []) => ({ action: "submit_social_submission", campaignKey: "SOCIAL_POST", platform: "XIAOHONGSHU", postUrl, note: "分享实际产品穿着感受，提交工作人员核验。", proofKeys, requestId });
  async function image(seed: number) { return new File([new Uint8Array(await sharp({ create: { width: 800, height: 600, channels: 3, background: { r: seed % 250, g: (seed * 23) % 250, b: 140 } } }).png().withMetadata({ exif: { IFD0: { Copyright: "STRIP PRIVATE METADATA" } } }).toBuffer())], "proof.png", { type: "image/png" }); }
  async function save(adminId: string) { const result = await configure(adminId, config, revision); revision = result.revision; config = result.config; }
  async function bearer(userId: string) { const token = createSessionToken(); await prisma.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 120_000) } }); return token; }
  async function protectedState() {
    const result: Record<string, string | null> = {};
    for (const table of ["users", "customer_profiles", "orders", "order_items", "payment_intents", "shipments", "refunds", "products", "product_skus", "privacy_consents"]) {
      assert(/^[a-z_]+$/.test(table)); result[table] = (await prisma.$queryRawUnsafe<Array<{ hash: string | null }>>(`SELECT md5(string_agg(row_to_json(t)::text, ',' ORDER BY row_to_json(t)::text)) AS hash FROM ${table} t`))[0].hash;
    }
    return result;
  }
  const original = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM member_operation_settings WHERE id='member-operations'`; assert.equal(original.length, 0, "Only fresh isolated settings may be used");
  try {
    const admin = await user("ADMIN", true, false), a = await user(), b = await user(), c = await user(), unbound = await user("CUSTOMER", false), noMember = await user("CUSTOMER", true, false);
    const protectedBefore = await protectedState();
    const legacyId = "social_legacy_" + suffix.replaceAll("-", "");
    await prisma.$executeRaw`INSERT INTO member_operation_records(id,kind,user_id,subject_id,state,payload) VALUES(${legacyId},'POST',${a.id},'legacy-post','APPROVED','{"text":"保留的历史社区内容，不可重置或删除。"}'::jsonb)`;
    await test("default brand profile is visible while all new social awards and submissions remain disabled", async () => {
      const view = await overview(a.id); assert.equal(view.xiaohongshuAccount.accountId, "demo-account"); assert.equal(view.xiaohongshuAccount.enabled, false); assert.equal(view.social.postingEnabled, false); assert.equal(view.mySocialSubmissions.length, 0);
      assert(view.tasks.filter(task => task.key.startsWith("SOCIAL_") || task.key === "XIAOHONGSHU_FOLLOW").every(task => !task.enabled));
      await assert.rejects(run(a.id, post("disabled-social-post")), /DISABLED/); await assert.rejects(upload(a.id, "disabled-proof", await image(1)), /DISABLED/);
      assert.equal(await balance(a.id), 500); assert.deepEqual(await allFiles(), beforeFiles);
    });
    await test("saving an old merchant config safely merges disabled new tasks and preserves old configured values", async () => {
      const old = JSON.parse(JSON.stringify(config)); delete old.xiaohongshuAccount; delete old.social; for (const key of ["XIAOHONGSHU_FOLLOW", "SOCIAL_FIRST_POST", "SOCIAL_POST"]) delete old.tasks[key];
      old.tasks.PROFILE.rewardPoints = 137; old.enterpriseContact = { enabled: true, name: "保留的顾问入口", qrImageUrl: "/uploads/retained-qr.png" };
      const saved = await configure(admin.id, old, 0); revision = saved.revision; config = saved.config;
      assert.equal(config.tasks.PROFILE.rewardPoints, 137); assert.equal(config.enterpriseContact.name, "保留的顾问入口"); assert.equal(config.tasks.SOCIAL_POST.enabled, false);
      config.xiaohongshuAccount.enabled = true; config.social.enabled = true; for (const key of ["XIAOHONGSHU_FOLLOW", "SOCIAL_FIRST_POST", "SOCIAL_POST"] as const) config.tasks[key].enabled = true; await save(admin.id);
    });
    let proof: { id: string; url: string };
    await test("private screenshot upload validates bytes, normalizes metadata and replays the same request once", async () => {
      const file = await image(2); proof = await upload(a.id, "private-proof-1", file); const replay = await upload(a.id, "private-proof-1", file); assert.equal(proof.id, replay.id); assert(proof.url.startsWith("/api/"));
      assert(!proof.url.includes("/uploads/")); const meta = await sharp(await read(a.id, proof.id)).metadata(); assert.equal(meta.format, "webp"); assert.equal(meta.exif, undefined); assert.equal(meta.icc, undefined);
      assert(await read(admin.id, proof.id)); await assert.rejects(read(b.id, proof.id), /PROOF_NOT_FOUND/);
      const files = await allFiles(); assert.equal(files.length, beforeFiles.length + 1); const permissions = await stat(join(privateRoot, files.find(filename => !beforeFiles.includes(filename))!)); if (process.platform !== "win32") assert.equal(permissions.mode & 0o777, 0o600);
    });
    await test("proof upload rejects forged MIME, oversized input, changed request material, unbound and nonmember accounts", async () => {
      const files = await allFiles(); await assert.rejects(upload(a.id, "bad-proof-image", new File(["<svg>unsafe</svg>"], "image.png", { type: "image/png" })), /IMAGE_/);
      await assert.rejects(upload(a.id, "oversize-proof", new File([new Uint8Array(3 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })), /IMAGE_FILE_SIZE/);
      await assert.rejects(upload(a.id, "private-proof-1", await image(3)), /REQUEST_CHANGED/); await assert.rejects(upload(unbound.id, "unbound-proof", await image(4)), /PHONE_REQUIRED/); await assert.rejects(upload(noMember.id, "nonmember-proof", await image(5)), /MEMBERSHIP_REQUIRED/);
      assert.deepEqual(await allFiles(), files);
    });
    await test("foreign proof cannot be attached or deleted, and evidence never enters a public POST", async () => {
      await assert.rejects(run(b.id, post("stolen-proof-test", "", [proof.id])), /PROOF_NOT_FOUND/); await assert.rejects(remove(b.id, proof.id), /PROOF_NOT_FOUND/);
      assert.equal(await count("APPLICATION", b.id), 0); assert.equal(await count("POST", b.id), 0); assert.equal((await overview(b.id)).mySocialSubmissions.length, 0);
    });
    await test("follow screenshot is reviewed once and uses an independent reward key", async () => {
      const input = { ...post("follow-brand-xhs", "", [proof.id]), campaignKey: "XIAOHONGSHU_FOLLOW" };
      const submitted = await run(a.id, input); assert.equal(submitted.submission.status, "PENDING"); assert.equal(await balance(a.id), 500); assert.equal((await run(a.id, input)).submission.id, submitted.submission.id);
      const result = await review(admin.id, { action: "review_application", id: submitted.submission.id, decision: "APPROVED", note: "隔离环境确认关注截图", expectedRevision: 1 }); assert.equal(result.rewardPoints, 50); assert.equal(await balance(a.id), 550);
      await assert.rejects(review(admin.id, { action: "review_application", id: submitted.submission.id, decision: "APPROVED", note: "重复审批不发奖", expectedRevision: 1 }), /REVISION_CONFLICT/);
      assert.equal(await balance(a.id), 550); await assert.rejects(remove(a.id, proof.id), /PROOF_NOT_FOUND/);
    });
    await test("first external social post is independent of historical approved community posts and awards five once", async () => {
      const first = await run(a.id, post("first-social-post")); assert.equal(await balance(a.id), 550);
      const result = await review(admin.id, { action: "review_application", id: first.submission.id, decision: "APPROVED", note: "已核验首篇真实社媒分享", expectedRevision: 1 }); assert.equal(result.rewardPoints, 5); assert.equal(await balance(a.id), 555);
      await assert.rejects(run(a.id, post("duplicate-social-url", "https://www.xiaohongshu.com/explore/first-social-post?utm_source=other&xsec_token=one")), /DUPLICATE_CONTENT/);
    });
    await test("first-only and ongoing-only merchant configurations each accept and reward their eligible submissions", async () => {
      config.tasks.SOCIAL_FIRST_POST.enabled = false; config.tasks.SOCIAL_POST.enabled = true; await save(admin.id);
      assert.equal((await overview(b.id)).social.postingEnabled, true);
      const ongoingOnly = await run(b.id, post("ongoing-only-first-post"));
      const result = await review(admin.id, { action: "review_application", id: ongoingOnly.submission.id, decision: "APPROVED", note: "仅开放持续分享也可审核首篇", expectedRevision: 1 }); assert.equal(result.rewardPoints, 20);
      config.tasks.SOCIAL_FIRST_POST.enabled = true; config.tasks.SOCIAL_POST.enabled = false; await save(admin.id);
      const firstOnly = await run(c.id, post("first-only-initial-post")); assert.equal((await overview(c.id)).social.postingEnabled, false);
      await assert.rejects(run(c.id, post("first-only-duplicate-pending")), /LIMIT_REACHED/);
      const firstReward = await review(admin.id, { action: "review_application", id: firstOnly.submission.id, decision: "APPROVED", note: "仅开放首篇奖励一次", expectedRevision: 1 }); assert.equal(firstReward.rewardPoints, 5);
      assert.equal((await overview(c.id)).social.postingEnabled, false); await assert.rejects(run(c.id, post("first-only-second-post")), /LIMIT_REACHED/);
      config.tasks.SOCIAL_POST.enabled = true; await save(admin.id);
    });
    await test("rejection grants no points and revised material must use the current rejected revision", async () => {
      const input = post("rejected-social-post"), value = await run(a.id, input);
      await review(admin.id, { action: "review_application", id: value.submission.id, decision: "REJECTED", note: "请补充品牌相关内容", expectedRevision: 1 }); assert.equal(await balance(a.id), 555);
      await assert.rejects(run(a.id, { ...input, note: "已补充产品体验及品牌信息。", expectedRevision: 1 }), /REVISION_CONFLICT/);
      const revised = await run(a.id, { ...input, note: "已补充产品体验及品牌信息。", expectedRevision: 2 }); assert.equal(revised.submission.revision, 3); assert.equal(revised.submission.status, "PENDING");
      await review(admin.id, { action: "review_application", id: value.submission.id, decision: "APPROVED", note: "补充后符合活动要求", expectedRevision: 3 }); assert.equal(await balance(a.id), 575);
    });
    await test("concurrent approvals award once and verified ongoing posts remain unlimited",async()=>{
 const value=await run(a.id,post("parallel-social-post"));const input={action:"review_application" as const,id:value.submission.id,decision:"APPROVED" as const,note:"并发审批仅一次",expectedRevision:1};
 const results=await Promise.allSettled([review(admin.id,input),review(admin.id,input)]);assert.equal(results.filter(result=>result.status==="fulfilled").length,1);assert.equal(await balance(a.id),595);
 for(let i=0;i<7;i++){const item=await run(a.id,post("unlimited-social-"+i));const result=await review(admin.id,{action:"review_application",id:item.submission.id,decision:"APPROVED",note:"每篇核验真实社媒分享",expectedRevision:1});assert.equal(result.rewardPoints,20);}
 assert.equal(await balance(a.id),735);
});
    await test("already bound or duplicate screenshot evidence cannot fund another application", async () => {
      const ownProof = await upload(c.id, "own-social-proof", await image(8)); const item = await run(c.id, post("screenshot-only-post", "", [ownProof.id]));
      await review(admin.id, { action: "review_application", id: item.submission.id, decision: "APPROVED", note: "真实截图已私下核验", verifiedContentKey: "screenshot-post-20261019", expectedRevision: 1 });
      await assert.rejects(run(c.id, post("reuse-bound-proof", "", [ownProof.id])), /PROOF_NOT_FOUND/);
      const same = await upload(c.id, "copy-private-proof", await image(8)); await assert.rejects(run(c.id, post("reuse-proof-checksum", "", [same.id])), /DUPLICATE_CONTENT/); await remove(c.id, same.id);
    });
    await test("turning off an activity blocks approvals and proof uploads while rejection remains a no-reward decision", async () => {
      const item = await run(b.id, post("disabled-review-post")); const initial = await balance(b.id);
      config.social.enabled = false; config.tasks.XIAOHONGSHU_FOLLOW.enabled = false; await save(admin.id);
      await assert.rejects(review(admin.id, { action: "review_application", id: item.submission.id, decision: "APPROVED", note: "活动关闭不得发奖", expectedRevision: 1 }), /DISABLED/);
      await assert.rejects(upload(b.id, "disabled-later-proof", await image(9)), /DISABLED/);
      await review(admin.id, { action: "review_application", id: item.submission.id, decision: "REJECTED", note: "活动已关闭，拒绝不发奖", expectedRevision: 1 }); assert.equal(await balance(b.id), initial);
      config.social.enabled = true; config.tasks.XIAOHONGSHU_FOLLOW.enabled = true; await save(admin.id);
    });
    await test("native proof endpoints require auth and return private uncached content only to its owner", async () => {
      const tokenA = await bearer(a.id), tokenB = await bearer(b.id), request = (token: string) => new Request("https://qa.invalid", { headers: { authorization: "Bearer " + token, host: "qa.invalid" } });
      const file = await privateRoute.GET(request(tokenA), { params: Promise.resolve({ id: proof.id }) }); assert.equal(file.status, 200); assert.equal(file.headers.get("content-type"), "image/webp"); assert.match(file.headers.get("cache-control") || "", /private.*no-store/);
      assert.equal((await privateRoute.GET(request(tokenB), { params: Promise.resolve({ id: proof.id }) })).status, 404);
      assert.equal((await privateRoute.GET(request("invalid"), { params: Promise.resolve({ id: proof.id }) })).status, 401);
      const denied = await proofRoute.POST(new Request("https://qa.invalid", { method: "POST", headers: { authorization: "Bearer " + tokenA, host: "qa.invalid", origin: "https://evil.invalid" } })); assert.equal(denied.status, 403);
      const malformed = await operationsRoute.POST(new Request("https://qa.invalid", { method: "POST", headers: { authorization: "Bearer " + tokenA, host: "qa.invalid", "Content-Type": "application/json" }, body: JSON.stringify({ ...post("forged-points-social"), rewardPoints: 5000 }) })); assert.equal(malformed.status, 400);
    });
    await test("orders, payments, stock, account rows and legacy activity records remain identical", async () => {
      assert.deepEqual(await protectedState(), protectedBefore);
      const legacy = await prisma.$queryRaw<Array<{ state: string; revision: number; payload: unknown }>>`SELECT state,revision,payload FROM member_operation_records WHERE id=${legacyId}`;
      assert.equal(legacy[0].state, "APPROVED"); assert.equal(legacy[0].revision, 1); assert.deepEqual(legacy[0].payload, { text: "保留的历史社区内容，不可重置或删除。" });
    });
  } finally {
    const rows = await prisma.$queryRaw<Array<{ filename: string }>>`DELETE FROM member_social_uploads WHERE user_id=ANY(${ids}::text[]) RETURNING filename`;
    for (const row of rows) { assert(/^[a-f0-9-]{36}\.webp$/.test(row.filename)); await rm(join(privateRoot, row.filename), { force: true }); }
    await prisma.$executeRaw`DELETE FROM member_operation_records WHERE user_id=ANY(${ids}::text[])`;
    await prisma.$executeRaw`DELETE FROM member_operation_settings WHERE id='member-operations'`;
    await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: ids } }, { targetType: "member", targetId: { in: ids } }] } });
    await prisma.pointEntry.deleteMany({ where: { userId: { in: ids } } }); await prisma.session.deleteMany({ where: { userId: { in: ids } } }); await prisma.memberProfile.deleteMany({ where: { userId: { in: ids } } }); await prisma.user.deleteMany({ where: { id: { in: ids } } });
    assert.deepEqual(await allFiles(), beforeFiles); globalThis.fetch = originalFetch; await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.stack : "Social regression failed"); process.exitCode = 1; });

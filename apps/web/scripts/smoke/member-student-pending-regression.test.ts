import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? "");
  assert.equal(database.pathname, "/vk_refunded_order_status_smoke_20261018");
  assert.ok(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(process.env.COMMERCE_STORAGE, "prisma");
  const originalFetch = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw Error("No remote requests are allowed in student pending QA"); };
  const { prisma } = await import("@/lib/db/prisma");
  const { defaultMemberOperationsConfig } = await import("@/lib/commerce/member-operations");
  const { getMemberOperations, getAdminMemberOperations, performMemberOperation, reviewMemberOperation, saveMemberOperationsConfig } = await import("@/lib/services/member-operations-service");
  const { uploadSocialProof } = await import("@/lib/services/member-social-proof-service");
  const { issueEventMemberCoupon, claimMemberCoupon, redeemMemberCoupon, getMemberOverview } = await import("@/lib/services/membership-service");
  const users: string[] = [], coupons: string[] = [], suffix = randomUUID(); let serial = 0;
  const existing = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM member_operation_settings WHERE id='member-operations'`;
  assert.equal(existing.length, 0, "An empty isolated settings row is required");
  async function user(role: "CUSTOMER" | "ADMIN" = "CUSTOMER") {
    const row = await prisma.user.create({ data: { role, name: "student-pending-qa-" + suffix, phone: "139" + String(++serial).padStart(8, "0"),
      ...(role === "CUSTOMER" ? { membership: { create: { pointsBalance: 1000 } } } : {}) } }); users.push(row.id); return row.id;
  }
  async function record(userId: string, subject: string, state: string, payload: object, kind = "APPLICATION") {
    const id = "pending-qa-" + randomUUID();
    await prisma.$executeRaw`INSERT INTO member_operation_records(id,kind,user_id,subject_id,state,payload) VALUES(${id},${kind},${userId},${subject},${state},${JSON.stringify(payload)}::jsonb)`;
    return id;
  }
  try {
    const admin = await user("ADMIN"), legacy = await user(), fresh = await user(), other = await user();
    for (const [amountCents, minimumCents] of [[10000, 60000], [40000, 220000]]) {
      const row = await prisma.couponTemplate.create({ data: { title: "Student pending QA-" + suffix, amountCents, minimumCents,
        deliveryMode: "REWARD", active: true, totalLimit: 100, issuedCount: 1, startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() + 365 * 86400000) } }); coupons.push(row.id);
    }
    const referralTemplate = await prisma.couponTemplate.create({ data: { title: "Referral pending QA-" + suffix, amountCents: 20000, minimumCents: 60000,
      deliveryMode: "REWARD", active: true, totalLimit: 100, startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() + 365 * 86400000) } }); coupons.push(referralTemplate.id);
    const config = defaultMemberOperationsConfig(); config.tasks.STUDENT.enabled = true;
    config.studentBenefits = { enabled: true, couponTemplateIds: coupons.slice(0, 2), firstSocialPoints: 1500 }; config.social.enabled = true;
    config.tasks.SOCIAL_FIRST_POST.enabled = true; config.tasks.SOCIAL_POST.enabled = true;
    await prisma.$executeRaw`INSERT INTO member_operation_settings(id,revision,config,updated_by) VALUES('member-operations',2,${JSON.stringify(config)}::jsonb,${admin})`;
    const approvedAt = new Date(Date.now() - 60000), expiresAt = new Date(Date.now() + 179 * 86400000);
    const legacyId = await record(legacy, "STUDENT", "APPROVED", { taskKey: "STUDENT", approvedAt: approvedAt.toISOString(), validUntil: expiresAt.toISOString(), cycleId: "old-manual-cycle", detail: { school: "Historical record" } });
    const pendingId = await record(fresh, "STUDENT", "PENDING", { taskKey: "STUDENT", detail: { school: "Old client submission", graduationYear: 2028 } });
    const eventKey = "student:historic:" + suffix;
    const historicClaimId = "reward-" + createHash("sha256").update(eventKey).digest("hex");
    await prisma.couponClaim.create({ data: { id: historicClaimId, userId: legacy, templateId: coupons[0], source: "STUDENT", expiresAt } });
    const historicPoint = await prisma.pointEntry.create({ data: { userId: legacy, eventKey: "historic-student-" + suffix, delta: 100, balanceAfter: 1000, reason: "Historical student award" } });
    const historicSnapshot = {
      record: await prisma.$queryRaw`SELECT * FROM member_operation_records WHERE id=${legacyId}`,
      claim: await prisma.couponClaim.findUniqueOrThrow({ where: { id: historicClaimId } }),
      points: historicPoint,
    };
    const balances = async () => prisma.memberProfile.findMany({ where: { userId: { in: users } }, orderBy: { id: "asc" } });
    const beforeBalances = await balances();

    await test("enabled settings expose ready WeChat verification while legacy manual identities remain ineligible", async () => {
      const dto = await getMemberOperations(legacy), adminDto = await getAdminMemberOperations(admin);
      assert.deepEqual(dto.student.verification, { provider: "WECHAT", status: "READY", available: true });
      assert.equal(dto.student.valid, false); assert.equal(dto.student.benefitsEnabled, true); assert.equal(dto.student.coupons.length, 2);
      assert.equal(dto.tasks.find(task => task.key === "STUDENT")?.enabled, true);
      assert.equal(dto.tasks.find(task => task.key === "STUDENT")?.state, "AVAILABLE");
      assert.ok(dto.myApplications.some(application => application.id === legacyId));
      assert.equal(adminDto.config.tasks.STUDENT.enabled, true); assert.equal(adminDto.config.studentBenefits.enabled, true);
      const wallet = await getMemberOverview(legacy); assert.equal(wallet.wallet.find(claim => claim.id === historicClaimId)?.status, "AVAILABLE");
    });

    await test("old-client forms, student proofs, forged claims and manual approvals cannot change records or award points", async () => {
      await assert.rejects(performMemberOperation(fresh, { action: "submit_application", taskKey: "STUDENT", expectedRevision: 1,
        detail: { school: "Old manual form", graduationYear: 2028, note: "Do not collect this", proofKeys: ["msu_" + "a".repeat(32)] } }), /MEMBER_STUDENT_VERIFICATION_UNAVAILABLE/);
      await assert.rejects(uploadSocialProof(fresh, "pending-request", new File(["not an image"], "student.png"), "STUDENT"), /MEMBER_STUDENT_VERIFICATION_UNAVAILABLE/);
      for (const decision of ["APPROVED", "REJECTED"] as const) await assert.rejects(reviewMemberOperation(admin,
        { action: "review_application", id: pendingId, decision, note: "No manual student decisions", expectedRevision: 1 }), /MEMBER_STUDENT_VERIFICATION_UNAVAILABLE/);
      await assert.rejects(performMemberOperation(fresh, { action: "claim_task", taskKey: "STUDENT" } as never), /INVALID_MEMBER_OPERATION/);
      assert.deepEqual(await balances(), beforeBalances);
      const row = await prisma.$queryRaw<Array<{ state: string; revision: number }>>`SELECT state,revision FROM member_operation_records WHERE id=${pendingId}`;
      assert.deepEqual(row, [{ state: "PENDING", revision: 1 }]);
      assert.equal((await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM member_social_uploads WHERE user_id=ANY(${users}::text[])`)[0].count, BigInt(0));
    });

    await test("admin can save valid WeChat benefits while inconsistent switches and non-admin review stay forbidden", async () => {
 const saved=await saveMemberOperationsConfig(admin,config,2);assert.equal(saved.config.tasks.STUDENT.enabled,true);assert.equal(saved.config.studentBenefits.enabled,true);
 const benefits=structuredClone(config);benefits.tasks.STUDENT.enabled=false;
 await assert.rejects(saveMemberOperationsConfig(admin,benefits,saved.revision),/INVALID_MEMBER_OPERATION/);
 await assert.rejects(reviewMemberOperation(other,{action:"review_application",id:pendingId,decision:"APPROVED",note:"Unauthorized",expectedRevision:1}),/ADMIN_REQUIRED/);
});

    await test("new trusted student coupon events and public/points bypasses fail; a historical identical event and normal referral events retain their contracts", async () => {
      await assert.rejects(prisma.$transaction(tx => issueEventMemberCoupon(tx, { userId: legacy, templateId: coupons[0], source: "STUDENT", eventKey: "student:new:" + suffix, reason: "Must not issue", expiresAt })), /MEMBER_STUDENT_VERIFICATION_UNAVAILABLE/);
      const replay = await prisma.$transaction(tx => issueEventMemberCoupon(tx, { userId: legacy, templateId: coupons[0], source: "STUDENT", eventKey, reason: "Historical replay", expiresAt }));
      assert.equal(replay.id, historicClaimId); assert.equal(replay.alreadyClaimed, true);
      await assert.rejects(claimMemberCoupon(fresh, coupons[0]), /COUPON_DELIVERY_FORBIDDEN/);
      await assert.rejects(redeemMemberCoupon(fresh, coupons[0], randomUUID()), /COUPON_DELIVERY_FORBIDDEN/);
      const referral = await prisma.$transaction(tx => issueEventMemberCoupon(tx, { userId: other, templateId: referralTemplate.id, source: "REFERRAL", eventKey: "referral:qa:" + suffix, reason: "Normal nonstudent event", expiresAt }));
      assert.equal(referral.alreadyClaimed, false);
    });

    await test("ordinary social screenshots still award five then twenty, never 1500 from a legacy manual student identity", async () => {
      for (const [index, expectedPoints] of [[1, 5], [2, 20]]) {
        const proof = "msu_" + randomUUID().replaceAll("-", ""), requestId = "social-qa-" + index + "-" + suffix;
        await prisma.$executeRaw`INSERT INTO member_social_uploads(id,user_id,request_id,filename,checksum,size_bytes,purpose) VALUES(${proof},${legacy},${requestId},${randomUUID() + ".webp"},${createHash("sha256").update(proof).digest("hex")},100,'SOCIAL')`;
        const result = await performMemberOperation(legacy, { action: "submit_social_submission", campaignKey: "SOCIAL_POST", platform: "XIAOHONGSHU",
          postUrl: "https://www.xiaohongshu.com/explore/" + requestId, note: "Synthetic screenshot review", proofKeys: [proof], requestId });
        assert.ok(result && typeof result === "object" && "submission" in result);
        const submission = result.submission as { id: string; revision: number };
        assert.equal((await reviewMemberOperation(admin, { action: "review_application", id: submission.id, decision: "APPROVED", note: "Synthetic approved post", expectedRevision: submission.revision })).rewardPoints, expectedPoints);
        await assert.rejects(reviewMemberOperation(admin, { action: "review_application", id: submission.id, decision: "APPROVED", note: "Duplicate review", expectedRevision: submission.revision }), /REVISION_CONFLICT/);
      }
      assert.equal((await prisma.memberProfile.findUniqueOrThrow({ where: { userId: legacy } })).pointsBalance, 1025);
      assert.equal((await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM member_operation_records WHERE user_id=${legacy} AND payload->>'taskKey'='STUDENT_SOCIAL'`)[0].count, BigInt(0));
    });

    await test("all historical student records, coupon terms and point entries survive unchanged after blocked operations and ordinary activity", async () => {
      assert.deepEqual(await prisma.$queryRaw`SELECT * FROM member_operation_records WHERE id=${legacyId}`, historicSnapshot.record);
      assert.deepEqual(await prisma.couponClaim.findUniqueOrThrow({ where: { id: historicClaimId } }), historicSnapshot.claim);
      assert.deepEqual(await prisma.pointEntry.findUniqueOrThrow({ where: { id: historicPoint.id } }), historicSnapshot.points);
      assert.equal(requests, 0);
    });
  } finally {
    try {
      await prisma.$executeRaw`DELETE FROM member_social_uploads WHERE user_id=ANY(${users}::text[])`;
      await prisma.$executeRaw`DELETE FROM member_operation_records WHERE user_id=ANY(${users}::text[])`;
      await prisma.$executeRaw`DELETE FROM member_operation_settings WHERE id='member-operations'`;
      await prisma.auditLog.deleteMany({ where: { OR: [{ actorId: { in: users } }, { targetId: { in: users } },
        { action: "member.reward.coupon.issued", OR: users.map(userId => ({ detail: { path: ["userId"], equals: userId } })) }] } });
      await prisma.pointEntry.deleteMany({ where: { userId: { in: users } } });
      await prisma.couponClaim.deleteMany({ where: { userId: { in: users } } });
      await prisma.couponTemplate.deleteMany({ where: { id: { in: coupons } } });
      await prisma.memberProfile.deleteMany({ where: { userId: { in: users } } });
      await prisma.user.deleteMany({ where: { id: { in: users } } });
    } finally {
      globalThis.fetch = originalFetch;
      await prisma.$disconnect();
    }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

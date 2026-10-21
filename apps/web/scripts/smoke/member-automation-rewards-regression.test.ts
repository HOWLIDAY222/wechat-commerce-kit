import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Prisma } from "@prisma/client";
import { addUtcCalendarMonths, defaultMemberRewardPolicy } from "@/lib/commerce/member-reward-policy";

async function main() {
  const database = new URL(process.env.DATABASE_URL || "");
  assert.equal(database.pathname, "/vk_member_rewards_v3_smoke_20261018", "Only the disposable rewards v3 QA database is allowed");
  assert(["localhost", "127.0.0.1"].includes(database.hostname));
  assert.equal(process.env.COMMERCE_STORAGE, "prisma");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Error("Reward QA may not contact real gateways"); };
  const { prisma } = await import("@/lib/db/prisma");
  const { settleReferralRegistration: registration, settleReferralPurchaseForOrder: purchase, reconcileReferralRefund: refund,
    reconcilePendingReferralRewards, getReferralRewardOverview, mergeMemberRewardIdentity, memberRewardPhoneIdentity } = await import("@/lib/services/member-automation-rewards-service");
  const { issueEventMemberCoupon, mergeMembership, completeMemberOrder, getMemberOverview, holdMemberCoupon } = await import("@/lib/services/membership-service");
  const { changeMemberPoints } = await import("@/lib/services/member-points-service");
  const { defaultMemberOperationsConfig } = await import("@/lib/commerce/member-operations");
  const { performMemberOperation, saveMemberOperationsConfig } = await import("@/lib/services/member-operations-service");
  const ids: string[] = [], orderIds: string[] = [], templateIds: string[] = [], suffix = randomUUID();
  let operationsConfigured = false;
  const rule = defaultMemberRewardPolicy();
  const tx = <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => prisma.$transaction(work, { timeout: 30_000 });
  const balance = async (id: string) => (await prisma.memberProfile.findUniqueOrThrow({ where: { userId: id } })).pointsBalance;
  const save = () => prisma.siteSetting.upsert({ where: { key: "memberRewardPolicy" }, create: { key: "memberRewardPolicy", value: rule as Prisma.InputJsonObject }, update: { value: rule as Prisma.InputJsonObject } });
  const event = async (id: string) => (await prisma.$queryRaw<Array<{ state: string; couponClaimId: string; payload: Record<string, unknown> }>>`SELECT state,coupon_claim_id AS "couponClaimId",payload FROM member_reward_events WHERE order_id=${id}`)[0];
  async function user() {
    const phone = "139" + String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0");
    const value = await prisma.user.create({ data: { name: "reward-qa-" + suffix, phone, role: "CUSTOMER", membership: { create: { pointsBalance: 0 } } } });
    ids.push(value.id); return value;
  }
  async function refer(inviteeId: string, inviterId: string, createdAt = new Date(Date.now() - 500)) {
    const referralRecordId = "qa-ref-" + randomUUID();
    await prisma.$executeRaw`INSERT INTO member_operation_records(id,kind,user_id,subject_id,state,payload,created_at) VALUES(${referralRecordId},'REFERRAL',${inviteeId},'CURRENT','PENDING',${JSON.stringify({ inviterId })}::jsonb,${createdAt.toISOString()}::timestamptz)`;
    return { inviteeId, inviterId, referralRecordId };
  }
  async function order(userId: string, couponClaimId?: string) {
    const value = await prisma.order.create({ data: { orderNo: "reward-qa-" + randomUUID(), userId, kind: "STANDARD", status: "CONFIRMED", paymentStatus: "PAID", fulfillmentStatus: "DELIVERED",
      customerName: "隔离奖励测试", customerPhone: "13900000004", addressSnapshot: "仅隔离测试", subtotalCents: 5_000, payableAmountCents: 6_000, shippingFeeCents: 1_000,
      ...(couponClaimId ? { couponClaimId } : {}) } }); orderIds.push(value.id); return value;
  }
  async function succeededRefund(orderId: string, cents: number) {
    return prisma.refund.create({ data: { orderId, refundNo: "reward-qa-" + randomUUID(), refundAmountCents: cents, refundStatus: "SUCCEEDED", reason: "仅隔离奖励退款验证" } });
  }
  try {
    assert.equal(await prisma.siteSetting.count({ where: { key: "memberRewardPolicy" } }), 0, "Never replace an existing program");
    assert.equal(Number((await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM member_operation_settings WHERE id='member-operations'`)[0].count), 0, "Fresh isolated operations settings required");
    assert.equal(Number((await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM member_reward_events`)[0].count), 0, "Fresh isolated event table required");
    await test("explicit UTC instants preserve ordering and raw decoding in UTC and China database sessions", async () => {
      for (const zone of ["UTC", "Asia/Shanghai"] as const) await tx(async client => {
        await client.$executeRawUnsafe("SET LOCAL TIME ZONE '" + zone + "'");
        const [result] = await client.$queryRaw<Array<{ mixed: boolean; explicit: boolean; decoded: Date }>>`SELECT
          TIMESTAMP '2026-10-18 12:45:01' > TIMESTAMPTZ '2026-10-18 12:45:00+00' AS mixed,
          (TIMESTAMP '2026-10-18 12:45:01' AT TIME ZONE 'UTC') > TIMESTAMPTZ '2026-10-18 12:45:00+00' AS explicit,
          TIMESTAMPTZ '2026-10-18 12:45:00+00' AT TIME ZONE 'UTC' AS decoded`;
        assert.equal(result.mixed, zone === "UTC"); assert.equal(result.explicit, true);
        assert.equal(result.decoded.toISOString(), "2026-10-18T12:45:00.000Z");
      });
    });
    const inviter = await user(), invitee = await user();
    const binding = await refer(invitee.id, inviter.id);
    await test("disabled referral policy changes no member balance and creates no events", async () => {
      assert.deepEqual(await tx(client => registration(client, binding)), { enabled: false, newMemberPoints: 0, inviterPoints: 0 });
      assert.equal(await balance(inviter.id), 0); assert.equal(await balance(invitee.id), 0);
    });
    rule.referral.enabled = true; rule.referral.activatedAt = new Date(Date.now() - 60_000).toISOString(); await save();
    const template = await prisma.couponTemplate.create({ data: { id: "qa-referral-" + suffix, title: "隔离邀请满600减200", amountCents: 20_000, minimumCents: 60_000, productIds: [], startsAt: new Date(0), endsAt: new Date("9999-12-31T00:00:00Z"), totalLimit: 100_000, active: true, deliveryMode: "REWARD" } });
    templateIds.push(template.id); rule.referral.purchaseCouponTemplateId = template.id; await save();
    await tx(client => changeMemberPoints(client, invitee.id, { eventKey: "newcomer:" + invitee.id, delta: 1_000, reason: "原新客入会礼" }));
    await test("concurrent registration rewards once, retaining existing newcomer 1000 plus invited 100", async () => {
      await Promise.all([tx(client => registration(client, binding)), tx(client => registration(client, binding))]);
      assert.equal(await balance(invitee.id), 1_100); assert.equal(await balance(inviter.id), 100);
      assert.equal(await prisma.pointEntry.count({ where: { userId: invitee.id, eventKey: { startsWith: "referral-v1:new-member:" } } }), 1);
      const self = await refer(inviter.id, inviter.id);
      await assert.rejects(tx(client => registration(client, self)), /MEMBER_OPERATIONS_INVALID_REFERRAL/);
      await prisma.$executeRaw`DELETE FROM member_operation_records WHERE id=${self.referralRecordId}`;
    });
    await test("real default-time binding and Prisma order settle invited 100 plus inviter 100 and one coupon exactly once through worker", async () => {
      const owner = await prisma.user.create({ data: { name: "reward-native-qa-" + suffix, role: "ADMIN" } }); ids.push(owner.id);
      const operations = defaultMemberOperationsConfig(); operations.tasks.INVITE.enabled = true;
      await saveMemberOperationsConfig(owner.id, operations, 0); operationsConfigured = true;
      const nativeInviter = await user(), nativeInvitee = await user();
      const code = await performMemberOperation(nativeInviter.id, { action: "create_referral" }) as { code: string };
      const startedAt = Date.now();
      assert.deepEqual(await performMemberOperation(nativeInvitee.id, { action: "bind_referral", code: code.code }), { bound: true });
      assert.equal(await balance(nativeInviter.id), 0); assert.equal(await balance(nativeInvitee.id), 0);
      const [binding] = await prisma.$queryRaw<Array<{ id: string; createdAt: Date; millis: number }>>`SELECT id,created_at AT TIME ZONE 'UTC' AS "createdAt",(extract(epoch FROM created_at)*1000)::float8 AS millis FROM member_operation_records WHERE kind='REFERRAL' AND user_id=${nativeInvitee.id} AND subject_id='CURRENT'`;
      assert(binding.createdAt.getTime() >= startedAt - 1 && binding.createdAt.getTime() <= Date.now());
      assert.equal(binding.createdAt.getTime(), Math.trunc(binding.millis));
      const bought = await order(nativeInvitee.id);
      assert(bought.createdAt > binding.createdAt, "Order uses its actual default timestamp after real binding");
      const beforeOrder = await prisma.order.findUniqueOrThrow({ where: { id: bought.id } });
      await reconcilePendingReferralRewards(prisma, 100); await reconcilePendingReferralRewards(prisma, 100);
      assert.equal(await balance(nativeInvitee.id), 100); assert.equal(await balance(nativeInviter.id), 100);
      assert.equal(await prisma.pointEntry.count({ where: { userId: nativeInvitee.id, eventKey: { startsWith: "referral-v1:new-member:" } } }), 1);
      assert.equal(await prisma.pointEntry.count({ where: { userId: nativeInviter.id, eventKey: { startsWith: "referral-v1:inviter-registration:" } } }), 1);
      assert.equal(await prisma.couponClaim.count({ where: { userId: nativeInviter.id, source: "REFERRAL" } }), 1);
      assert.equal((await event(bought.id)).state, "SETTLED");
      assert.deepEqual(await prisma.order.findUniqueOrThrow({ where: { id: bought.id } }), beforeOrder);
    });
    await test("inviter registration rewards stop at 20 unique invited people without blocking invitations", async () => {
      const next = await Promise.all(Array.from({ length: 20 }, () => user()));
      for (const value of next) await tx(async client => registration(client, await refer(value.id, inviter.id)));
      assert.equal(await balance(inviter.id), 2_000);
      assert.equal(Number((await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM member_reward_events WHERE kind='REFERRAL_INVITER_REGISTRATION' AND state='SKIPPED_LIMIT'`)[0].count), 1);
      assert.equal(await balance(next[19].id), 100);
    });
    await test("changing an inviter phone keeps its lifetime 20-person cap and overview stays read-only",async()=>{
      await prisma.user.update({where:{id:inviter.id},data:{phone:'138'+String(Math.floor(Math.random()*100_000_000)).padStart(8,'0')}});
      const aliasCount=Number((await prisma.$queryRaw<Array<{count:bigint}>>`SELECT count(*) AS count FROM member_reward_identity_aliases`)[0].count);
      const mappingCount=Number((await prisma.$queryRaw<Array<{count:bigint}>>`SELECT count(*) AS count FROM member_reward_account_identities`)[0].count);
      assert.equal((await getReferralRewardOverview(prisma,inviter.id)).registrationRewardCount,20);
      assert.equal(Number((await prisma.$queryRaw<Array<{count:bigint}>>`SELECT count(*) AS count FROM member_reward_identity_aliases`)[0].count),aliasCount);
      assert.equal(Number((await prisma.$queryRaw<Array<{count:bigint}>>`SELECT count(*) AS count FROM member_reward_account_identities`)[0].count),mappingCount);
      const next=await user(),binding=await refer(next.id,inviter.id);await tx(client=>registration(client,binding));
      assert.equal(await balance(inviter.id),2_000);assert.equal(await balance(next.id),100);assert.equal((await getReferralRewardOverview(prisma,inviter.id)).registrationRewardCount,20);
    });
    const firstOrder = await order(invitee.id);
    await test("delivery plus positive net goods payment issues one coupon and does not alter orders", async () => {
      await prisma.order.update({ where: { id: firstOrder.id }, data: { fulfillmentStatus: "SHIPPED" } });
      assert.equal((await tx(client => purchase(client, firstOrder.id))).rewarded, false);
      await prisma.order.update({ where: { id: firstOrder.id }, data: { fulfillmentStatus: "DELIVERED" } });
      const before = await prisma.order.findUniqueOrThrow({ where: { id: firstOrder.id } });
      await Promise.all([tx(client => purchase(client, firstOrder.id)), tx(client => purchase(client, firstOrder.id))]);
      assert.deepEqual(await prisma.order.findUniqueOrThrow({ where: { id: firstOrder.id } }), before);
      const secondOrder = await order(invitee.id); await tx(client => purchase(client, secondOrder.id));
      assert.equal(await prisma.couponClaim.count({ where: { userId: inviter.id, source: "REFERRAL" } }), 1);
      const reward = await event(firstOrder.id); assert.equal(reward.state, "SETTLED");
      const coupon = await prisma.couponClaim.findUniqueOrThrow({ where: { id: reward.couponClaimId } });
      assert.equal(coupon.pointsSpent, 0); assert.equal(coupon.templateId, template.id);
      assert.equal(coupon.expiresAt?.toISOString(), reward.payload.expiresAt);
      assert(coupon.expiresAt && coupon.expiresAt > addUtcCalendarMonths(new Date(Date.now()-60_000),2) && coupon.expiresAt < addUtcCalendarMonths(new Date(Date.now()+60_000),2));
    });
    await test("partial refunds retain eligibility and full goods refunds void an unused coupon once", async () => {
      const reward = await event(firstOrder.id);
      await succeededRefund(firstOrder.id, 4_999); await tx(client => refund(client, firstOrder.id));
      assert.equal((await event(firstOrder.id)).state, "SETTLED");
      await succeededRefund(firstOrder.id, 1); await tx(client => refund(client, firstOrder.id)); await tx(client => refund(client, firstOrder.id));
      assert.equal((await event(firstOrder.id)).state, "VOIDED");
      assert.equal((await prisma.couponClaim.findUniqueOrThrow({ where: { id: reward.couponClaimId } })).voided, true);
    });
    await test("already used referral coupon records recovery without changing the paid order", async () => {
      const customer = await user(); await refer(customer.id, inviter.id); const bought = await order(customer.id);
      await tx(client => purchase(client, bought.id)); const reward = await event(bought.id);
      const used = await order(inviter.id, reward.couponClaimId);
      const before = await prisma.order.findUniqueOrThrow({ where: { id: used.id } });
      await succeededRefund(bought.id, 5_000); await tx(client => refund(client, bought.id));
      assert.equal((await event(bought.id)).state, "RECOVERY_REQUIRED");
      assert.deepEqual(await prisma.order.findUniqueOrThrow({ where: { id: used.id } }), before);
      assert.equal((await prisma.couponClaim.findUniqueOrThrow({ where: { id: reward.couponClaimId } })).voided, false);
    });
    await test("referral event coupons replay once, preserve distinct events and survive account merge", async () => {
      const source = await user(), target = await user(), eventKey = "referral:qa-cycle-1:coupon:" + template.id;
      const request = { userId: source.id, templateId: template.id, eventKey, source: "REFERRAL" as const, reason: "隔离邀请事件" };
      await Promise.all([tx(client => issueEventMemberCoupon(client, request)), tx(client => issueEventMemberCoupon(client, request))]);
      await tx(client => issueEventMemberCoupon(client, { ...request, eventKey: eventKey.replace("cycle-1", "cycle-2") }));
      assert.equal(await prisma.couponClaim.count({ where: { userId: source.id, source: "REFERRAL" } }), 2);
      await assert.rejects(tx(client => issueEventMemberCoupon(client, { ...request, userId: target.id })), /MEMBER_REQUEST_CHANGED/);
      await tx(client => mergeMembership(client, source.id, target.id));
      assert.equal(await prisma.couponClaim.count({ where: { userId: target.id, source: "REFERRAL", voided: false } }), 2);
    });
    await test("worker retries optional reward failures without changing completed receipt or historical orders", async () => {
      const before = await prisma.order.findUniqueOrThrow({ where: { id: firstOrder.id } });
      rule.referral.purchaseCouponTemplateId = "missing-qa-template"; await save();
      const customer = await user(); await refer(customer.id, inviter.id); const bought = await order(customer.id);
      await tx(client => completeMemberOrder(client, bought.id));
      assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: bought.id } })).fulfillmentStatus, "DELIVERED");
      await reconcilePendingReferralRewards(prisma,100);
      assert(await prisma.auditLog.findFirst({ where: { action: "member.referral.purchase.retry-required", targetId: bought.id } }));
      assert.deepEqual(await prisma.order.findUniqueOrThrow({ where: { id: firstOrder.id } }), before);
      rule.referral.purchaseCouponTemplateId = template.id; await save();
      await reconcilePendingReferralRewards(prisma,100);
      assert.equal((await event(bought.id)).state, "SETTLED", "Worker still runs after existing memberRewardsSettledAt");
    });
    await test("merges retain stable referral identities and redirect existing share code ownership", async () => {
      const source = await user(), target = await user(), customer = await user();
      const binding = await refer(customer.id, source.id); await tx(client => registration(client, binding));
      await prisma.$executeRaw`INSERT INTO member_operation_records(id,kind,user_id,subject_id,state,payload) VALUES(${'qa-code-'+suffix},'REFERRAL_CODE',${source.id},'CURRENT','ACTIVE','{}'::jsonb),(${'qa-target-code-'+suffix},'REFERRAL_CODE',${target.id},'CURRENT','ACTIVE','{}'::jsonb)`;
      const phoneIdentity = memberRewardPhoneIdentity(source.phone!);
      await tx(client => mergeMemberRewardIdentity(client, source.id, target.id));
      const rows = await prisma.$queryRaw<Array<{ userId: string; recipientIdentity: string }>>`SELECT user_id AS "userId",recipient_identity AS "recipientIdentity" FROM member_reward_events WHERE recipient_identity=${phoneIdentity}`;
      assert(rows.length > 0 && rows.every(row => row.userId === target.id && row.recipientIdentity === phoneIdentity));
      const codes = await prisma.$queryRaw<Array<{ id: string; userId: string; state: string }>>`SELECT id,user_id AS "userId",state FROM member_operation_records WHERE kind='REFERRAL_CODE' AND user_id=${target.id}`;
      assert.equal(codes.length, 2); assert(codes.every(code => code.state === "ACTIVE"));
    });
    await test("claim-specific expiry controls the wallet and checkout hold without changing existing null-expiry claims", async () => {
      const customer=await user(), expiresAt=new Date(Date.now()+180*86_400_000);
      const request={userId:customer.id,templateId:template.id,eventKey:'referral:expiry:'+suffix,source:'REFERRAL' as const,reason:'隔离逐张有效期',expiresAt};
      const coupon=await tx(client=>issueEventMemberCoupon(client,request));
      const wallet=(await getMemberOverview(customer.id)).wallet.find(value=>value.id===coupon.id)!;
      assert.equal(wallet.endsAt.getTime(),expiresAt.getTime());assert.equal(wallet.status,'AVAILABLE');assert.equal(wallet.longTerm,false);
      await assert.rejects(tx(client=>issueEventMemberCoupon(client,{...request,expiresAt:new Date(expiresAt.getTime()+1)})),/MEMBER_REQUEST_CHANGED/);
      await prisma.couponClaim.update({where:{id:coupon.id},data:{expiresAt:new Date(Date.now()-1_000)}});
      assert.equal((await getMemberOverview(customer.id)).wallet.find(value=>value.id===coupon.id)?.status,'EXPIRED');
      const pendingOrder=await order(customer.id);
      await assert.rejects(tx(client=>holdMemberCoupon(client,coupon.id,customer.id,pendingOrder.id)),/COUPON_CHANGED/);
    });
    await test("worker batch limits are bounded and pre-activation invitations are never replayed",async()=>{
      const old=await user();await refer(old.id,inviter.id,new Date(Date.now()-120_000));const before=await balance(old.id);const bought=await order(old.id);
      const result=await reconcilePendingReferralRewards(prisma,1);assert(result.examined<=1);
      assert.equal(await balance(old.id),before);assert.equal(await event(bought.id),undefined);
      await assert.rejects(reconcilePendingReferralRewards(prisma,101),/INVALID_MEMBER_REWARD_BATCH_LIMIT/);
    });
    await test("old members and new identities merged into old membership cannot receive purchase referral coupons",async()=>{
      const old=await user(),fresh=await user();
      await prisma.memberProfile.update({where:{userId:old.id},data:{joinedAt:new Date(Date.now()-120_000)}});
      await refer(fresh.id,inviter.id);const bought=await order(fresh.id);
      await tx(client=>mergeMembership(client,fresh.id,old.id));
      await prisma.order.update({where:{id:bought.id},data:{userId:old.id}});
      assert.equal((await tx(client=>purchase(client,bought.id))).rewarded,false);
      await reconcilePendingReferralRewards(prisma,100);assert.equal(await event(bought.id),undefined);
    });
    await test("a later account using the same previously rewarded phone cannot receive invited 100 twice",async()=>{
      const originalPhone=invitee.phone!;
      await prisma.user.update({where:{id:invitee.id},data:{phone:'137'+String(Math.floor(Math.random()*100_000_000)).padStart(8,'0')}});
      const repeat=await user();await prisma.user.update({where:{id:repeat.id},data:{phone:originalPhone}});
      const binding=await refer(repeat.id,inviter.id);await tx(client=>registration(client,binding));
      assert.equal(await balance(repeat.id),0);assert.equal(await balance(invitee.id),1_100);
    });
  } finally {
    await prisma.$executeRaw`DELETE FROM member_reward_events WHERE user_id=ANY(${ids}::text[]) OR subject_user_id=ANY(${ids}::text[])`;
    await prisma.$executeRaw`DELETE FROM member_operation_records WHERE user_id=ANY(${ids}::text[])`;
    await prisma.refund.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.pointEntry.deleteMany({ where: { userId: { in: ids } } });
    await prisma.couponClaim.deleteMany({ where: { userId: { in: ids } } });
    await prisma.couponTemplate.deleteMany({ where: { id: { in: templateIds } } });
    await prisma.memberProfile.deleteMany({ where: { userId: { in: ids } } });
    if (operationsConfigured) await prisma.$executeRaw`DELETE FROM member_operation_settings WHERE id='member-operations' AND updated_by=ANY(${ids}::text[])`;
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.siteSetting.deleteMany({ where: { key: "memberRewardPolicy" } });
    await prisma.$executeRawUnsafe("DELETE FROM member_reward_identity_aliases");
    await prisma.$executeRaw`DELETE FROM member_reward_account_identities WHERE user_id=ANY(${ids}::text[])`;
    globalThis.fetch = originalFetch; await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Reward QA failed"); process.exitCode = 1; });

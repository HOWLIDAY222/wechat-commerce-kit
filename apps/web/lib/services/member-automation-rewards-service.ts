import { createHash, createHmac } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { appConfig } from "@/lib/config";
import { isMainlandPhone, normalizeMainlandPhone } from "@/lib/providers/sms";
import { MEMBER_REWARD_POLICY_KEY, addUtcCalendarMonths, parseMemberRewardPolicy, referralNetGoodsCents, referralProgramActive } from "@/lib/commerce/member-reward-policy";
import { changeMemberPoints } from "@/lib/services/member-points-service";
import { issueEventMemberCoupon } from "@/lib/services/membership-service";

type Tx = Prisma.TransactionClient;
type RewardEvent = { id: string; eventKey: string; kind: string; recipientIdentity: string; subjectIdentity: string;
  userId: string; subjectUserId: string; sourceId: string; orderId: string | null; couponClaimId: string | null;
  points: number; state: string; payload: Record<string, unknown> };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const memberRewardEventId = (eventKey: string) => "mre_" + hash(eventKey);
export const memberRewardPhoneIdentity = (phone: string) => {
  const normalized = normalizeMainlandPhone(phone);
  if (!isMainlandPhone(normalized)) throw Error("MEMBER_PHONE_REQUIRED");
  return "phone_" + createHmac("sha256", appConfig.SESSION_SECRET).update("member-reward-identity-v1:" + normalized).digest("hex");
};
function rewardErrorCode(error: unknown) {
  if (error instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)) return error.message;
  if (error && typeof error === "object" && "code" in error && /^P\d{4}$/.test(String(error.code))) return String(error.code);
  return "REWARD_SETTLEMENT_FAILED";
}
const lock = (tx: Tx) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('member-referral-rewards-v1'))`;
async function available(tx: Tx) {
  const rows = await tx.$queryRaw<Array<{ name: string | null }>>`SELECT to_regclass('public.member_reward_events')::text AS name`;
  return !!rows[0]?.name;
}
export async function readMemberRewardPolicy(tx: Tx) {
  const row = await tx.siteSetting.findUnique({ where: { key: MEMBER_REWARD_POLICY_KEY } });
  return parseMemberRewardPolicy(row?.value);
}
export async function getReferralRewardOverview(tx: Tx, userId: string) {
  const { referral: rule } = await readMemberRewardPolicy(tx);
  const empty = { enabled: referralProgramActive(rule), registrationRewardCount: 0,
    registrationRewardLimit: rule.inviterRegistrationLimit, registrationRewardRemaining: rule.inviterRegistrationLimit, purchaseCouponCount: 0 };
  if (!await available(tx)) return empty;
  let owner: { id: string; joinedAt: Date };
  try { owner = await identity(tx, userId); }
  catch (error) { if (error instanceof Error && ["MEMBERSHIP_REQUIRED","MEMBER_PHONE_REQUIRED"].includes(error.message)) return empty; throw error; }
  const rows = await tx.$queryRaw<Array<{ registrationCount: bigint; couponCount: bigint }>>`SELECT
    count(*) FILTER(WHERE kind='REFERRAL_INVITER_REGISTRATION' AND state='SETTLED') AS "registrationCount",
    count(*) FILTER(WHERE kind='REFERRAL_PURCHASE' AND state='SETTLED') AS "couponCount"
    FROM member_reward_events WHERE recipient_identity=${owner.id} OR recipient_identity IN(SELECT identity FROM member_reward_identity_aliases WHERE canonical_identity=${owner.id})`;
  const registrationRewardCount = Number(rows[0]?.registrationCount ?? 0);
  return { ...empty, registrationRewardCount, registrationRewardRemaining: Math.max(0, rule.inviterRegistrationLimit - registrationRewardCount), purchaseCouponCount: Number(rows[0]?.couponCount ?? 0) };
}
async function identity(tx: Tx, userId: string, remember = false) {
  const user = await tx.user.findFirst({ where: { id: userId, role: "CUSTOMER", status: "ACTIVE" }, select: { id: true, phone: true } });
  const member = await tx.memberProfile.findUnique({ where: { userId }, select: { joinedAt: true } });
  if (!user?.phone || !member) throw Error("MEMBERSHIP_REQUIRED");
  const base = memberRewardPhoneIdentity(user.phone);
  const saved = await tx.$queryRaw<Array<{ identity: string }>>`SELECT identity FROM member_reward_account_identities WHERE user_id=${userId}`;
  const history = saved.length ? [] : await tx.$queryRaw<Array<{ identity: string }>>`SELECT identity FROM (
    SELECT recipient_identity AS identity,created_at FROM member_reward_events WHERE user_id=${userId}
    UNION ALL SELECT subject_identity AS identity,created_at FROM member_reward_events WHERE subject_user_id=${userId}) prior ORDER BY created_at ASC LIMIT 1`;
  const fixed = saved[0]?.identity ?? history[0]?.identity ?? base;
  const aliases = await tx.$queryRaw<Array<{ identity: string; canonical: string }>>`SELECT identity,canonical_identity AS canonical FROM member_reward_identity_aliases WHERE identity IN(${fixed},${base})`;
  const canonical = aliases.find(row => row.identity === fixed)?.canonical ?? fixed;
  if (remember) {
    // The account identity never follows later phone changes. A phone becomes
    // an alias of that identity, so changing numbers cannot reset reward caps,
    // while a future account using the same verified phone still shares limits.
    const group = Array.from(new Set([fixed,base,canonical,...aliases.flatMap(row => [row.identity,row.canonical])]));
    await tx.$executeRaw`UPDATE member_reward_identity_aliases SET canonical_identity=${canonical},updated_at=CURRENT_TIMESTAMP WHERE identity=ANY(${group}::text[]) OR canonical_identity=ANY(${group}::text[])`;
    for (const value of group) await tx.$executeRaw`INSERT INTO member_reward_identity_aliases(identity,canonical_identity) VALUES(${value},${canonical}) ON CONFLICT(identity) DO UPDATE SET canonical_identity=EXCLUDED.canonical_identity,updated_at=CURRENT_TIMESTAMP`;
    await tx.$executeRaw`INSERT INTO member_reward_account_identities(user_id,identity) VALUES(${userId},${fixed}) ON CONFLICT(user_id) DO NOTHING`;
  }
  return { id: canonical, joinedAt: member.joinedAt };
}
async function eventForSubject(tx: Tx, kind: string, subjectIdentity: string) {
  const rows = await tx.$queryRaw<RewardEvent[]>`SELECT id,event_key AS "eventKey",kind,recipient_identity AS "recipientIdentity",subject_identity AS "subjectIdentity",user_id AS "userId",subject_user_id AS "subjectUserId",source_id AS "sourceId",order_id AS "orderId",coupon_claim_id AS "couponClaimId",points,state,payload FROM member_reward_events
    WHERE kind=${kind} AND (subject_identity=${subjectIdentity} OR subject_identity IN(SELECT identity FROM member_reward_identity_aliases WHERE canonical_identity=${subjectIdentity})) ORDER BY created_at ASC LIMIT 1`;
  return rows[0] ?? null;
}
async function saveEvent(tx: Tx, event: Omit<RewardEvent, "id">) {
  const id = memberRewardEventId(event.eventKey);
  const inserted = await tx.$executeRaw`INSERT INTO member_reward_events(id,event_key,kind,recipient_identity,subject_identity,user_id,subject_user_id,source_id,order_id,coupon_claim_id,points,state,payload)
    VALUES(${id},${event.eventKey},${event.kind},${event.recipientIdentity},${event.subjectIdentity},${event.userId},${event.subjectUserId},${event.sourceId},${event.orderId},${event.couponClaimId},${event.points},${event.state},${JSON.stringify(event.payload)}::jsonb) ON CONFLICT(event_key) DO NOTHING`;
  if (inserted !== 1) throw Error("MEMBER_REWARD_EVENT_CHANGED");
  return id;
}
async function audit(tx: Tx, action: string, id: string, detail: Prisma.InputJsonObject) {
  await tx.auditLog.create({ data: { actorType: "system", action, targetType: "member-reward", targetId: id, detail } });
}

export async function settleReferralRegistration(tx: Tx, input: { inviteeId: string; inviterId: string; referralRecordId: string }) {
  const { referral: rule } = await readMemberRewardPolicy(tx);
  if (!referralProgramActive(rule) || !await available(tx)) return { enabled: false, newMemberPoints: 0, inviterPoints: 0 };
  await lock(tx);
  const [invitee, inviter] = await Promise.all([identity(tx, input.inviteeId, true), identity(tx, input.inviterId, true)]);
  if (input.inviteeId === input.inviterId || invitee.id === inviter.id) throw Error("MEMBER_OPERATIONS_INVALID_REFERRAL");
  const referrals = await tx.$queryRaw<Array<{ userId: string; inviterId: string; createdAt: Date }>>`SELECT user_id AS "userId",payload->>'inviterId' AS "inviterId",created_at AT TIME ZONE 'UTC' AS "createdAt" FROM member_operation_records WHERE id=${input.referralRecordId} AND kind='REFERRAL' AND state IN('PENDING','REWARDED')`;
  const referral = referrals[0];
  if (!referral || referral.userId !== input.inviteeId || referral.inviterId !== input.inviterId) throw Error("MEMBER_OPERATIONS_INVALID_REFERRAL");
  const activatedAt = new Date(rule.activatedAt!);
  if (referral.createdAt < activatedAt || invitee.joinedAt < activatedAt) return { enabled: true, newMemberPoints: 0, inviterPoints: 0, historical: true };
  const recipientEvent = `referral-v1:new-member:${invitee.id}`;
  let newMemberPoints = 0, inviterPoints = 0;
  if (!await eventForSubject(tx, "REFERRAL_NEW_MEMBER", invitee.id)) {
    const priorNewcomer = rule.newMemberRewardMode === "NEWCOMER_TOTAL"
      ? await tx.pointEntry.aggregate({ where: { userId: input.inviteeId, eventKey: { startsWith: "newcomer:" } }, _sum: { delta: true } }) : null;
    const existingJoiningPoints = Math.max(0, priorNewcomer?._sum.delta ?? 0);
    newMemberPoints = Math.max(0, rule.newMemberPoints - existingJoiningPoints);
    if (newMemberPoints > 0) await changeMemberPoints(tx, input.inviteeId, { eventKey: recipientEvent, delta: newMemberPoints, reason: "受邀新会员入会奖励" });
    const id = await saveEvent(tx, { eventKey: recipientEvent, kind: "REFERRAL_NEW_MEMBER", recipientIdentity: invitee.id,
      subjectIdentity: invitee.id, userId: input.inviteeId, subjectUserId: input.inviteeId, sourceId: input.referralRecordId,
      orderId: null, couponClaimId: null, points: newMemberPoints, state: "SETTLED", payload: { rule, existingJoiningPoints, inviterIdentity: inviter.id } });
    await audit(tx, "member.referral.new-member.rewarded", id, { points: newMemberPoints, existingJoiningPoints, referralRecordId: input.referralRecordId });
  }
  const inviterEvent = `referral-v1:inviter-registration:${invitee.id}`;
  if (!await eventForSubject(tx, "REFERRAL_INVITER_REGISTRATION", invitee.id)) {
    const totals = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM member_reward_events WHERE kind='REFERRAL_INVITER_REGISTRATION' AND (recipient_identity=${inviter.id} OR recipient_identity IN(SELECT identity FROM member_reward_identity_aliases WHERE canonical_identity=${inviter.id})) AND state='SETTLED'`;
    const withinLimit = Number(totals[0]?.count ?? 0) < rule.inviterRegistrationLimit;
    inviterPoints = withinLimit ? rule.inviterRegistrationPoints : 0;
    if (inviterPoints > 0) await changeMemberPoints(tx, input.inviterId, { eventKey: inviterEvent, delta: inviterPoints, reason: "邀请新会员入会奖励" });
    const id = await saveEvent(tx, { eventKey: inviterEvent, kind: "REFERRAL_INVITER_REGISTRATION", recipientIdentity: inviter.id,
      subjectIdentity: invitee.id, userId: input.inviterId, subjectUserId: input.inviteeId, sourceId: input.referralRecordId,
      orderId: null, couponClaimId: null, points: inviterPoints, state: withinLimit ? "SETTLED" : "SKIPPED_LIMIT", payload: { rule } });
    await audit(tx, "member.referral.inviter.rewarded", id, { points: inviterPoints, withinLimit, referralRecordId: input.referralRecordId });
  }
  return { enabled: true, newMemberPoints, inviterPoints };
}

export async function settleReferralPurchaseForOrder(tx: Tx, orderId: string) {
  const { referral: rule } = await readMemberRewardPolicy(tx);
  if (!referralProgramActive(rule) || !await available(tx)) return { rewarded: false };
  await lock(tx);
  const order = await tx.order.findUnique({ where: { id: orderId }, include: { refunds: { where: { refundStatus: "SUCCEEDED" }, select: { refundAmountCents: true } } } });
  if (!order || order.kind !== "STANDARD" || order.status !== "CONFIRMED" || order.fulfillmentStatus !== "DELIVERED" || !["PAID", "PARTIALLY_REFUNDED"].includes(order.paymentStatus)) return { rewarded: false };
  const refundedCents = order.refunds.reduce((sum, refund) => sum + refund.refundAmountCents, 0);
  if (referralNetGoodsCents(order, refundedCents) <= 0 || order.createdAt < new Date(rule.activatedAt!)) return { rewarded: false };
  const referrals = await tx.$queryRaw<Array<{ id: string; inviterId: string; createdAt: Date }>>`SELECT id,payload->>'inviterId' AS "inviterId",created_at AT TIME ZONE 'UTC' AS "createdAt" FROM member_operation_records WHERE kind='REFERRAL' AND user_id=${order.userId} AND subject_id='CURRENT' AND state IN('PENDING','REWARDED') ORDER BY created_at ASC LIMIT 1`;
  const referral = referrals[0];
  if (!referral || order.createdAt <= referral.createdAt || referral.createdAt < new Date(rule.activatedAt!)) return { rewarded: false };
  const [invitee, inviter] = await Promise.all([identity(tx, order.userId, true), identity(tx, referral.inviterId, true)]);
  if (invitee.joinedAt < new Date(rule.activatedAt!)) return { rewarded: false };
  if (order.userId === referral.inviterId || invitee.id === inviter.id) return { rewarded: false };
  const eventKey = `referral-v1:purchase:${invitee.id}`;
  const existing = await eventForSubject(tx, "REFERRAL_PURCHASE", invitee.id);
  if (existing) return { rewarded: existing.state === "SETTLED", replayed: true, couponClaimId: existing.couponClaimId };
  const templateId = rule.purchaseCouponTemplateId;
  const template = await tx.couponTemplate.findUnique({ where: { id: templateId } });
  if (!template || template.amountCents !== rule.purchaseCouponAmountCents || template.minimumCents !== rule.purchaseCouponMinimumCents || template.newcomerOnly || template.productIds.length || template.deliveryMode !== "REWARD") throw Error("MEMBER_REWARD_COUPON_UNAVAILABLE");
  const expiresAt = addUtcCalendarMonths(new Date(), rule.purchaseCouponValidityMonths);
  const coupon = await issueEventMemberCoupon(tx, { userId: referral.inviterId, templateId, eventKey, source: "REFERRAL", reason: "邀请好友完成消费，满600元减200元", expiresAt });
  const id = await saveEvent(tx, { eventKey, kind: "REFERRAL_PURCHASE", recipientIdentity: inviter.id, subjectIdentity: invitee.id,
    userId: referral.inviterId, subjectUserId: order.userId, sourceId: referral.id, orderId, couponClaimId: coupon.id,
    points: 0, state: "SETTLED", payload: { rule, expiresAt: expiresAt.toISOString(), netGoodsCents: referralNetGoodsCents(order, refundedCents) } });
  await audit(tx, "member.referral.purchase.rewarded", id, { orderId, couponClaimId: coupon.id, templateId });
  return { rewarded: true, replayed: false, couponClaimId: coupon.id };
}

export async function reconcileReferralRefund(tx: Tx, orderId: string) {
  if (!await available(tx)) return { reconciled: false };
  await lock(tx);
  const events = await tx.$queryRaw<RewardEvent[]>`SELECT id,event_key AS "eventKey",user_id AS "userId",coupon_claim_id AS "couponClaimId",state,payload FROM member_reward_events WHERE kind='REFERRAL_PURCHASE' AND order_id=${orderId} AND state IN('SETTLED','RECOVERY_REQUIRED')`;
  if (!events.length) return { reconciled: false };
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { payableAmountCents: true, shippingFeeCents: true } });
  if (!order) return { reconciled: false };
  const refunds = await tx.refund.aggregate({ where: { orderId, refundStatus: "SUCCEEDED" }, _sum: { refundAmountCents: true } });
  if (referralNetGoodsCents(order, refunds._sum.refundAmountCents ?? 0) > 0) return { reconciled: false };
  for (const event of events) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"member-coupon:" + event.userId}))`;
    const coupon = event.couponClaimId ? await tx.couponClaim.findUnique({ where: { id: event.couponClaimId }, include: { orders: { select: { id: true, paymentStatus: true } } } }) : null;
    let state = "VOIDED";
    if (coupon && !coupon.voided) {
      if (coupon.heldOrderId || coupon.orders.some(prior => ["PAID","REFUNDED","PARTIALLY_REFUNDED"].includes(prior.paymentStatus))) state = "RECOVERY_REQUIRED";
      else {
        const result = await tx.couponClaim.updateMany({ where: { id: coupon.id, userId: event.userId, voided: false, heldOrderId: null }, data: { voided: true } });
        if (result.count !== 1) throw Error("MEMBER_REWARD_COUPON_CHANGED");
      }
    }
    if (state !== event.state) {
      await tx.$executeRaw`UPDATE member_reward_events SET state=${state},payload=payload || ${JSON.stringify({ refundOrderId: orderId, invalidatedAt: new Date().toISOString() })}::jsonb,updated_at=CURRENT_TIMESTAMP WHERE id=${event.id} AND state IN('SETTLED','RECOVERY_REQUIRED')`;
      await audit(tx, state === "VOIDED" ? "member.referral.coupon.voided" : "member.referral.coupon.recovery-required", event.id, { orderId, couponClaimId: event.couponClaimId, state });
    }
  }
  return { reconciled: true };
}

export async function mergeMemberRewardIdentity(tx: Tx, sourceUserId: string, targetUserId: string) {
  if (sourceUserId === targetUserId || !await available(tx)) return;
  await lock(tx);
  const users = await tx.user.findMany({ where: { id: { in: [sourceUserId, targetUserId] } }, select: { id: true, phone: true } });
  const identities = await tx.$queryRaw<Array<{ identity: string }>>`SELECT DISTINCT recipient_identity AS identity FROM member_reward_events WHERE user_id IN(${sourceUserId},${targetUserId}) UNION SELECT DISTINCT subject_identity AS identity FROM member_reward_events WHERE subject_user_id IN(${sourceUserId},${targetUserId})`;
  const targetPhone = users.find(user => user.id === targetUserId)?.phone;
  const phoneIdentities = users.filter(user => !!user.phone && isMainlandPhone(normalizeMainlandPhone(user.phone!))).map(user => memberRewardPhoneIdentity(user.phone!));
  const allIdentities = Array.from(new Set([...phoneIdentities, ...identities.map(row => row.identity)]));
  if (allIdentities.length) {
    const preferred = targetPhone && isMainlandPhone(normalizeMainlandPhone(targetPhone)) ? memberRewardPhoneIdentity(targetPhone) : allIdentities[0];
    const aliases = await tx.$queryRaw<Array<{ identity: string; canonical: string }>>`SELECT identity,canonical_identity AS canonical FROM member_reward_identity_aliases WHERE identity=ANY(${allIdentities}::text[]) OR canonical_identity=ANY(${allIdentities}::text[])`;
    const canonical = aliases.find(row => row.identity === preferred)?.canonical ?? preferred;
    const group = Array.from(new Set([...allIdentities, ...aliases.flatMap(row => [row.identity, row.canonical]), canonical]));
    await tx.$executeRaw`UPDATE member_reward_identity_aliases SET canonical_identity=${canonical},updated_at=CURRENT_TIMESTAMP WHERE canonical_identity=ANY(${group}::text[]) OR identity=ANY(${group}::text[])`;
    for (const value of group) await tx.$executeRaw`INSERT INTO member_reward_identity_aliases(identity,canonical_identity) VALUES(${value},${canonical}) ON CONFLICT(identity) DO UPDATE SET canonical_identity=EXCLUDED.canonical_identity,updated_at=CURRENT_TIMESTAMP`;
    await tx.$executeRaw`INSERT INTO member_reward_account_identities(user_id,identity) VALUES(${targetUserId},${canonical}),(${sourceUserId},${canonical}) ON CONFLICT(user_id) DO NOTHING`;
  }
  await tx.$executeRaw`UPDATE member_reward_events SET user_id=${targetUserId},updated_at=CURRENT_TIMESTAMP WHERE user_id=${sourceUserId}`;
  await tx.$executeRaw`UPDATE member_reward_events SET subject_user_id=${targetUserId},updated_at=CURRENT_TIMESTAMP WHERE subject_user_id=${sourceUserId}`;
  const uploads = await tx.$queryRaw<Array<{ name: string | null }>>`SELECT to_regclass('public.member_social_uploads')::text AS name`;
  if (uploads[0]?.name) {
    const proofs = await tx.$queryRaw<Array<{ id: string; requestId: string }>>`SELECT id,request_id AS "requestId" FROM member_social_uploads WHERE user_id=${sourceUserId} ORDER BY created_at,id`;
    for (const proof of proofs) {
      const collision = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM member_social_uploads WHERE user_id=${targetUserId} AND request_id=${proof.requestId} LIMIT 1`;
      // Keep IDs, private filenames, checksums, purpose and application binding.
      // The prefix cannot be created by the public requestId input validator.
      const requestId = collision.length ? "merged:" + proof.id : proof.requestId;
      await tx.$executeRaw`UPDATE member_social_uploads SET user_id=${targetUserId},request_id=${requestId} WHERE id=${proof.id} AND user_id=${sourceUserId}`;
    }
  }
  const operations = await tx.$queryRaw<Array<{ name: string | null }>>`SELECT to_regclass('public.member_operation_records')::text AS name`;
  if (!operations[0]?.name) return;
  await tx.$executeRaw`UPDATE member_operation_records SET payload=jsonb_set(payload,'{inviterId}',to_jsonb(${targetUserId}::text)),revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE kind='REFERRAL' AND payload->>'inviterId'=${sourceUserId}`;
  // Retain old share codes. Aliasing their subject avoids collisions with the
  // target's CURRENT code and does not invalidate previously sent invitations.
  const records = await tx.$queryRaw<Array<{ id: string; kind: string; subjectId: string; state: string; payload: Record<string, unknown> }>>`SELECT id,kind,subject_id AS "subjectId",state,payload FROM member_operation_records WHERE user_id=${sourceUserId} ORDER BY created_at ASC,id ASC`;
  for (const record of records) {
    const collision = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM member_operation_records WHERE kind=${record.kind} AND user_id=${targetUserId} AND subject_id=${record.subjectId} LIMIT 1`;
    const subject = collision.length ? "MERGED:" + record.id : record.subjectId;
    const state = record.kind === "REFERRAL" && (collision.length || record.payload.inviterId === targetUserId) ? "REJECTED" : record.state;
    // Preserve IDs, payload source IDs, point ledger keys and historical values.
    // CLAIM rows still count toward limits after ownership changes, preventing
    // fresh awards merely because a phone-linked account was consolidated.
    await tx.$executeRaw`UPDATE member_operation_records SET user_id=${targetUserId},subject_id=${subject},state=${state},revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE id=${record.id}`;
  }
  await tx.$executeRaw`UPDATE member_operation_records SET state='REJECTED',revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE kind='REFERRAL' AND user_id=${targetUserId} AND payload->>'inviterId'=${targetUserId} AND state='PENDING'`;
}

export async function reconcilePendingReferralRewards(client: PrismaClient, limit = 25) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw Error("INVALID_MEMBER_REWARD_BATCH_LIMIT");
  const row = await client.siteSetting.findUnique({ where: { key: MEMBER_REWARD_POLICY_KEY } });
  const { referral: rule } = parseMemberRewardPolicy(row?.value);
  const summary = { examined: 0, registered: 0, rewarded: 0, reconciled: 0, retryRequired: 0 };
  const active = referralProgramActive(rule);
  const storage = await client.$queryRaw<Array<{ name: string | null }>>`SELECT to_regclass('public.member_reward_events')::text AS name`;
  if (!storage[0]?.name) return summary;
  const segmentLimit = active ? Math.max(1, Math.floor(limit / 3)) : 0;
  // Prisma's legacy commerce timestamps contain UTC wall time without a zone;
  // operation records have timestamptz. Compare explicit instants, regardless
  // of the database/session time zone or the raw Date parameter inference.
  const activatedAt = new Date(rule.activatedAt ?? 0).toISOString();
  const registrations = await client.$queryRaw<Array<{ id: string; inviteeId: string; inviterId: string }>>`SELECT r.id,r.user_id AS "inviteeId",r.payload->>'inviterId' AS "inviterId" FROM member_operation_records r JOIN member_profiles m ON m.user_id=r.user_id LEFT JOIN member_reward_account_identities ai ON ai.user_id=r.user_id LEFT JOIN member_reward_identity_aliases ia ON ia.identity=ai.identity
    WHERE r.kind='REFERRAL' AND r.subject_id='CURRENT' AND r.state IN('PENDING','REWARDED') AND r.created_at>=${activatedAt}::timestamptz AND (m.joined_at AT TIME ZONE 'UTC')>=${activatedAt}::timestamptz
      AND (NOT EXISTS(SELECT 1 FROM member_reward_events e WHERE e.kind='REFERRAL_NEW_MEMBER' AND (e.subject_user_id=r.user_id OR e.subject_identity=COALESCE(ia.canonical_identity,ai.identity) OR e.subject_identity IN(SELECT identity FROM member_reward_identity_aliases WHERE canonical_identity=COALESCE(ia.canonical_identity,ai.identity)))) OR NOT EXISTS(SELECT 1 FROM member_reward_events e WHERE e.kind='REFERRAL_INVITER_REGISTRATION' AND (e.subject_user_id=r.user_id OR e.subject_identity=COALESCE(ia.canonical_identity,ai.identity) OR e.subject_identity IN(SELECT identity FROM member_reward_identity_aliases WHERE canonical_identity=COALESCE(ia.canonical_identity,ai.identity)))))
    ORDER BY COALESCE((SELECT max(a.created_at) AT TIME ZONE 'UTC' FROM audit_logs a WHERE a.target_type='member-reward' AND a.target_id=r.id AND a.action='member.referral.registration.retry-required'),r.created_at) ASC,r.id ASC LIMIT ${segmentLimit}`;
  for (const binding of registrations) {
    const result = await client.$transaction(tx => safelySettleReferralRegistration(tx, { inviteeId: binding.inviteeId, inviterId: binding.inviterId, referralRecordId: binding.id }), { timeout: 15_000 });
    summary.examined++; if (result.newMemberPoints || result.inviterPoints) summary.registered++; if ("retryRequired" in result && result.retryRequired) summary.retryRequired++;
  }
  const purchaseLimit = Math.min(segmentLimit, Math.max(0, limit - summary.examined));
  const orders = await client.$queryRaw<Array<{ id: string }>>`SELECT o.id FROM orders o JOIN member_operation_records r ON r.user_id=o.user_id AND r.kind='REFERRAL' AND r.subject_id='CURRENT' AND r.state IN('PENDING','REWARDED') JOIN member_profiles m ON m.user_id=o.user_id LEFT JOIN member_reward_account_identities ai ON ai.user_id=o.user_id LEFT JOIN member_reward_identity_aliases ia ON ia.identity=ai.identity
    WHERE o.kind='STANDARD' AND o.status='CONFIRMED' AND o.payment_status='PAID' AND o.fulfillment_status='DELIVERED' AND (o.created_at AT TIME ZONE 'UTC')>r.created_at AND r.created_at>=${activatedAt}::timestamptz AND (o.created_at AT TIME ZONE 'UTC')>=${activatedAt}::timestamptz AND (m.joined_at AT TIME ZONE 'UTC')>=${activatedAt}::timestamptz
      AND o.payable_amount_cents-o.shipping_fee_cents-COALESCE((SELECT sum(f.refund_amount_cents) FROM refunds f WHERE f.order_id=o.id AND f.refund_status='SUCCEEDED'),0)>0
      AND NOT EXISTS(SELECT 1 FROM member_reward_events e WHERE e.kind='REFERRAL_PURCHASE' AND (e.subject_user_id=o.user_id OR e.subject_identity=COALESCE(ia.canonical_identity,ai.identity) OR e.subject_identity IN(SELECT identity FROM member_reward_identity_aliases WHERE canonical_identity=COALESCE(ia.canonical_identity,ai.identity))))
    ORDER BY COALESCE((SELECT max(a.created_at) AT TIME ZONE 'UTC' FROM audit_logs a WHERE a.target_type='member-reward' AND a.target_id=o.id AND a.action='member.referral.purchase.retry-required'),o.created_at AT TIME ZONE 'UTC') ASC,o.id ASC LIMIT ${purchaseLimit}`;
  for (const order of orders) {
    const result = await client.$transaction(tx => safelySettleReferralPurchase(tx, order.id), { timeout: 15_000 });
    summary.examined++; if (result.rewarded && !("replayed" in result && result.replayed)) summary.rewarded++; if ("retryRequired" in result && result.retryRequired) summary.retryRequired++;
  }
  const refundLimit = Math.max(0, limit - summary.examined);
  const refunds = await client.$queryRaw<Array<{ id: string }>>`SELECT DISTINCT e.order_id AS id,e.updated_at FROM member_reward_events e JOIN orders o ON o.id=e.order_id
    WHERE e.kind='REFERRAL_PURCHASE' AND e.state IN('SETTLED','RECOVERY_REQUIRED') AND o.payable_amount_cents-o.shipping_fee_cents-COALESCE((SELECT sum(f.refund_amount_cents) FROM refunds f WHERE f.order_id=o.id AND f.refund_status='SUCCEEDED'),0)<=0
    ORDER BY e.updated_at ASC LIMIT ${refundLimit}`;
  for (const order of refunds) {
    const result = await client.$transaction(tx => safelyReconcileReferralRefund(tx, order.id), { timeout: 15_000 });
    summary.examined++; if (result.reconciled) summary.reconciled++; if ("retryRequired" in result && result.retryRequired) summary.retryRequired++;
    await client.$executeRaw`UPDATE member_reward_events SET updated_at=CURRENT_TIMESTAMP WHERE kind='REFERRAL_PURCHASE' AND order_id=${order.id}`;
  }
  return summary;
}

export async function safelySettleReferralRegistration(tx: Tx, input: { inviteeId: string; inviterId: string; referralRecordId: string }) {
  await tx.$executeRawUnsafe("SAVEPOINT member_referral_registration");
  try {
    const result = await settleReferralRegistration(tx, input);
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT member_referral_registration");
    return result;
  } catch (error) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT member_referral_registration");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT member_referral_registration");
    await audit(tx, "member.referral.registration.retry-required", input.referralRecordId, { referralRecordId: input.referralRecordId, error: rewardErrorCode(error) });
    return { newMemberPoints: 0, inviterPoints: 0, retryRequired: true };
  }
}

// Optional benefits cannot turn a successful receipt/refund into a failed
// commerce operation. Roll back only this block and leave a durable retry audit.
export async function safelySettleReferralPurchase(tx: Tx, orderId: string) {
  await tx.$executeRawUnsafe("SAVEPOINT member_referral_purchase");
  try {
    const result = await settleReferralPurchaseForOrder(tx, orderId);
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT member_referral_purchase");
    return result;
  } catch (error) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT member_referral_purchase");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT member_referral_purchase");
    await audit(tx, "member.referral.purchase.retry-required", orderId, { orderId, error: rewardErrorCode(error) });
    return { rewarded: false, retryRequired: true };
  }
}

export async function safelyReconcileReferralRefund(tx: Tx, orderId: string) {
  await tx.$executeRawUnsafe("SAVEPOINT member_referral_refund");
  try {
    const result = await reconcileReferralRefund(tx, orderId);
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT member_referral_refund");
    return result;
  } catch (error) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT member_referral_refund");
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT member_referral_refund");
    await audit(tx, "member.referral.refund.retry-required", orderId, { orderId, error: rewardErrorCode(error) });
    return { reconciled: false, retryRequired: true };
  }
}

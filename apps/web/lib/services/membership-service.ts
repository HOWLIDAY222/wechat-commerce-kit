import {getMemberPromotions,getMemberPromotionsRule} from '@/lib/services/member-promotions-service';
import {isLongTermCoupon,redemptionLimit} from '@/lib/commerce/member-promotions';
import {changeMemberPoints,getPointsOverview,grantOrderPoints} from "@/lib/services/member-points-service";
import {firstPurchaseWhere} from '@/lib/commerce/newcomer';
import {getNewcomerRule,getNewcomerContext,getNewcomerOffer} from '@/lib/services/newcomer-service';
import {createHash} from 'node:crypto';
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { chooseCouponPricing } from "@/lib/commerce/coupon-pricing";
import { studentVerificationUnavailable, studentCertification, studentTestIdentitiesKey } from "@/lib/commerce/member-student";
import { memberCouponStatus } from "@/lib/commerce/member-coupon-status";

type Tx = Prisma.TransactionClient;
const settledPayment=(status:string)=>["PAID","REFUNDED","PARTIALLY_REFUNDED"].includes(status);
const defaultBenefits = ["在会员中心查看并领取可用优惠券", "优惠券与组合优惠自动择优使用", "统一管理订单、收货地址与售后记录"];

export async function memberTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(work, { isolationLevel: "Serializable" }); }
    catch (error) {
      if (attempt < 3 && error && typeof error === "object" && "code" in error && ["P2034", "P2002"].includes(String(error.code))) continue;
      throw error;
    }
  }
}

export async function getMemberBenefits() {
  const row = await prisma.siteSetting.findUnique({ where: { key: "memberBenefits" } });
  return Array.isArray(row?.value) && row.value.every(x => typeof x === "string") ? row.value as string[] : defaultBenefits;
}

export async function joinMembership(userId: string) {
  return memberTransaction(async tx => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.phone) throw new Error("MEMBER_PHONE_REQUIRED");
    const current = await tx.memberProfile.findUnique({ where: { userId } });
    if (current) return current;
    if(user.role!=="CUSTOMER"||user.status!=="ACTIVE")throw new Error("MEMBER_CUSTOMER_REQUIRED");
    const member = await tx.memberProfile.create({ data: { userId } });
    const newcomer=await getNewcomerRule(tx);
    if(newcomer.enabled){const offer=await getNewcomerOffer(userId,newcomer,tx);if(offer.status==='CLAIMABLE')await grantNewcomerBenefits(tx,userId);}
    else await issueAutomaticCoupons(tx,userId,'JOIN',newcomer.couponTemplateId);
    await tx.auditLog.create({ data: { actorId: userId, actorType: "user", action: "member.joined", targetType: "member", targetId: member.id } });
    return member;
  });
}

export async function getMemberOverview(userId: string,includeActor=false) {
  const now = new Date();
  const [member, benefits, claims, templates, paidOrder, products, newcomerRule, promotionsRule, redemptionCounts] = await Promise.all([
    prisma.memberProfile.findUnique({ where: { userId } }), getMemberBenefits(),
    prisma.couponClaim.findMany({ where: { userId }, include: { template: true, heldOrder: { select: { orderNo: true, paymentStatus: true } } }, orderBy: { claimedAt: "desc" }, take: 200 }),
    prisma.couponTemplate.findMany({ where: { active: true, startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: [{ endsAt: "asc" },{amountCents:"asc"}], take: 100 }),
    prisma.order.findFirst({ where: { userId, ...firstPurchaseWhere }, select: { id: true } }),
    prisma.product.findMany({ select: { id: true, name: true } }), getNewcomerRule(),getMemberPromotionsRule(),prisma.couponClaim.groupBy({by:["templateId","source"],where:{userId},_count:{_all:true}}),
  ]);
  const productNames = (ids: string[]) => ids.map(id => products.find(p => p.id === id)?.name || "指定商品");
  const wallet = claims.map(claim => ({
    id: claim.id, source:claim.source,pointsSpent:claim.pointsSpent, ...publicCoupon({...claim.template,endsAt:claim.expiresAt&&claim.expiresAt<claim.template.endsAt?claim.expiresAt:claim.template.endsAt}), productNames: productNames(claim.template.productIds), claimedAt: claim.claimedAt,
    orderNo: claim.heldOrder?.orderNo ?? null,
    status: memberCouponStatus(claim, now, !!paidOrder),
  }));
  const points=await getPointsOverview(userId,includeActor);
  const offer=(template:typeof templates[number])=>{const redemptionCount=redemptionCounts.find(c=>c.templateId===template.id&&c.source==='POINTS')?._count._all||0,perUserLimit=redemptionLimit(template.id,promotionsRule,newcomerRule),unlimitedRedemption=perUserLimit===null;return {...publicCoupon(template),productNames:productNames(template.productIds),claimed:template.deliveryMode==='POINTS'?perUserLimit!==null&&redemptionCount>=perUserLimit:redemptionCounts.some(c=>c.templateId===template.id),redemptionCount,perUserLimit,unlimitedRedemption,soldOut:!unlimitedRedemption&&template.issuedCount>=template.totalLimit,eligible:!template.newcomerOnly||!paidOrder,pointsCost:template.pointsCost,canAfford:points.balance>=template.pointsCost};};
  const promotions=await getMemberPromotions();
  return { promotions,newcomer:await getNewcomerOffer(userId,newcomerRule), points, rewards:templates.filter(t=>t.deliveryMode==='POINTS'&&(!promotionsRule.exchangeTemplateIds.includes(t.id)||promotionsRule.exchangeEnabled)).map(offer),member: member ? { joinedAt: member.joinedAt, memberNo: member.id, name: "品牌会员" } : null, benefits, wallet,
    available: templates.filter(t=>t.deliveryMode==='PUBLIC'&&(!promotionsRule.campaignTemplateIds.includes(t.id)||promotionsRule.campaignEnabled)).map(template => ({ ...publicCoupon(template), productNames: productNames(template.productIds),
      claimed: redemptionCounts.some(claim => claim.templateId === template.id), soldOut: template.issuedCount >= template.totalLimit,
      eligible: !template.newcomerOnly || !paidOrder,
    })), rules: "普通领取券每种每位会员限领一次；长期积分兑换按100积分兑换1元，积分足够可重复兑换，不受限时活动结束影响。其他积分券按对应上限执行。入会券与首单收货券在活动开放时按对应事件自动发放，不补发历史事件。与组合优惠不叠加，结算自动择优；同额优先保留优惠券。未支付订单取消后返券，有效期不延长；已支付订单退款后不返券。券不抵扣运费，商品实付最低 0.01 元。兑换成功即扣积分，长期兑换券长期有效；每单一张，不抵运费，不找零。其他券到期不退积分；后台撤回未使用的兑换券会返还兑换积分。" };
}

function publicCoupon(template: { id: string; title: string; amountCents: number; minimumCents: number; productIds: string[]; newcomerOnly: boolean; startsAt: Date; endsAt: Date }) {
  return { templateId: template.id, title: template.title, amountCents: template.amountCents, minimumCents: template.minimumCents,
    productIds: template.productIds, newcomerOnly: template.newcomerOnly, startsAt: template.startsAt, endsAt: template.endsAt,longTerm:isLongTermCoupon(template.endsAt) };
}

export async function claimMemberCoupon(userId: string, templateId: string) {
  return memberTransaction(tx=>issueMemberCoupon(tx,userId,templateId,'PUBLIC'));
}

export async function issueMemberCoupon(tx:Tx,userId:string,templateId:string,source:'PUBLIC'|'JOIN'|'FIRST_ORDER'|'MANUAL'|'POINTS',actorId?:string,reason?:string,requestId?:string){
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`member-coupon:${userId}`}))`;
  const member=await tx.memberProfile.findUnique({where:{userId},include:{user:{select:{role:true,status:true}}}});
  if(!member)throw Error('MEMBERSHIP_REQUIRED');
  if(member.user.role!=='CUSTOMER'||member.user.status!=='ACTIVE')throw Error('MEMBER_CUSTOMER_REQUIRED');
  const id='claim-'+createHash('sha256').update(source==='POINTS'?userId+':'+requestId:userId+':'+templateId).digest('hex');
  const replay=await tx.couponClaim.findUnique({where:{id}});
  if(replay){if(replay.userId!==userId||replay.templateId!==templateId)throw Error('MEMBER_REQUEST_CHANGED');return {id:replay.id,alreadyClaimed:true};}
  const existing=await tx.couponClaim.findFirst({where:{userId,templateId}}),promotions=await getMemberPromotionsRule(tx),managedExchange=source==='POINTS'&&promotions.exchangeTemplateIds.includes(templateId);
  if((managedExchange&&!promotions.exchangeEnabled)||(source==='PUBLIC'&&promotions.campaignTemplateIds.includes(templateId)&&!promotions.campaignEnabled))throw Error('COUPON_UNAVAILABLE');
  if(source==='POINTS'){const rule=await getNewcomerRule(tx),limit=redemptionLimit(templateId,promotions,rule);if(limit!==null&&await tx.couponClaim.count({where:{userId,templateId,source:'POINTS'}})>=limit)throw Error('COUPON_MEMBER_LIMIT');}
  else if(existing)return {id:existing.id,alreadyClaimed:true};
  const now=new Date(),template=await tx.couponTemplate.findUnique({where:{id:templateId}});
  if(!template||!template.active||template.startsAt>now||template.endsAt<=now)throw Error('COUPON_UNAVAILABLE');
  if(source==='MANUAL'?!['MANUAL','PUBLIC'].includes(template.deliveryMode):source!==template.deliveryMode)throw Error('COUPON_DELIVERY_FORBIDDEN');
  if(template.newcomerOnly&&await tx.order.findFirst({where:{userId,...firstPurchaseWhere}}))throw Error('COUPON_NEWCOMER_ONLY');
  if(source==='POINTS'){
    if(!requestId||template.pointsCost<=0)throw Error('INVALID_REDEMPTION');
    if(member.pointsBalance<template.pointsCost)throw Error('POINTS_INSUFFICIENT');
  }
  const reserved=await tx.couponTemplate.updateMany({where:{id:templateId,...(managedExchange?{}:{issuedCount:{lt:template.totalLimit}})},data:{issuedCount:{increment:1}}});
  if(reserved.count!==1)throw Error('COUPON_SOLD_OUT');
  if(source==='POINTS')await changeMemberPoints(tx,userId,{eventKey:'redeem:'+id,delta:-template.pointsCost,reason:'积分兑换：'+template.title});
  const claim=await tx.couponClaim.create({data:{id,userId,templateId,source,pointsSpent:source==='POINTS'?template.pointsCost:0}});
  await tx.auditLog.create({data:{actorId:actorId||userId,actorType:actorId?'admin':source==='PUBLIC'||source==='POINTS'?'user':'system',action:source==='POINTS'?'coupon.redeemed':'coupon.issued',targetType:'coupon',targetId:id,detail:{templateId,userId,source,pointsSpent:claim.pointsSpent,...(reason?{reason}:{})}}});
  return {id,alreadyClaimed:false};
}
// Trusted server events may issue the same reward template more than once. Each
// immutable event can issue only one coupon; public/manual issuance retains its
// existing per-template limits.
export async function issueEventMemberCoupon(tx:Tx,input:{userId:string;templateId:string;eventKey:string;source:'REFERRAL'|'STUDENT';reason:string;expiresAt?:Date|null}){
  if(!/^[A-Za-z0-9:_-]{8,300}$/.test(input.eventKey)||!['REFERRAL','STUDENT'].includes(input.source))throw Error('INVALID_MEMBER_REWARD_EVENT');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`member-coupon:${input.userId}`}))`;
  const member=await tx.memberProfile.findUnique({where:{userId:input.userId},include:{user:{select:{role:true,status:true}}}});
  if(!member)throw Error('MEMBERSHIP_REQUIRED');
  if(member.user.role!=='CUSTOMER'||member.user.status!=='ACTIVE')throw Error('MEMBER_CUSTOMER_REQUIRED');
  const id='reward-'+createHash('sha256').update(input.eventKey).digest('hex');
  const replay=await tx.couponClaim.findUnique({where:{id}});
  if(replay){if(replay.userId!==input.userId||replay.templateId!==input.templateId||replay.source!==input.source||(replay.expiresAt?.getTime()??null)!==(input.expiresAt?.getTime()??null))throw Error('MEMBER_REQUEST_CHANGED');return{id,alreadyClaimed:true};}
  if(input.source==='STUDENT'){
    const rows=await tx.$queryRaw<Array<{id:string;payload:Record<string,unknown>;updatedAt:Date}>>`SELECT id,payload,updated_at AT TIME ZONE 'UTC' AS "updatedAt" FROM member_operation_records WHERE user_id=${input.userId} AND kind='APPLICATION' AND state='APPROVED' AND payload->>'taskKey'='STUDENT' AND payload->>'proofVersion'='wechat-student-v1' ORDER BY created_at DESC LIMIT 1`;
    const row=rows[0],certification=row?studentCertification(row.payload,row.updatedAt):null;
    const tests=(await tx.siteSetting.findUnique({where:{key:studentTestIdentitiesKey}}))?.value;
    if(!row||!certification?.valid||!tests||typeof tests!=='object'||Array.isArray(tests)||!('identityHashes' in tests)||!Array.isArray(tests.identityHashes)||tests.identityHashes.includes(String(row.payload.identityHash))
      ||!Array.isArray(row.payload.couponTemplateIds)||!row.payload.couponTemplateIds.includes(input.templateId)
      ||input.eventKey!==`student:${row.id}:${certification.cycleId}:${input.templateId}`||input.expiresAt?.toISOString()!==certification.validUntil)throw studentVerificationUnavailable();
  }
  const now=new Date(),template=await tx.couponTemplate.findUnique({where:{id:input.templateId}});
  if(input.expiresAt&&(!Number.isFinite(input.expiresAt.getTime())||input.expiresAt<=now))throw Error('INVALID_MEMBER_REWARD_EXPIRY');
  if(!template||!template.active||template.startsAt>now||template.endsAt<=now||template.deliveryMode!=='REWARD'||template.newcomerOnly)throw Error('MEMBER_REWARD_COUPON_UNAVAILABLE');
  const reserved=await tx.couponTemplate.updateMany({where:{id:template.id,issuedCount:{lt:template.totalLimit}},data:{issuedCount:{increment:1}}});
  if(reserved.count!==1)throw Error('COUPON_SOLD_OUT');
  await tx.couponClaim.create({data:{id,userId:input.userId,templateId:template.id,source:input.source,pointsSpent:0,expiresAt:input.expiresAt??null}});
  await tx.auditLog.create({data:{actorType:'system',action:'member.reward.coupon.issued',targetType:'coupon',targetId:id,detail:{templateId:template.id,userId:input.userId,source:input.source,eventKey:input.eventKey,reason:input.reason}}});
  return{id,alreadyClaimed:false};
}
export async function redeemMemberCoupon(userId:string,templateId:string,requestId:string){return memberTransaction(tx=>issueMemberCoupon(tx,userId,templateId,'POINTS',undefined,undefined,requestId));}
export async function voidMemberCoupon(tx:Tx,claimId:string,actorId:string,reason:string){
  const first=await tx.couponClaim.findUnique({where:{id:claimId}});if(!first)throw Error('COUPON_UNAVAILABLE');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`member-coupon:${first.userId}`}))`;
  const claim=await tx.couponClaim.findUniqueOrThrow({where:{id:claimId}});
  if(claim.voided)return;
  if(claim.heldOrderId)throw Error('COUPON_IN_USE');
  const done=await tx.couponClaim.updateMany({where:{id:claimId,voided:false,heldOrderId:null},data:{voided:true}});if(done.count!==1)throw Error('COUPON_CHANGED');
  if(claim.pointsSpent>0)await changeMemberPoints(tx,claim.userId,{eventKey:'redeem-reversed:'+claim.id,delta:claim.pointsSpent,actorId,allowDebt:true,reason:'撤回兑换券返还积分：'+reason});
  await tx.auditLog.create({data:{actorId,actorType:'admin',action:'coupon.voided',targetType:'coupon',targetId:claimId,detail:{reason,returnedPoints:claim.pointsSpent}}});
}
async function issueAutomaticCoupons(tx:Tx,userId:string,mode:'JOIN'|'FIRST_ORDER',excludeId=''){
  const now=new Date(),templates=await tx.couponTemplate.findMany({where:{...(excludeId?{id:{not:excludeId}}:{}),deliveryMode:mode,active:true,startsAt:{lte:now},endsAt:{gt:now}},orderBy:{id:'asc'}});
  for(const t of templates){try{await issueMemberCoupon(tx,userId,t.id,mode);}catch(e){if(!(e instanceof Error)||!['COUPON_SOLD_OUT','COUPON_NEWCOMER_ONLY','COUPON_UNAVAILABLE'].includes(e.message))throw e;}}
}
export async function completeMemberOrder(tx:Tx,orderId:string){
  const order=await tx.order.findUniqueOrThrow({where:{id:orderId}});
  if(order.kind!=='STANDARD')return;
  if(order.fulfillmentStatus!=='DELIVERED'||!['PAID','PARTIALLY_REFUNDED'].includes(order.paymentStatus))return;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`member-coupon:${order.userId}`}))`;
  if(order.memberRewardsSettledAt)return;
  const settled=await tx.order.updateMany({where:{id:orderId,memberRewardsSettledAt:null},data:{memberRewardsSettledAt:new Date()}});
  if(settled.count!==1)return;
  await grantOrderPoints(tx,orderId);
  if(!await tx.memberProfile.findUnique({where:{userId:order.userId}}))return;
  if(await tx.order.findFirst({where:{userId:order.userId,id:{not:orderId},fulfillmentStatus:'DELIVERED',...firstPurchaseWhere}}))return;
  // The order snapshot distinguishes new flows; never backfill historical events.
  if(!order.memberPointsPolicy)return;
  await issueAutomaticCoupons(tx,order.userId,'FIRST_ORDER');
}

export async function getMemberPricing(tx: Tx, userId: string, items: Parameters<typeof chooseCouponPricing>[0], enabled: boolean) {
  if (!enabled) return chooseCouponPricing(items, []);
  const now = new Date();
  const [claims, paidOrder] = await Promise.all([
    tx.couponClaim.findMany({ where: { userId, voided: false, heldOrderId: null, OR:[{expiresAt:null},{expiresAt:{gt:now}}], template: { startsAt: { lte: now }, endsAt: { gt: now } } }, include: { template: true } }),
    tx.order.findFirst({ where: { userId, ...firstPurchaseWhere }, select: { id: true } }),
  ]);
  return chooseCouponPricing(items, claims.filter(c => !c.template.newcomerOnly || !paidOrder).map(c => ({ ...c.template, id: c.id, endsAt:c.expiresAt&&c.expiresAt<c.template.endsAt?c.expiresAt:c.template.endsAt })));
}

export async function holdMemberCoupon(tx: Tx, claimId: string | null, userId: string, orderId: string) {
  if (!claimId) return;
  const now=new Date();
  const result = await tx.couponClaim.updateMany({ where: { id: claimId, userId, heldOrderId: null, voided: false, OR:[{expiresAt:null},{expiresAt:{gt:now}}],template:{startsAt:{lte:now},endsAt:{gt:now}} }, data: { heldOrderId: orderId } });
  if (result.count !== 1) throw new Error("COUPON_CHANGED");
}

export async function releaseMemberCoupon(tx: Tx, orderId: string) {
  await tx.couponClaim.updateMany({ where: { heldOrderId: orderId }, data: { heldOrderId: null } });
}

export async function mergeMembership(tx: Tx, sourceUserId: string, targetUserId: string) {
  const {mergeMemberRewardIdentity}=await import('@/lib/services/member-automation-rewards-service');
  await mergeMemberRewardIdentity(tx,sourceUserId,targetUserId);
  const source = await tx.memberProfile.findUnique({ where: { userId: sourceUserId } });
  const target = await tx.memberProfile.findUnique({ where: { userId: targetUserId } });
  if (source && !target) await tx.memberProfile.update({ where: { id: source.id }, data: { userId: targetUserId } });
  if (source && target) {
    await tx.memberProfile.update({where:{userId:targetUserId},data:{pointsBalance:{increment:source.pointsBalance}}});
    if (source.joinedAt < target.joinedAt) await tx.memberProfile.update({ where: { id: target.id }, data: { joinedAt: source.joinedAt } });
    await tx.memberProfile.delete({ where: { id: source.id } });
  }
  await tx.pointEntry.updateMany({where:{userId:sourceUserId},data:{userId:targetUserId}});
  await tx.couponClaim.updateMany({ where: { userId: sourceUserId }, data: { userId: targetUserId } });
  const claims = await tx.couponClaim.findMany({ where: { userId: targetUserId, voided: false }, orderBy: { claimedAt: "asc" } });
  await tx.auditLog.updateMany({where:{action:'member.newcomer.granted',targetType:'newcomer',targetId:sourceUserId},data:{targetId:targetUserId}});
  const [newcomerRule,promotionsRule]=await Promise.all([getNewcomerRule(tx),getMemberPromotionsRule(tx)]);
  const retained=new Map<string,number>();for(const c of claims.filter(c=>c.heldOrderId))retained.set(c.templateId,(retained.get(c.templateId)||0)+1);
  for (const claim of claims.filter(c => !c.heldOrderId)) {
    // Different reward events legitimately issue multiple copies. Their
    // deterministic claim IDs already prevent duplicate event issuance.
    if(['REFERRAL','STUDENT'].includes(claim.source))continue;
    const limit=claim.source==='POINTS'?redemptionLimit(claim.templateId,promotionsRule,newcomerRule):1;
    if (limit!==null&&(retained.get(claim.templateId)||0)>=limit) {
      await tx.couponClaim.update({ where: { id: claim.id }, data: { voided: true } });
      if(claim.pointsSpent>0)await changeMemberPoints(tx,targetUserId,{eventKey:'merge-reversed:'+claim.id,delta:claim.pointsSpent,allowDebt:true,reason:'合并账户返还重复兑换券积分'});
    }
    else retained.set(claim.templateId,(retained.get(claim.templateId)||0)+1);
  }
}


export async function grantNewcomerBenefits(tx:Tx,userId:string){
  const rule=await getNewcomerRule(tx),initial=await getNewcomerContext(tx,userId);
  if(!initial.user?.phone)throw Error('MEMBER_PHONE_REQUIRED');
  if(initial.user.role!=='CUSTOMER'||initial.user.status!=='ACTIVE')throw Error('MEMBER_CUSTOMER_REQUIRED');
  if(!initial.member)throw Error('MEMBERSHIP_REQUIRED');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.phoneId}))`;
  const context=await getNewcomerContext(tx,userId);
  if(context.receipt){if(context.receipt.targetId!==userId)throw Error('NEWCOMER_ALREADY_CLAIMED');return {alreadyClaimed:true};}
  if(context.purchase)throw Error('COUPON_NEWCOMER_ONLY');
  if(!rule.enabled)throw Error('NEWCOMER_UNAVAILABLE');
  const offer=await getNewcomerOffer(userId,rule,tx);
  if(offer.status==='SOLD_OUT')throw Error('COUPON_SOLD_OUT');
  if(offer.status!=='CLAIMABLE')throw Error('NEWCOMER_UNAVAILABLE');
  const coupon=await issueMemberCoupon(tx,userId,rule.couponTemplateId,'JOIN');
  if(rule.bonusPoints>0)await changeMemberPoints(tx,userId,{eventKey:'newcomer:'+userId,delta:rule.bonusPoints,reason:'新客入会礼：赠送积分'});
  await tx.auditLog.create({data:{id:context.phoneId,actorId:userId,actorType:'user',action:'member.newcomer.granted',targetType:'newcomer',targetId:userId,detail:{couponClaimId:coupon.id,bonusPoints:rule.bonusPoints,rule}}});
  return {alreadyClaimed:false};
}
export async function claimNewcomerBenefits(userId:string){return memberTransaction(tx=>grantNewcomerBenefits(tx,userId));}

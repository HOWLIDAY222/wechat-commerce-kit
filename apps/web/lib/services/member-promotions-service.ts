import type {Prisma} from '@prisma/client';
import {prisma} from '@/lib/db/prisma';
import {campaignPhase,defaultMemberPromotions,memberPromotionsSchema,pointsDenominations,pointsPerYuan,isLongTermCoupon,type MemberPromotionsRule} from '@/lib/commerce/member-promotions';

type Tx=Prisma.TransactionClient;
export async function getMemberPromotionsRule(tx:Tx=prisma):Promise<MemberPromotionsRule>{
  const row=await tx.siteSetting.findUnique({where:{key:'memberPromotionsRule'}});
  const parsed=memberPromotionsSchema.safeParse(row?.value);
  return parsed.success?parsed.data:{...defaultMemberPromotions};
}
export async function getMemberPromotions(tx:Tx=prisma,now=new Date()){
  const rule=await getMemberPromotionsRule(tx);
  const templates=await tx.couponTemplate.findMany({where:{id:{in:[...rule.campaignTemplateIds,...rule.exchangeTemplateIds]}},orderBy:{amountCents:'asc'}});
  const campaign=templates.filter(t=>rule.campaignTemplateIds.includes(t.id)&&t.deliveryMode==='PUBLIC');
  const startsAt=campaign.length?new Date(Math.min(...campaign.map(t=>t.startsAt.getTime()))):null;
  const endsAt=campaign.length?new Date(Math.max(...campaign.map(t=>t.endsAt.getTime()))):null;
  const phase=campaignPhase(rule.campaignEnabled,startsAt,endsAt,now);
  const exchange=templates.filter(t=>rule.exchangeTemplateIds.includes(t.id)&&t.deliveryMode==='POINTS'&&t.active&&t.startsAt<=now&&t.endsAt>now);
  return {
    campaign:{enabled:rule.campaignEnabled,status:phase,visible:phase==='ACTIVE'&&campaign.some(t=>t.active&&t.startsAt<=now&&t.endsAt>now),startsAt:startsAt?.toISOString()??null,endsAt:endsAt?.toISOString()??null,
      tiers:campaign.map(t=>({templateId:t.id,minimumCents:t.minimumCents,amountCents:t.amountCents,active:t.active}))},
    exchange:{enabled:rule.exchangeEnabled,available:rule.exchangeEnabled&&exchange.length>0,pointsPerYuan,repeatable:true,longTerm:true,
      denominations:exchange.map(t=>({templateId:t.id,amountCents:t.amountCents,pointsCost:t.pointsCost}))},
  };
}
export async function saveMemberPromotions(tx:Tx,input:MemberPromotionsRule,actorId:string){
  const rule=memberPromotionsSchema.parse(input),before=await getMemberPromotionsRule(tx);
  if(new Set([...rule.campaignTemplateIds,...rule.exchangeTemplateIds]).size!==rule.campaignTemplateIds.length+rule.exchangeTemplateIds.length)throw Error('券种不能重复。');
  const templates=await tx.couponTemplate.findMany({where:{id:{in:[...rule.campaignTemplateIds,...rule.exchangeTemplateIds]}}});
  if(templates.length!==rule.campaignTemplateIds.length+rule.exchangeTemplateIds.length)throw Error('所选券种不存在，请刷新核对。');
  const campaigns=templates.filter(t=>rule.campaignTemplateIds.includes(t.id)),exchange=templates.filter(t=>rule.exchangeTemplateIds.includes(t.id));
  if(campaigns.some(t=>t.deliveryMode!=='PUBLIC'||t.newcomerOnly))throw Error('限时活动请选择全部会员可领的公开券。');
  if(exchange.some(t=>t.deliveryMode!=='POINTS'||t.newcomerOnly||t.minimumCents!==0||t.pointsCost!==t.amountCents||!isLongTermCoupon(t.endsAt)))throw Error('积分券须按100积分兑换1元，不设额外门槛，并长期有效。');
  if(rule.exchangeEnabled&&(exchange.length!==pointsDenominations.length||!pointsDenominations.every(value=>exchange.some(t=>t.amountCents===value*100))))throw Error('请配置5至50元、每档相差5元的全部兑换券。');
  if(rule.campaignEnabled&&(!campaigns.length||campaigns.some(t=>t.endsAt<=new Date())))throw Error('活动券已到期，无法重新开放领取。');
  if(rule.exchangeEnabled&&exchange.some(t=>t.startsAt>new Date()))throw Error('积分兑换券尚未到开始时间。');
  await tx.couponTemplate.updateMany({where:{id:{in:rule.campaignTemplateIds}},data:{active:rule.campaignEnabled}});
  await tx.couponTemplate.updateMany({where:{id:{in:rule.exchangeTemplateIds}},data:{active:rule.exchangeEnabled}});
  await tx.siteSetting.upsert({where:{key:'memberPromotionsRule'},create:{key:'memberPromotionsRule',value:rule},update:{value:rule}});
  await tx.auditLog.create({data:{actorId,actorType:'admin',action:'member.promotions.rule',targetType:'setting',targetId:'memberPromotionsRule',detail:{before,after:rule}}});
  return rule;
}

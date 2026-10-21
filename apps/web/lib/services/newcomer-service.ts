import {getMemberPromotionsRule} from '@/lib/services/member-promotions-service';
import {createHmac} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {prisma} from '@/lib/db/prisma';
import {appConfig} from '@/lib/config';
import {defaultNewcomerRule,newcomerRuleSchema,firstPurchaseWhere,type NewcomerRule} from '@/lib/commerce/newcomer';

type Tx=Prisma.TransactionClient;
export async function getNewcomerRule(tx:Tx=prisma):Promise<NewcomerRule>{
  const row=await tx.siteSetting.findUnique({where:{key:'memberNewcomerRule'}});
  const parsed=newcomerRuleSchema.safeParse(row?.value);
  return parsed.success?parsed.data:{...defaultNewcomerRule};
}
export function newcomerPhoneReceiptId(phone:string){
  const normalized=phone.replace(/\D/g,'').replace(/^86(?=\d{11}$)/,'');
  return 'newcomer-'+createHmac('sha256',appConfig.SESSION_SECRET).update(normalized).digest('hex');
}
export async function getNewcomerContext(tx:Tx,userId:string){
  const [user,member,purchase]=await Promise.all([
    tx.user.findUnique({where:{id:userId},select:{id:true,phone:true,role:true,status:true}}),
    tx.memberProfile.findUnique({where:{userId}}),
    tx.order.findFirst({where:{userId,...firstPurchaseWhere},select:{id:true}}),
  ]);
  const phoneId=user?.phone?newcomerPhoneReceiptId(user.phone):'';
  const receipt=await tx.auditLog.findFirst({where:{action:'member.newcomer.granted',OR:[...(phoneId?[{id:phoneId}]:[]),{targetType:'newcomer',targetId:userId}]}});
  return {user,member,purchase,receipt,phoneId};
}
export async function getNewcomerOffer(userId?:string,ruleInput?:NewcomerRule,tx:Tx=prisma){
  const rule=ruleInput??await getNewcomerRule(tx);
  const unavailable={enabled:false,visible:false,status:'UNAVAILABLE',bonusPoints:rule.bonusPoints};
  if(!rule.enabled||!rule.couponTemplateId)return unavailable;
  const template=await tx.couponTemplate.findUnique({where:{id:rule.couponTemplateId}}),now=new Date();
  if(!template||!template.active||template.deliveryMode!=='JOIN'||!template.newcomerOnly||template.startsAt>now||template.endsAt<=now)return unavailable;
  const promotions=await getMemberPromotionsRule(tx);
  const base={enabled:true,visible:true,bonusPoints:rule.bonusPoints,amountCents:template.amountCents,minimumCents:template.minimumCents,endsAt:template.endsAt.toISOString(),pointsCouponLimit:promotions.exchangeTemplateIds.includes(rule.pointsCouponTemplateId)?null:rule.pointsCouponLimit};
  const context=userId?await getNewcomerContext(tx,userId):null;
  if(context&&(!context.user?.phone||context.user.role!=='CUSTOMER'||context.user.status!=='ACTIVE'||context.purchase))return {...base,visible:false,status:'INELIGIBLE'};
  if(context?.receipt)return {...base,visible:context.receipt.targetId===userId,status:context.receipt.targetId===userId?'CLAIMED':'INELIGIBLE'};
  if(template.issuedCount>=template.totalLimit)return {...base,visible:false,status:'SOLD_OUT'};
  return {...base,status:!context?'LOGIN_REQUIRED':context.member?'CLAIMABLE':'JOIN_REQUIRED'};
}
export async function saveNewcomerRule(tx:Tx,input:NewcomerRule,actorId:string){
  const rule=newcomerRuleSchema.parse(input),before=await getNewcomerRule(tx);
  const [coupon,reward]=await Promise.all([
    rule.couponTemplateId?tx.couponTemplate.findUnique({where:{id:rule.couponTemplateId}}):null,
    rule.pointsCouponTemplateId?tx.couponTemplate.findUnique({where:{id:rule.pointsCouponTemplateId}}):null,
  ]);
  if(rule.couponTemplateId&&(!coupon||coupon.deliveryMode!=='JOIN'||!coupon.newcomerOnly))throw Error('请选择仅限首购的入会赠送券。');
  if(rule.pointsCouponTemplateId&&(!reward||reward.deliveryMode!=='POINTS'||reward.newcomerOnly||reward.pointsCost<=0))throw Error('请选择有效的积分兑换券。');
  if(rule.enabled){
    if(!coupon||!reward)throw Error('启用前请选择首单券和积分兑换券。');
    const promotions=await getMemberPromotionsRule(tx);
    if([coupon,reward].some(t=>t.endsAt<=new Date()||(!promotions.exchangeTemplateIds.includes(t.id)&&t.issuedCount>=t.totalLimit)))throw Error('所选优惠券已过期或已发完，请新建券种。');
    await tx.couponTemplate.updateMany({where:{id:{in:[coupon.id,...(promotions.exchangeTemplateIds.includes(reward.id)?[]:[reward.id])]}},data:{active:true}});
  }
  await tx.siteSetting.upsert({where:{key:'memberNewcomerRule'},create:{key:'memberNewcomerRule',value:rule},update:{value:rule}});
  await tx.auditLog.create({data:{actorId,actorType:'admin',action:'member.newcomer.rule',targetType:'setting',targetId:'memberNewcomerRule',detail:{before,after:rule}}});
  return rule;
}

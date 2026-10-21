import {z} from 'zod';

export const pointsDenominations=[5,10,15,20,25,30,35,40,45,50] as const;
export const pointsPerYuan=100;
export const longTermCouponEnd='9999-12-31T15:59:59.999Z';
export const memberPromotionsSchema=z.object({
  campaignEnabled:z.boolean().default(false),
  campaignTemplateIds:z.array(z.string().min(1)).max(20).default([]),
  exchangeEnabled:z.boolean().default(false),
  exchangeTemplateIds:z.array(z.string().min(1)).max(20).default([]),
});
export type MemberPromotionsRule=z.infer<typeof memberPromotionsSchema>;
export const defaultMemberPromotions:MemberPromotionsRule={campaignEnabled:false,campaignTemplateIds:[],exchangeEnabled:false,exchangeTemplateIds:[]};
export function isLongTermCoupon(endsAt:Date){return endsAt.getUTCFullYear()>=9999;}
export function redemptionLimit(templateId:string,promotions:MemberPromotionsRule,legacy:{pointsCouponTemplateId:string;pointsCouponLimit:number}):number|null{
  if(promotions.exchangeTemplateIds.includes(templateId))return null;
  return templateId===legacy.pointsCouponTemplateId?legacy.pointsCouponLimit:1;
}
export function campaignPhase(enabled:boolean,startsAt:Date|null,endsAt:Date|null,now=new Date()){
  if(!startsAt||!endsAt)return 'UNAVAILABLE';
  if(endsAt<=now)return 'ENDED';
  if(!enabled)return 'PAUSED';
  return startsAt>now?'UPCOMING':'ACTIVE';
}

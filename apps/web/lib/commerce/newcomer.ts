import {z} from 'zod';

export const newcomerRuleSchema=z.object({
  enabled:z.boolean(),bonusPoints:z.number().int().min(0).max(100000),
  couponTemplateId:z.string().trim().max(100),
  pointsCouponTemplateId:z.string().trim().max(100),
  pointsCouponLimit:z.number().int().min(1).max(20),
}).strict();
export type NewcomerRule=z.infer<typeof newcomerRuleSchema>;
export const defaultNewcomerRule:NewcomerRule={enabled:false,bonusPoints:1000,couponTemplateId:'',pointsCouponTemplateId:'',pointsCouponLimit:2};

/** Gift purchases and unpaid/cancelled orders do not consume a merchandise first purchase. */
export const firstPurchaseWhere={kind:'STANDARD',paymentStatus:{notIn:['NOT_STARTED','PENDING','FAILED','CANCELLED'] as Array<'NOT_STARTED'|'PENDING'|'FAILED'|'CANCELLED'>}};

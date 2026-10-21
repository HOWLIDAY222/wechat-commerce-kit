import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {prisma} from '@/lib/db/prisma';
type Tx=Prisma.TransactionClient;
export type PointsRule={enabled:boolean;centsPerPoint:number;startsAt:string};
export async function getPointsRule(tx:Tx=prisma):Promise<PointsRule>{const r=await tx.siteSetting.findUnique({where:{key:'memberPointsRule'}});const v=r?.value as Partial<PointsRule>|undefined;return{enabled:v?.enabled===true,centsPerPoint:Number.isSafeInteger(v?.centsPerPoint)&&Number(v?.centsPerPoint)>0?Number(v?.centsPerPoint):100,startsAt:typeof v?.startsAt==='string'?v.startsAt:new Date().toISOString()};}
export async function changeMemberPoints(tx:Tx,userId:string,input:{eventKey:string;delta:number;reason:string;actorId?:string;orderId?:string;basisCents?:number;allowDebt?:boolean}){
 const member=await tx.memberProfile.findUnique({where:{userId}});if(!member)throw Error('会员不存在。');
 await tx.memberProfile.update({where:{userId},data:{pointsBalance:{increment:0}}});
 const existing=await tx.pointEntry.findUnique({where:{eventKey:input.eventKey}});if(existing){if(existing.delta!==input.delta||existing.reason!==input.reason||existing.userId!==userId)throw Error('同一请求对应的积分资料发生变化，请刷新后操作。');return existing;}
 const current=await tx.memberProfile.findUniqueOrThrow({where:{userId}}),after=current.pointsBalance+input.delta;
 if(!Number.isSafeInteger(after)||Math.abs(after)>2000000000||(!input.allowDebt&&after<0))throw Error('可用积分不足或数值超出范围。');
 await tx.memberProfile.update({where:{userId},data:{pointsBalance:after}});
 const entry=await tx.pointEntry.create({data:{userId,eventKey:input.eventKey,delta:input.delta,balanceAfter:after,reason:input.reason,actorId:input.actorId,orderId:input.orderId,basisCents:input.basisCents}});
 await tx.auditLog.create({data:{actorId:input.actorId,actorType:input.actorId?'admin':'system',action:'member.points.changed',targetType:'member',targetId:userId,detail:{entryId:entry.id,before:current.pointsBalance,after,delta:input.delta,reason:input.reason,orderId:input.orderId}}});return entry;
}
export async function grantOrderPoints(tx:Tx,orderId:string){
 const key='paid:'+orderId;if(await tx.pointEntry.findUnique({where:{eventKey:key}}))return;
 const order=await tx.order.findUniqueOrThrow({where:{id:orderId}});
 if(order.kind!=='STANDARD')return;
 const policy=order.memberPointsPolicy as {version?:number;enabled?:boolean;centsPerPoint?:number}|null;
 const rule=policy?.version===2?{enabled:policy.enabled===true,centsPerPoint:policy.centsPerPoint||100,startsAt:order.createdAt.toISOString()}:await getPointsRule(tx);
 if(policy?.version===2 && (order.fulfillmentStatus!=='DELIVERED'||!['PAID','PARTIALLY_REFUNDED'].includes(order.paymentStatus)))return;
 const member=await tx.memberProfile.findUnique({where:{userId:order.userId}});
 if(!member||!rule.enabled||order.createdAt<new Date(rule.startsAt)||order.createdAt<member.joinedAt||['CANCELLED','CLOSED'].includes(order.status))return;
 const basis=policy?.version===2?Math.max(0,order.payableAmountCents-order.shippingFeeCents):order.payableAmountCents;
 const delta=Math.floor(basis/rule.centsPerPoint);if(delta<=0)return;
 await changeMemberPoints(tx,order.userId,{eventKey:key,delta,orderId,basisCents:order.payableAmountCents,reason:policy?.version===2?'订单确认收货获得积分（不含运费）':'订单付款获得积分',allowDebt:true});
 if(policy?.version===2)await reverseRefundPoints(tx,orderId);
}
export async function snapshotOrderPoints(tx:Tx,userId:string){const [rule,member]=await Promise.all([getPointsRule(tx),tx.memberProfile.findUnique({where:{userId}})]);return {version:2,enabled:rule.enabled&&!!member,centsPerPoint:rule.centsPerPoint};}
export async function reverseRefundPoints(tx:Tx,orderId:string){
 const earned=await tx.pointEntry.findUnique({where:{eventKey:'paid:'+orderId}});if(!earned?.basisCents)return;
 const sum=await tx.refund.aggregate({where:{orderId,refundStatus:'SUCCEEDED'},_sum:{refundAmountCents:true}}),refund=Math.min(earned.basisCents,sum._sum.refundAmountCents||0);
 const desired=Math.ceil(earned.delta*refund/earned.basisCents);
 await tx.memberProfile.update({where:{userId:earned.userId},data:{pointsBalance:{increment:0}}});
 const reversed=await tx.pointEntry.aggregate({where:{orderId,eventKey:{startsWith:'refund:'}},_sum:{delta:true}});
 const delta=-desired-(reversed._sum.delta||0);if(delta>=0)return;
 await changeMemberPoints(tx,earned.userId,{eventKey:'refund:'+orderId+':'+refund,delta,orderId,reason:'成功退款退回已获积分',allowDebt:true});
}
export async function adjustMemberPoints(tx:Tx,userId:string,input:{requestId:string;delta:number;reason:string},actorId:string){if(!Number.isSafeInteger(input.delta)||!input.delta||Math.abs(input.delta)>1000000||input.reason.trim().length<2)throw Error('请填写有效积分和调整原因。');return changeMemberPoints(tx,userId,{eventKey:'manual:'+createHash('sha256').update(actorId+':'+input.requestId).digest('hex'),delta:input.delta,reason:input.reason.trim(),actorId});}
export async function getPointsOverview(userId:string,includeActor=false){const [member,entries,rule]=await Promise.all([prisma.memberProfile.findUnique({where:{userId}}),prisma.pointEntry.findMany({where:{userId},orderBy:[{createdAt:'desc'},{id:'desc'}],take:100}),getPointsRule()]);return{balance:member?.pointsBalance||0,entries:entries.map(({id,delta,balanceAfter,reason,orderId,createdAt,actorId})=>({id,delta,balanceAfter,reason,orderId,createdAt,actorId:includeActor?actorId:undefined})),rule,description:'新订单按创建时有效规则，在确认收货后按商品实付金额（不含运费）累计，不足一积分舍去。退款按累计退款占订单实付比例扣回，向上取整；不足时记负数，由后续积分抵补。历史积分保留原规则。可兑换活动开放的优惠券，不能充值、提现或直接抵扣货款。'};}

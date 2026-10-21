import {getMemberPromotionsRule,saveMemberPromotions} from '@/lib/services/member-promotions-service';
import {newcomerRuleSchema} from '@/lib/commerce/newcomer';
import {saveNewcomerRule} from '@/lib/services/newcomer-service';
import {createHash} from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import {memberTransaction,issueMemberCoupon,voidMemberCoupon} from "@/lib/services/membership-service";

const schema = z.discriminatedUnion("action", [
  z.object({action:z.literal("promotions"),campaignEnabled:z.boolean(),exchangeEnabled:z.boolean()}),
  z.object({action:z.literal("newcomerRule"),rule:newcomerRuleSchema}),
  z.object({action:z.literal("issue"),userId:z.string().min(1),templateId:z.string().min(1),reason:z.string().trim().min(2).max(200)}),
  z.object({action:z.literal("void"),claimId:z.string().min(1),reason:z.string().trim().min(2).max(200)}),
  z.object({ action: z.literal("benefits"), benefits: z.array(z.string().trim().min(1).max(100)).min(1).max(8) }),
  z.object({ action: z.literal("toggle"), id: z.string().min(1), active: z.boolean() }),
  z.object({ action: z.literal("create"), requestId:z.string().uuid(), title: z.string().trim().min(2).max(60), amountCents: z.number().int().min(1).max(100000),
    minimumCents: z.number().int().min(0).max(10000000), productIds: z.array(z.string().min(1)).max(100), newcomerOnly: z.boolean(),
    deliveryMode:z.enum(["PUBLIC","JOIN","FIRST_ORDER","MANUAL","POINTS"]).default("PUBLIC"), pointsCost:z.number().int().min(0).max(1000000).default(0),
    startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), totalLimit: z.number().int().min(1).max(100000) }),
]);

export async function POST(request: Request) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "请先登录后台。" }, { status: 401 });
  if (session.role !== "owner") return NextResponse.json({ ok: false, error: "优惠与权益设置仅限负责人操作。" }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "请检查必填项、金额和有效期。" }, { status: 400 });
  const input = parsed.data;
  try {
    await memberTransaction(async tx => {
      if(input.action==="promotions"){const rule=await getMemberPromotionsRule(tx);await saveMemberPromotions(tx,{...rule,campaignEnabled:input.campaignEnabled,exchangeEnabled:input.exchangeEnabled},session.userId);return;}
      if(input.action==="newcomerRule"){await saveNewcomerRule(tx,input.rule,session.userId);return;}
      if(input.action==="issue"){await issueMemberCoupon(tx,input.userId,input.templateId,"MANUAL",session.userId,input.reason);return;}
      if(input.action==="void"){await voidMemberCoupon(tx,input.claimId,session.userId,input.reason);return;}
      let targetId = "memberBenefits";
      if (input.action === "benefits") {
        await tx.siteSetting.upsert({ where: { key: targetId }, create: { key: targetId, value: input.benefits }, update: { value: input.benefits } });
      } else if (input.action === "toggle") {
        const template = await tx.couponTemplate.findUnique({ where: { id: input.id } });
        if (!template) throw new Error("优惠券不存在。");
        if (input.active && template.endsAt <= new Date()) throw new Error("已过期的优惠券不能开放领取。");
        await tx.couponTemplate.update({ where: { id: input.id }, data: { active: input.active } });
        targetId = input.id;
      } else {
        targetId='coupon-'+createHash('sha256').update(session.userId+':'+input.requestId).digest('hex');
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${targetId}))`;
        const existing=await tx.couponTemplate.findUnique({where:{id:targetId}});
        if(existing){const audit=await tx.auditLog.findFirst({where:{targetId,action:'membership.create'}});if(JSON.stringify(audit?.detail)!==JSON.stringify(JSON.parse(JSON.stringify(input)))){
          const old=audit?.detail as Record<string,unknown>|null;const same=old&&Object.keys(input).every(k=>JSON.stringify(old[k])===JSON.stringify(input[k as keyof typeof input]));if(!same)throw Error('同一次保存的资料已变化，请刷新后重试。');
        }return;}
        if (new Date(input.endsAt) <= new Date(input.startsAt) || new Date(input.endsAt) <= new Date()) throw new Error("结束时间应晚于开始时间和当前时间。");
        if((input.deliveryMode==='POINTS')!==(input.pointsCost>0))throw Error('积分兑换券须填写正整数积分，其他发放方式积分应为0。');
        if(['FIRST_ORDER','POINTS'].includes(input.deliveryMode)&&input.newcomerOnly)throw Error('复购券和积分兑换券不能限制为首购。');
        const productIds = [...new Set(input.productIds)];
        if (await tx.product.count({ where: { id: { in: productIds } } }) !== productIds.length) throw new Error("适用商品已变化，请刷新后重试。");
        const { action: _action, requestId: _requestId, ...data } = input;
        void _requestId;
        void _action;
        const template = await tx.couponTemplate.create({ data: { ...data, id:targetId, productIds, startsAt: new Date(data.startsAt), endsAt: new Date(data.endsAt), active: false } });
        targetId = template.id;
      }
      await tx.auditLog.create({ data: { actorId: session.userId, actorType: "admin", action: `membership.${input.action}`, targetType: "membership", targetId, detail: input } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const labels:Record<string,string>={MEMBERSHIP_REQUIRED:"该用户尚未加入会员。",COUPON_UNAVAILABLE:"优惠券未开放、未开始或已过期。",COUPON_IN_USE:"优惠券已被订单占用或使用，请先查看关联订单。",COUPON_NEWCOMER_ONLY:"该会员不符合首购条件。",COUPON_SOLD_OUT:"优惠券发放额度已用完。",COUPON_CHANGED:"优惠券状态已变化，请刷新。",COUPON_DELIVERY_FORBIDDEN:"只能手动发放公开领取券或指定会员券。",MEMBER_CUSTOMER_REQUIRED:"仅支持有效的普通顾客会员。"};
    return NextResponse.json({ ok: false, error: labels[message]||(/[\u4e00-\u9fff]/.test(message) ? message : "保存失败，请刷新后重试。") }, { status: 400 });
  }
}

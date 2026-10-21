import {PromotionsPanel} from './promotions-panel';
import {getMemberPromotions,getMemberPromotionsRule} from '@/lib/services/member-promotions-service';
import {isLongTermCoupon} from '@/lib/commerce/member-promotions';
import {PointsPanel} from "./points-panel";
import {NewcomerPanel} from './newcomer-panel';
import {getNewcomerRule} from '@/lib/services/newcomer-service';
import {getPointsRule} from "@/lib/services/member-points-service";
import {MemberDirectory} from "./member-directory";
import { redirect } from "next/navigation";
import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";
import { getMemberBenefits } from "@/lib/services/membership-service";
import { MembershipPanel } from "./panel";
import { memberCouponStatus, memberCouponStatusLabels, memberCouponSourceLabels } from "@/lib/commerce/member-coupon-status";
import { getMemberRewardCouponPresentation } from "@/lib/services/member-reward-coupon-presentation";

export const dynamic = "force-dynamic";
export const metadata = { title: "会员与优惠券 | MerchantKit" };
export default async function MembershipPage({searchParams}:{searchParams:Promise<{q?:string;memberId?:string;page?:string}>}) {
  const params=await searchParams;
  const session = await readCurrentAdminSession();
  if (!session) redirect("/admin/login");
  const [pointsRule,newcomerRule,promotionsRule,promotions,rewardCouponRules]=await Promise.all([getPointsRule(),getNewcomerRule(),getMemberPromotionsRule(),getMemberPromotions(),getMemberRewardCouponPresentation()]);
  const [members, templates, claims, products, benefits] = await Promise.all([
    prisma.memberProfile.count(),
    prisma.couponTemplate.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.couponClaim.findMany({ orderBy: { claimedAt: "desc" }, take: 100, include: { template: { select: { title: true, endsAt: true } }, heldOrder: { select: { orderNo: true, paymentStatus: true } } } }),
    prisma.product.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }), getMemberBenefits(),
  ]);
  return <AdminFrame active="membership" title="会员与优惠券" subtitle="官网和小程序会员权益、领券规则与使用记录，在这里统一管理。" metrics={[{ label: "会员人数", value: String(members) }, { label: "券种（最近 100 项）", value: String(templates.length) }]}>
    <PromotionsPanel owner={session.role==="owner"} rule={promotionsRule} summary={promotions}/><>{session.role==="owner" && <><NewcomerPanel rule={newcomerRule} templates={templates.map(t=>({...t,endsAt:t.endsAt.toISOString(),unlimitedRedemption:promotionsRule.exchangeTemplateIds.includes(t.id)}))}/><PointsPanel rule={pointsRule}/></>}</><MemberDirectory owner={session.role==="owner"} q={params.q} memberId={params.memberId} page={Number(params.page||1)}/><MembershipPanel owner={session.role === "owner"} products={products} benefits={benefits} templates={templates.map(t => ({ ...t,rewardCondition:rewardCouponRules[t.id]?.condition,rewardValidity:rewardCouponRules[t.id]?.validity,longTerm:isLongTermCoupon(t.endsAt),unlimitedRedemption:promotionsRule.exchangeTemplateIds.includes(t.id), startsAt: t.startsAt.toISOString(), endsAt: t.endsAt.toISOString(), createdAt: t.createdAt.toISOString() }))} />
    <section className="mt-5 overflow-x-auto rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">最近 100 条领券与使用记录</h2>
      <table className="mt-4 w-full text-left text-sm"><thead><tr><th className="p-2">优惠券</th><th>会员</th><th>发放方式 / 积分</th><th>领取时间</th><th>状态</th><th>订单</th></tr></thead><tbody>{claims.map(c => <tr key={c.id} className="border-t border-slate-100"><td className="p-2">{c.template.title}</td><td><a className="underline" href={"/admin/membership?memberId="+encodeURIComponent(c.userId)+"#member-assets"}>查看会员 …{c.userId.slice(-8)}</a></td><td>{memberCouponSourceLabels[c.source]||c.source}{c.pointsSpent>0?` · ${c.pointsSpent} 积分`:""}</td><td>{c.claimedAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</td><td>{memberCouponStatusLabels[memberCouponStatus(c)]}</td><td>{c.heldOrder ? <a className="text-blue-700 underline" href={`/admin/orders/${c.heldOrder.orderNo}`}>{c.heldOrder.orderNo}</a> : "—"}</td></tr>)}</tbody></table>
      {!claims.length && <p className="mt-4 text-sm text-slate-500">暂无领取记录。</p>}
    </section>
  </AdminFrame>;
}

import {redirect} from 'next/navigation';
import Link from 'next/link';
import {AdminFrame} from '@/app/admin/_components/admin-frame';
import {readCurrentAdminSession} from '@/lib/auth/session';
import {prisma} from '@/lib/db/prisma';
import {parseQuantityPricing} from '@/lib/commerce/quantity-pricing';
import {GIFT_STATUS_LABELS,readGiftSnapshot} from '@/lib/commerce/gift-card';
import {GiftPanel,GiftRefundAction} from './panel';
import {RefundTaskForm} from '@/app/admin/after-sales/refund-task-form';
export const dynamic='force-dynamic';
export const metadata={title:'商品礼品卡 | MerchantKit'};
export default async function GiftsPage({searchParams}:{searchParams:Promise<{q?:string}>}){
  const session=await readCurrentAdminSession();if(!session)redirect('/admin/login');
  const q=(await searchParams).q?.trim().slice(0,40)||'',owner=session.role==='owner';
  const [templates,products,cards,customers]=await Promise.all([
    prisma.giftCardTemplate.findMany({orderBy:{createdAt:'desc'},take:100}),
    prisma.product.findMany({where:{status:'ACTIVE'},select:{id:true,name:true,quantityPricing:true}}),
    prisma.giftCard.findMany({orderBy:{createdAt:'desc'},take:100,include:{sender:{select:{name:true}},recipient:{select:{name:true}},purchaseOrder:{select:{orderNo:true,refunds:{orderBy:{createdAt:'desc'},take:1,select:{refundNo:true,refundStatus:true,refundAmountCents:true,paymentRefundId:true}}}},redemptionOrder:{select:{orderNo:true,fulfillmentStatus:true}}}}),
    owner&&q?prisma.user.findMany({where:{role:'CUSTOMER',status:'ACTIVE',OR:[{phone:{contains:q}},{name:{contains:q}}]},select:{id:true,name:true,phone:true},take:30}):Promise.resolve([]),
  ]);
  return <AdminFrame active="gifts" title="商品礼品卡" subtitle="管理固定商品赠礼、领取与兑换发货。" metrics={[{label:'方案',value:String(templates.length)},{label:'已启用',value:String(templates.filter(t=>t.active).length)},{label:'最近发卡',value:String(cards.length)}]}>
    <GiftPanel owner={owner} customers={customers} products={products.map(p=>({id:p.id,name:p.name,styles:(parseQuantityPricing(p.quantityPricing)?.styles||[]).map(s=>({key:s.key,label:s.label}))}))} templates={templates.map(t=>{const s=readGiftSnapshot(t.snapshot);return {id:t.id,title:t.title,amountCents:t.amountCents,active:t.active,description:`${s.productName} · ${s.styleName} · ${s.color} · ${s.quantity} 条`};})}/>
    <section className="mt-5 rounded-lg border border-slate-200 bg-white p-5"><div className="mb-4 flex flex-wrap justify-between gap-3"><h2 className="font-bold">最近 100 张礼品卡</h2><p className="text-sm text-slate-500">退款在对应卡片内核对与执行</p></div><div className="grid gap-4 lg:grid-cols-2">{cards.map(c=>{const s=readGiftSnapshot(c.snapshot);return <article key={c.id} className="min-w-0 rounded border border-slate-200 p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{s.productName} · {s.styleName} · {s.quantity} 条</h3><span className="text-sm">{GIFT_STATUS_LABELS[c.status]||c.status}</span></div><dl className="mt-3 grid gap-2 text-sm text-slate-600"><div>卡号：{c.id.slice(-12).toUpperCase()} · {c.purchaseOrder?'付款购买':'后台赠送'}</div><div>赠礼人：{c.sender.name} · 收礼人：{c.recipient?.name||'尚未领取'}</div>{c.purchaseOrder?<div><Link className="underline" href={`/admin/orders/${c.purchaseOrder.orderNo}`}>购买订单 {c.purchaseOrder.orderNo}</Link></div>:null}{c.redemptionOrder?<div><Link className="underline" href={`/admin/orders/${c.redemptionOrder.orderNo}`}>兑换发货订单 {c.redemptionOrder.orderNo}</Link> · {({PENDING:'待处理',PROCESSING:'处理中',SHIPPED:'已发货',DELIVERED:'已收货',RETURNED:'已退回'} as Record<string,string>)[c.redemptionOrder.fulfillmentStatus]}</div>:null}<div>{c.createdAt.toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</div></dl>{owner&&['READY','CLAIMED'].includes(c.status)?<GiftRefundAction id={c.id} complimentary={!c.purchaseOrder}/>:null}{c.purchaseOrder?.refunds.map(r=><div key={r.refundNo} className="mt-4"><p className="mb-2 text-sm">退款金额 ¥{(r.refundAmountCents/100).toFixed(2)}</p><RefundTaskForm canExecuteProviderRefund={owner} refundNo={r.refundNo} status={r.refundStatus} paymentRefundId={r.paymentRefundId}/></div>)}</article>;})}</div>{!cards.length?<p className="text-sm text-slate-500">暂无发卡记录。创建草稿不会发卡，也不会扣库存。</p>:null}</section>
  </AdminFrame>;
}

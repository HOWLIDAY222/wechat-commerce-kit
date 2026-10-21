"use client";
import {useRef,useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import type {NewcomerRule} from '@/lib/commerce/newcomer';

type Template={id:string;title:string;deliveryMode:string;newcomerOnly:boolean;pointsCost:number;active:boolean;endsAt:string;unlimitedRedemption?:boolean};
const field='mt-1 min-h-11 w-full rounded border border-slate-300 bg-white px-3 py-2';
export function NewcomerPanel({rule,templates}:{rule:NewcomerRule;templates:Template[]}){
  const router=useRouter(),lock=useRef(false);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[pointsTemplateId,setPointsTemplateId]=useState(rule.pointsCouponTemplateId);
  const repeatable=templates.find(t=>t.id===pointsTemplateId)?.unlimitedRedemption===true;
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(lock.current)return;
    const values=new FormData(event.currentTarget),input={enabled:values.get('enabled')==='on',bonusPoints:Number(values.get('bonusPoints')),couponTemplateId:String(values.get('couponTemplateId')||''),pointsCouponTemplateId:String(values.get('pointsCouponTemplateId')||''),pointsCouponLimit:Number(values.get('pointsCouponLimit')||rule.pointsCouponLimit)};
    lock.current=true;setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/admin/membership',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'newcomerRule',rule:input})}),data=await response.json();
      if(!response.ok||!data.ok)throw Error(data.error||'保存失败，请刷新核对。');
      setMessage(input.enabled?'新客礼已启用，未首购会员可领取一次；长期积分兑换按独立开关生效。':'新客礼已暂停发放，已领券和积分继续有效。');router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:'连接中断，请刷新核对保存结果。');}
    finally{lock.current=false;setBusy(false);}
  }
  return <form onSubmit={save} id="newcomer-settings" className="my-5 grid gap-4 rounded-lg border border-slate-200 bg-white p-5">
    <div><h2 className="font-bold">新客首单礼</h2><p className="mt-2 text-sm leading-7 text-slate-600">从未成功支付普通商品订单的顾客，按会员账号和手机号各限领取一次。已入会未首购的会员也可主动领取。付款后退款不会恢复首购资格；未支付、取消和礼品卡订单不占首购资格。</p></div>
    <fieldset disabled={busy} className="grid gap-4 md:grid-cols-2">
      <label className="md:col-span-2"><input name="enabled" type="checkbox" defaultChecked={rule.enabled}/> 开启首单券与新客赠分</label>
      <label>一次性赠送积分<input className={field} name="bonusPoints" type="number" min={0} max={100000} step={1} defaultValue={rule.bonusPoints} required/></label>
      <label>首单券<select className={field} name="couponTemplateId" defaultValue={rule.couponTemplateId}><option value="">请选择首购入会券</option>{templates.filter(t=>t.deliveryMode==='JOIN'&&t.newcomerOnly).map(t=><option key={t.id} value={t.id}>{t.title}{new Date(t.endsAt)<=new Date()?'（已过期）':''}</option>)}</select></label>
      <label>积分兑换券<select className={field} name="pointsCouponTemplateId" value={pointsTemplateId} onChange={event=>setPointsTemplateId(event.target.value)}><option value="">请选择兑换券</option>{templates.filter(t=>t.deliveryMode==='POINTS'&&!t.newcomerOnly).map(t=><option key={t.id} value={t.id}>{t.title} · {t.pointsCost} 积分{new Date(t.endsAt)<=new Date()?'（已过期）':''}</option>)}</select></label>
      <label>所选兑换券的次数规则{repeatable?<p className="mt-2 text-sm leading-7 text-slate-600">积分足够可重复兑换，按上方长期兑换开关生效。</p>:<input className={field} name="pointsCouponLimit" type="number" min={1} max={20} step={1} defaultValue={rule.pointsCouponLimit} required/>}</label>
    </fieldset>
    <p className="text-sm leading-7 text-slate-600">启用会开放首单券；长期积分兑换使用上方独立开关。领取与赠分在同一次操作中完成，重复点击不会重复到账；不会批量给历史账号补发。优惠券不叠加，每单一张，与组合价自动择优。非长期兑换券的限兑次数包含已使用和已撤回记录。首单收货赠券及订单积分可在下方分别管理。</p>
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
    <button className="min-h-11 rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" disabled={busy}>{busy?'正在保存':'保存新客礼设置'}</button>
  </form>;
}

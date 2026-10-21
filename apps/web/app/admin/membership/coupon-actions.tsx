"use client";
import {useRef,useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';

type Offer={id:string;title:string;amountCents:number;minimumCents:number};
export function CouponActions({userId,claimId,pointsSpent=0,offers=[]}:{userId?:string;claimId?:string;pointsSpent?:number;offers?:Offer[]}){
 const router=useRouter(),lock=useRef(false);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function submit(e:FormEvent<HTMLFormElement>){
  e.preventDefault();if(lock.current)return;
  const form=e.currentTarget,f=new FormData(form),reason=String(f.get('reason')||'').trim();
  if(!window.confirm(claimId?`确认撤回这张未使用的券？${pointsSpent>0?`返还 ${pointsSpent} 积分。`:''}`:'确认向此会员发放所选优惠券？同一券种限发一次。'))return;
  lock.current=true;setBusy(true);setMessage('');
  try{
   const r=await fetch('/api/admin/membership',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(claimId?{action:'void',claimId,reason}:{action:'issue',userId,templateId:f.get('templateId'),reason})});
   const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'操作未完成');
   setMessage(claimId?'已撤回，积分返还与原因可在流水中查看。':'发放已确认，可在下方卡包和使用记录中查看。');form.reset();router.refresh();
  }catch(e){setMessage(e instanceof Error?e.message:'连接中断，请刷新核对结果。');}
  finally{lock.current=false;setBusy(false);}
 }
 if(!claimId&&!offers.length)return <p className="my-4 text-sm text-slate-500">暂无可手动发放的券。先创建“后台指定会员”或“会员主动领取”券并启用活动。</p>;
 return <form onSubmit={submit} className="my-4 grid gap-3 rounded border border-slate-200 p-4">
  <h4 className="font-bold">{claimId?'撤回未使用优惠券':'向此会员发券'}</h4>
  {!claimId&&<label>优惠券<select className="mt-1 w-full rounded border p-3" name="templateId" required disabled={busy}><option value="">请选择已启用的券</option>{offers.map(o=><option key={o.id} value={o.id}>{o.title} · 满 {(o.minimumCents/100).toFixed(2)} 减 {(o.amountCents/100).toFixed(2)}</option>)}</select></label>}
  <label>操作原因<input className="mt-1 w-full rounded border p-3" name="reason" minLength={2} maxLength={200} required disabled={busy}/></label>
  {pointsSpent>0&&<p className="text-sm">撤回后返还 {pointsSpent} 积分；本券种仍不能再次兑换。</p>}
  <button className="vk-button vk-button-dark" disabled={busy}>{busy?'处理中':claimId?'确认撤回':'发放优惠券'}</button><p role="status">{message}</p>
 </form>;
}

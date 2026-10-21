"use client";
import {useRef,useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import type {MemberPromotionsRule} from '@/lib/commerce/member-promotions';
import type {getMemberPromotions} from '@/lib/services/member-promotions-service';

type Summary=Awaited<ReturnType<typeof getMemberPromotions>>;
const date=(value:string|null)=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚未配置';
export function PromotionsPanel({owner,rule,summary}:{owner:boolean;rule:MemberPromotionsRule;summary:Summary}){
  const router=useRouter(),lock=useRef(false);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [campaignEnabled,setCampaignEnabled]=useState(rule.campaignEnabled&&summary.campaign.status!=='ENDED');
  const [exchangeEnabled,setExchangeEnabled]=useState(rule.exchangeEnabled);
  async function save(event:FormEvent){
    event.preventDefault();if(lock.current)return;lock.current=true;setBusy(true);setMessage('');
    try{
      const response=await fetch('/api/admin/membership',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'promotions',campaignEnabled,exchangeEnabled})});
      const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'保存失败，请刷新核对。');
      setMessage('设置已保存。限时券领取与长期积分兑换分别生效，已领券按原有效期继续使用。');router.refresh();
    }catch(error){setMessage(error instanceof Error?error.message:'连接中断，请刷新核对。');}
    finally{lock.current=false;setBusy(false);}
  }
  return <form id="member-promotions-settings" className="my-5 grid gap-4 rounded-lg border border-slate-200 bg-white p-5" onSubmit={save}>
    <h2 className="font-bold">限时活动与长期积分兑换</h2>
    <fieldset disabled={!owner||busy} className="grid gap-4">
      <label><input type="checkbox" name="campaignEnabled" checked={campaignEnabled} onChange={event=>setCampaignEnabled(event.target.checked)} disabled={!owner||busy||summary.campaign.status==='ENDED'}/> 开放限时活动券领取</label>
      <p className="text-sm text-slate-600">{date(summary.campaign.startsAt)} 至 {date(summary.campaign.endsAt)}（北京时间）。到期自动停止领取与使用，不影响积分兑换。</p>
      <div className="flex flex-wrap gap-3">{summary.campaign.tiers.map(t=><span key={t.templateId} className="rounded bg-slate-50 px-3 py-2 text-sm">满{t.minimumCents/100}减{t.amountCents/100}</span>)}</div>
      <label><input type="checkbox" name="exchangeEnabled" checked={exchangeEnabled} onChange={event=>setExchangeEnabled(event.target.checked)}/> 开放长期积分兑换</label>
      <p className="text-sm leading-7 text-slate-600">100积分兑换1元；5、10、15、20、25、30、35、40、45、50元券分别需要500至5000积分。积分足够可重复兑换，不设额外满减门槛，兑换券长期有效，不随限时活动结束而关闭。</p>
    </fieldset>
    <p className="text-sm leading-7 text-slate-600">活动券全部会员可领，每档每人一次。每单只用一张券，与组合价自动择优，不叠加；不抵运费、不找零，商品实付最低0.01元。暂停只停止新领取或新兑换，已领券按原有效期使用。</p>
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
    {owner&&<button className="min-h-11 rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-40" disabled={busy}>{busy?'正在保存':'保存活动与兑换设置'}</button>}
  </form>;
}

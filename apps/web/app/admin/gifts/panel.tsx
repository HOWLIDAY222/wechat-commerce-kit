'use client';
import {useRef,useState,useTransition,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';

type Template={id:string;title:string;amountCents:number;active:boolean;description:string};
type Product={id:string;name:string;styles:{key:string;label:string}[]};
type Customer={id:string;name:string;phone:string|null};
export function GiftPanel({templates,products,customers,owner}:{templates:Template[];products:Product[];customers:Customer[];owner:boolean}){
  const router=useRouter(),lock=useRef(false),requests=useRef<Record<string,string>>({});
  const [saving,setBusy]=useState(false),[message,setMessage]=useState(''),[refreshing,startTransition]=useTransition();
  const busy=saving||refreshing;
  async function post(input:Record<string,unknown>,confirmation?:string){
    if(lock.current||(confirmation&&!window.confirm(confirmation)))return;
    lock.current=true;setBusy(true);setMessage('');
    const name=String(input.action),fingerprint=JSON.stringify(input);
    if(name==='create'||name==='issue')input.requestId=requests.current[fingerprint]||=(crypto.randomUUID());
    try{
      const response=await fetch('/api/admin/gifts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
      const result=await response.json();if(!response.ok||!result.ok)throw Error(result.error||'操作未完成。');
      delete requests.current[fingerprint];setMessage('已保存。');startTransition(()=>router.refresh());
    }catch(error){setMessage(error instanceof Error?error.message:'连接中断，请刷新核对结果。');}
    finally{lock.current=false;setBusy(false);}
  }
  function create(event:FormEvent<HTMLFormElement>){event.preventDefault();const f=new FormData(event.currentTarget),[productId,style]=String(f.get('spec')).split(':');
    void post({action:'create',title:f.get('title'),productId,style,quantity:Number(f.get('quantity'))});}
  function issue(event:FormEvent<HTMLFormElement>){event.preventDefault();const f=new FormData(event.currentTarget);
    void post({action:'issue',templateId:f.get('templateId'),userId:f.get('userId'),reason:f.get('reason')},'确认免费发放这份固定商品礼品卡？这会产生可兑换实物的权益，但不会启用公开销售。');}
  return <div className="space-y-5">
    <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-7">每张卡固定商品、款式和条数，收礼人领取后选择同一尺码、填写地址。价格按现有组合价生成，运费按收礼地址另计。无储值余额；不使用优惠券、不累计购物积分。暂停销售不影响已发卡兑换。</p>
    {owner?<form onSubmit={create} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-5 md:grid-cols-2">
      <h2 className="font-bold md:col-span-2">新建礼品卡草稿</h2>
      <label>名称<input name="title" className="mt-1 w-full rounded border p-3" required minLength={2} maxLength={60} placeholder="例如：X1 Air 常规款一条礼品卡" disabled={busy}/></label>
      <label>商品与款式<select name="spec" className="mt-1 w-full rounded border p-3" required disabled={busy}><option value="">请选择</option>{products.flatMap(p=>p.styles.map(s=><option key={`${p.id}:${s.key}`} value={`${p.id}:${s.key}`}>{p.name} · {s.label}</option>))}</select></label>
      <label>固定条数<input name="quantity" type="number" className="mt-1 w-full rounded border p-3" defaultValue={1} min={1} max={99} required disabled={busy}/></label>
      <p className="self-center text-sm text-slate-500">保存后显示价格；草稿不会出现在小程序购买列表。</p>
      <button className="vk-button vk-button-dark md:col-span-2" disabled={busy}>保存草稿</button>
    </form>:null}
    <section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="mb-4 font-bold">礼品卡方案</h2><div className="grid gap-4 md:grid-cols-2">{templates.map(t=><article key={t.id} className="rounded border border-slate-200 p-4"><div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">{t.title}</h3><span className="text-sm text-slate-500">{t.active?'销售中':'草稿／暂停销售'}</span></div><p className="my-2 text-sm text-slate-500">{t.description}</p><p className="mb-3 text-xl font-semibold">¥{(t.amountCents/100).toFixed(2)}</p>{owner?<button disabled={busy} className="vk-button vk-button-dark" onClick={()=>post({action:'toggle',id:t.id,active:!t.active},t.active?'确认暂停新购买？已发卡仍可正常领取与兑换。':'确认公开销售此礼品卡？小程序顾客将能真实付款购买。')}>{t.active?'暂停销售':'启用销售'}</button>:null}</article>)}</div>{!templates.length?<p className="text-sm text-slate-500">暂无方案，请先保存草稿。</p>:null}</section>
    {owner&&templates.length?<section className="rounded-lg border border-slate-200 bg-white p-5"><h2 className="font-bold">指定账号发放</h2><p className="my-2 text-sm text-slate-500">可用于测试或赠礼；不启用公开销售。每次提交均记录原因。</p><form action="/admin/gifts" className="my-4 flex flex-wrap gap-2"><label className="flex-1">查找顾客<input className="mt-1 w-full rounded border p-3" name="q" placeholder="手机号或姓名" maxLength={40}/></label><button className="vk-button self-end">查找</button></form><form onSubmit={issue} className="grid gap-3 md:grid-cols-2">
      <label>发到哪个账号<select name="userId" className="mt-1 w-full rounded border p-3" required disabled={busy}><option value="">请选择查找结果</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name} · {c.phone||'未绑定手机号'}</option>)}</select></label>
      <label>礼品卡<select name="templateId" className="mt-1 w-full rounded border p-3" required disabled={busy}><option value="">请选择</option>{templates.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}</select></label>
      <label className="md:col-span-2">发放原因<input className="mt-1 w-full rounded border p-3" name="reason" minLength={2} maxLength={200} required disabled={busy}/></label><button className="vk-button vk-button-dark md:col-span-2" disabled={busy}>确认免费发放</button>
    </form></section>:null}
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
  </div>;
}
export function GiftRefundAction({id,complimentary}:{id:string;complimentary:boolean}){
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');const router=useRouter();
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(busy)return;const reason=String(new FormData(event.currentTarget).get('reason')||'');
    if(!window.confirm(complimentary?'确认撤回这张尚未兑换的赠送卡？':'确认冻结礼品卡并创建原路退款申请？退款须在对应卡片下由负责人核对并执行。'))return;
    setBusy(true);try{const r=await fetch('/api/admin/gifts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'refund',id,reason})});const d=await r.json();if(!r.ok||!d.ok)throw Error(d.error||'操作未完成');setMessage(d.refundNo?`已创建退款申请 ${d.refundNo}`:'已撤回。');router.refresh();}catch(e){setMessage(e instanceof Error?e.message:'请刷新核对状态。');}finally{setBusy(false);}}
  return <form onSubmit={submit} className="mt-3 flex flex-wrap gap-2"><label className="sr-only" htmlFor={`reason-${id}`}>操作原因</label><input id={`reason-${id}`} name="reason" placeholder="操作原因" minLength={2} maxLength={200} required className="min-w-0 flex-1 rounded border p-2" disabled={busy}/><button className="rounded border px-3 py-2 text-sm" disabled={busy}>{complimentary?'撤回赠送卡':'创建退款申请'}</button><p role="status" className="w-full text-sm">{message}</p></form>;
}

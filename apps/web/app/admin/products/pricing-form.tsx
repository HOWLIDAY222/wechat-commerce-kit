"use client";
import {useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {parseQuantityPricing,assertQuantityPricingFitsSkus,quantityTotal} from '@/lib/commerce/quantity-pricing';
import {useAdminSubmit} from '@/lib/client/use-admin-submit';
import {formatAdminActionError} from '@/lib/client/admin-error-message';
export function ProductPricingForm({product}:{product:{id:string;quantityPricing?:unknown;skus:Array<{id:string;status:string;priceCents:number}>}}){
 const router=useRouter(),pricing=parseQuantityPricing(product.quantityPricing),active=product.skus.filter(s=>s.status==='ACTIVE');
 const [enabled,setEnabled]=useState(Boolean(pricing)),[repeatBundles,setRepeatBundles]=useState(Boolean(pricing?.repeatBundles));
 const [unit,setUnit]=useState(''),[maximum,setMaximum]=useState(pricing?.maxQuantity??4);
 const [compare,setCompare]=useState(pricing?.compareAtUnitPriceCents?String(pricing.compareAtUnitPriceCents/100):'');
 const [tiers,setTiers]=useState((pricing?.tiers??[]).map(t=>({quantity:t.quantity,price:String(t.totalPriceCents/100)})));
 const [styles,setStyles]=useState((pricing?.styles??[]).map(s=>({...s,unit:String(s.unitPriceCents/100),rows:s.tiers.map(t=>({quantity:t.quantity,price:String(t.totalPriceCents/100)}))})));
 const [status,setStatus]=useState<{tone:'idle'|'success'|'error';message:string}>({tone:'idle',message:''});
 const {busy,guard}=useAdminSubmit(setStatus);
 const cents=(v:string)=>{if(!/^\d+(\.\d{1,2})?$/.test(v)||Number(v)<=0)throw Error('价格须大于 0，最多两位小数。');return Math.round(Number(v)*100);};
 async function save(e:FormEvent<HTMLFormElement>){
  e.preventDefault();
  if(styles.length&&!enabled)throw Error('商品已有款式，请保留款式价格方案；暂停销售请使用商品上下架操作。');
  const parsedStyles=styles.map(s=>({key:s.key,label:s.label,summary:s.summary,unitPriceCents:cents(s.unit),tiers:s.rows.map(t=>({quantity:t.quantity,totalPriceCents:cents(t.price)}))}));
  const unitPriceCents=parsedStyles.length?parsedStyles[0].unitPriceCents:unit?cents(unit):undefined;
  const quantityPricing=enabled?{maxQuantity:maximum,repeatBundles,compareAtUnitPriceCents:compare?cents(compare):undefined,tiers:parsedStyles[0]?.tiers??tiers.map(t=>({quantity:t.quantity,totalPriceCents:cents(t.price)})),...(parsedStyles.length?{styles:parsedStyles}:{})}:null;
  assertQuantityPricingFitsSkus(quantityPricing,active.map(s=>({...s,priceCents:unitPriceCents??s.priceCents})));
  if(!window.confirm('确认保存款式单价与组合优惠？官网和小程序将使用新价格，已生成订单价格保持不变。'))return;
  const response=await fetch('/api/admin/products/'+encodeURIComponent(product.id)+'/pricing',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({unitPriceCents,quantityPricing})});const result=await response.json();
  if(!response.ok||!result.ok)throw Error(formatAdminActionError(result.error,response.status,'价格保存'));
  setStatus({tone:'success',message:'价格方案已保存。两款按尺码共用库存，组合优惠按款式分别计算。'});router.refresh();
 }
 const rows=(items:typeof tiers,change:(v:typeof tiers)=>void)=><div className="grid gap-3">{items.map((t,i)=><div className="flex flex-wrap items-end gap-3" key={i}><label className="vk-field">条数<input type="number" min="2" max={Math.min(20,maximum)} value={t.quantity} onChange={e=>change(items.map((v,j)=>i===j?{...v,quantity:Number(e.target.value)}:v))}/></label><label className="vk-field">组合总价（元）<input required inputMode="decimal" value={t.price} onChange={e=>change(items.map((v,j)=>i===j?{...v,price:e.target.value}:v))}/></label><button type="button" className="vk-button vk-button-light" onClick={()=>change(items.filter((_,j)=>j!==i))}>移除</button></div>)}<button type="button" className="vk-button vk-button-light w-fit" disabled={items.length>=Math.min(20,maximum)-1} onClick={()=>{const q=Array.from({length:Math.max(0,Math.min(20,maximum)-1)},(_,i)=>i+2).find(q=>!items.some(t=>t.quantity===q));if(q)change([...items,{quantity:q,price:''}]);}}>添加组合</button></div>;
 return <form id="pricing" className="mt-4 grid gap-4 rounded border bg-white p-5 scroll-mt-24" onSubmit={guard(save)}>
  <h2 className="text-xl font-black">款式与组合价格</h2><p className="text-sm">白色 · 按尺码管理库存。常规款和升级款共用对应尺码的库存；同款不同尺码可合并享组合价，不同款式分别计价。</p>
  <label className="vk-field">每款每单最多条数<input type="number" min="1" max="99" value={maximum} onChange={e=>setMaximum(Number(e.target.value))}/></label>
  <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={repeatBundles} onChange={e=>setRepeatBundles(e.target.checked)}/>数量超过组合档位时，自动重复使用现有组合并选择最省总价</label><p className="text-xs text-slate-600">选购上限与组合档位分别设置。例如保留两、三、四条价格，五条以上也可以购买；仍受对应尺码共用库存限制。</p>
  {styles.length?styles.map((s,i)=><fieldset className="grid gap-3 rounded border p-4" key={s.key}><legend className="px-2 font-bold">{s.label}</legend><label className="vk-field">款式名称<input required value={s.label} onChange={e=>setStyles(v=>v.map((x,j)=>j===i?{...x,label:e.target.value}:x))}/></label><label className="vk-field">款式说明<input value={s.summary} onChange={e=>setStyles(v=>v.map((x,j)=>j===i?{...x,summary:e.target.value}:x))}/></label><label className="vk-field">单条售价（元）<input required inputMode="decimal" value={s.unit} onChange={e=>setStyles(v=>v.map((x,j)=>j===i?{...x,unit:e.target.value}:x))}/></label>{rows(s.rows,items=>setStyles(v=>v.map((x,j)=>j===i?{...x,rows:items}:x)))}<p className="text-sm">价格预览：{[1,...s.rows.map(t=>t.quantity),...(repeatBundles?[5,8].filter(q=>q<=maximum&&!s.rows.some(t=>t.quantity===q)):[])].sort((a,b)=>a-b).map(q=>{try{return q+'条 ¥'+quantityTotal(cents(s.unit),q,{maxQuantity:maximum,repeatBundles,tiers:s.rows.map(t=>({quantity:t.quantity,totalPriceCents:cents(t.price)}))})/100;}catch{return q+'条 待填写价格';}}).join(' · ')}</p></fieldset>):<><label className="vk-field">统一单价（元，留空保留现价）<input inputMode="decimal" value={unit} onChange={e=>setUnit(e.target.value)}/></label><label className="vk-field">参考单价（元，可留空）<input inputMode="decimal" value={compare} onChange={e=>setCompare(e.target.value)}/></label><label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>启用组合优惠</label>{enabled?rows(tiers,setTiers):null}</>}
  <button className="vk-button vk-button-dark w-fit" disabled={busy||!active.length}>{busy?'保存中…':'保存完整价格方案'}</button><p role="status" className={status.tone==='error'?'text-red-700':'text-slate-600'}>{status.message}</p>
 </form>;
}

"use client";
import {useRef,useState,type FormEvent} from 'react';
import {useRouter} from 'next/navigation';
import {fulfillmentActions} from '@/lib/commerce/admin-operations';
import {formatAdminActionError} from '@/lib/client/admin-error-message';
export function OrderFulfillmentForm({orderStatus,paymentStatus,fulfillmentStatus,orderNo,trackingCompany,trackingNo}:{orderStatus:string;paymentStatus:string;fulfillmentStatus:string;orderNo:string;trackingCompany?:string|null;trackingNo?:string|null}) {
 const router=useRouter(), inFlight=useRef(false);
 const allowed=fulfillmentActions({status:orderStatus,paymentStatus,fulfillmentStatus});
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault(); if(inFlight.current) return;
  const form=new FormData(event.currentTarget), submitter=(event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement|null;
  const action=submitter?.value;
  if(!(action==='ship'&&allowed.ship||action==='deliver'&&allowed.deliver||action==='correct_tracking'&&allowed.correct)) return;
  const trackingCompany=String(form.get('trackingCompany')??'').trim(),trackingNo=String(form.get('trackingNo')??'').trim(),note=String(form.get('note')??'').trim();
  if(action!=='deliver'&&(!trackingCompany||!trackingNo)){setMessage('请填写物流公司和运单号。');setFailed(true);return;}
  if(action==='correct_tracking'&&!note){setMessage('请填写更正运单的原因。');setFailed(true);return;}
  if(!window.confirm(action==='deliver'?'确认包裹已经签收？':action==='correct_tracking'?'确认更正运单？签收状态保持不变，将重新同步物流。':'确认发货？'))return;
  inFlight.current=true;setBusy(true);setFailed(false);
  try{const response=await fetch('/api/admin/orders/'+encodeURIComponent(orderNo),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,trackingCompany:trackingCompany||undefined,trackingNo:trackingNo||undefined,note:note||undefined})});const result=await response.json();if(!response.ok||!result.ok)throw Error(formatAdminActionError(result.error,response.status,'履约操作'));setMessage(action==='ship'?'发货信息已保存，微信支付订单会自动报送，请核对下方同步状态。':'操作已保存，请核对最新物流及审计记录。');router.refresh();}
  catch(error){setFailed(true);setMessage(error instanceof Error&&/[一-鿿]/.test(error.message)?error.message:'连接中断，请刷新核对订单结果后再操作。');router.refresh();}
  finally{inFlight.current=false;setBusy(false);}
 }
 return <form id="fulfillment-task" className="grid gap-3 rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4 scroll-mt-24" onSubmit={submit}><h2 className="font-black">发货与物流</h2><p>{allowed.reason}</p><label className="vk-field">物流公司<input name="trackingCompany" defaultValue={trackingCompany??''} disabled={busy||!(allowed.ship||allowed.correct)} placeholder="例如：顺丰速运"/></label><label className="vk-field">物流单号<input name="trackingNo" defaultValue={trackingNo??''} disabled={busy||!(allowed.ship||allowed.correct)}/></label><label className="vk-field">操作备注<input name="note" disabled={busy||!(allowed.ship||allowed.deliver||allowed.correct)} placeholder="更正运单时请填写原因"/></label>{allowed.ship?<button className="vk-button vk-button-dark" disabled={busy} value="ship">确认发货</button>:null}{allowed.correct?<button className="vk-button vk-button-light" disabled={busy} value="correct_tracking">保存更正运单</button>:null}{allowed.deliver?<button className="vk-button vk-button-dark" disabled={busy} value="deliver">确认签收</button>:null}<p role="status" className={failed?'text-red-700':'text-slate-600'}>{busy?'正在提交…':message}</p></form>;
}

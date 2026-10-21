"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FIT_CONSENT_VERSION, X1_FIT_ROWS, fitMessage, parseFitFields, recommendX1Fit, type FitProfile, type FitValues } from "@/lib/fit-guide";

const empty={heightCm:"",weightKg:"",waistCm:"",preference:"regular" as "regular"|"relaxed"};
type ResponseBody={ok?:boolean;error?:string;accountId?:string;profile?:FitProfile|null};
export function FitAssistant({english=false,title}:{english?:boolean;title?:string}) {
  const id=useId(),dirty=useRef(false),mounted=useRef(true),requestId=useRef(0);
  const [fields,setFields]=useState(empty),[profile,setProfile]=useState<FitProfile|null>(null),[accountId,setAccountId]=useState<string|null>(null);
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[consent,setConsent]=useState(false),[message,setMessage]=useState(""),[confirmDelete,setConfirmDelete]=useState(false);
  let values:FitValues,invalid=false;
  try{values=parseFitFields(fields)}catch{values={heightCm:null,weightKg:null,waistCm:null,preference:fields.preference};invalid=true}
  const result=recommendX1Fit(values);
  function applyProfile(value:FitProfile|null){setProfile(value);setFields(value?{heightCm:value.heightCm===null?"":String(value.heightCm),weightKg:value.weightKg===null?"":String(value.weightKg),waistCm:value.waistCm===null?"":String(value.waistCm),preference:value.preference}:empty);dirty.current=false;setConsent(false);setConfirmDelete(false)}
  async function load(force=false){
    const sequence=++requestId.current;
    try {
      const response=await fetch("/api/account/fit-profile",{credentials:"same-origin",cache:"no-store"}),body:ResponseBody=await response.json();
      if(!mounted.current||sequence!==requestId.current)return;
      if(response.status===401){setAccountId(null);setReady(true);return}
      if(!response.ok||!body.ok||!body.accountId)throw Error("FIT_PROFILE_UNAVAILABLE");
      setAccountId(body.accountId);setProfile(body.profile||null);if(force||!dirty.current)applyProfile(body.profile||null);setReady(true);
    }catch{if(mounted.current&&sequence===requestId.current)setMessage(english?"Profile could not sync. Reload before saving; the calculator still works.":"档案暂未同步，请重新加载后保存；仍可使用尺码参考。");}
  }
  // load writes state only after awaiting the profile response; the shared helper triggers this lint false positive.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(()=>{mounted.current=true;void load();return()=>{mounted.current=false;requestId.current++}},[]); // eslint-disable-line react-hooks/exhaustive-deps
  async function mutate(remove=false){
    if(busy||!ready||!accountId||(!remove&&!consent))return;
    if(!remove&&invalid){setMessage(english?"Check the values and use at most one decimal place.":"请检查数值范围，最多保留一位小数。");return}
    setBusy(true);setMessage("");
    try {
      const response=await fetch("/api/account/fit-profile",{method:remove?"DELETE":"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:JSON.stringify({accountId,revision:profile?.revision||0,...(!remove?{...values,consentVersion:FIT_CONSENT_VERSION}:{})})});
      const body:ResponseBody=await response.json();if(!mounted.current)return;
      if(!response.ok||!body.ok){
        if(response.status===401||body.error==="SESSION_CHANGED"){setAccountId(null);applyProfile(null);setReady(false)}
        if(body.error==="FIT_PROFILE_CONFLICT"){setReady(false);throw Error("conflict")}
        if(body.error==="FIT_PROFILE_EMPTY")throw Error("empty");
        throw Error("failed");
      }
      applyProfile(body.profile||null);setMessage(remove?(english?"Profile deleted from your account.":"尺码档案已从账户删除。"):(english?"Saved. Sign in to the same account on the website and mini-program to use it.":"已保存，官网与小程序登录同一品牌账户后可共用。"));
    }catch(error){if(mounted.current)setMessage(error instanceof Error&&error.message==="conflict"?(english?"Changed on another device. Reload before editing.":"档案已在其他页面或设备更新，请重新加载后修改。"):error instanceof Error&&error.message==="empty"?(english?"Enter at least one measurement, or delete the saved profile.":"请至少填写一项身体数据，清空档案请使用删除。"):(english?"Could not complete the request. Reload to check the latest profile.":"操作未完成，请重新加载核对最新档案。"));}
    finally{if(mounted.current)setBusy(false)}
  }
  return <section className="min-w-0 space-y-5 text-sm" aria-label={english?"Personal size guide":"个人尺码助手"} data-private="true">
    <div><h3 className="text-xl font-semibold">{title||(english?"Your size guide":"我的尺码助手")}</h3><p className="mt-2 leading-6 text-muted">{english?"All fields are optional. Waist is the main reference; weight is supplementary. Height is stored for your reference.":"各项均可选填。以腰围为主要依据，体重辅助参考，身高用于档案记录。"}</p></div>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">{([{key:"waistCm",label:english?"Waist (cm)":"腰围（cm）",min:40,max:200},{key:"weightKg",label:english?"Weight (kg)":"体重（kg）",min:20,max:300},{key:"heightCm",label:english?"Height (cm)":"身高（cm）",min:50,max:250}] as const).map(field=><label className="grid gap-2" key={field.key} htmlFor={id+field.key}><span>{field.label}</span><input className="min-h-12 w-full min-w-0 border border-black/20 bg-white px-3 text-base" id={id+field.key} type="number" inputMode="decimal" step="0.1" min={field.min} max={field.max} placeholder={english?"Optional":"选填"} value={fields[field.key]} disabled={busy} onChange={event=>{dirty.current=true;setFields({...fields,[field.key]:event.target.value});setMessage("")}} autoComplete="off"/></label>)}</div>
    <fieldset className="space-y-3" disabled={busy}><legend>{english?"Fit preference at a size boundary":"两码交界时的穿着偏好"}</legend><div className="flex flex-wrap gap-5">{(["regular","relaxed"] as const).map(key=><label className="flex items-center gap-2" key={key}><input type="radio" name={id+"fit"} value={key} checked={fields.preference===key} onChange={()=>{dirty.current=true;setFields({...fields,preference:key})}}/>{key==="regular"?(english?"Closer fit":"合身"):(english?"More room":"宽松")}</label>)}</div></fieldset>
    <p className="border-l-2 border-black bg-[#f4f3f1] px-4 py-3 leading-7" role="status">{invalid?(english?"Check the measurements; use at most one decimal place.":"请检查数据，最多保留一位小数。"):fitMessage(result,english)}</p>
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">{english?"X1 Air body measurements":"X1 Air 适合的人体尺寸"}</caption><thead><tr><th className="p-3" scope="col">{english?"Size":"尺码"}</th><th className="p-3" scope="col">{english?"Waist (cm)":"腰围（cm）"}</th><th className="p-3" scope="col">{english?"Weight (kg)":"体重约（kg）"}</th></tr></thead><tbody>{X1_FIT_ROWS.map(row=><tr className={result.recommended===row.size?"bg-black text-white":result.candidates.includes(row.size)?"bg-[#efeeec]":"border-t border-black/10"} data-recommended={result.recommended===row.size?"true":"false"} key={row.size}><th className="p-3" scope="row">{row.size}</th><td className="p-3">{row.waistMin}–{row.waistMax}</td><td className="p-3">{row.weightMin}–{row.weightMax}</td></tr>)}</tbody></table></div>
    <p className="text-xs leading-6 text-muted">{english?"Body measurements, not garment dimensions. S is intended for a slimmer build. The reference is not a fit guarantee.":"以上为适合的人体腰围，并非内裤平铺尺寸；S 码适合偏瘦体型。尺码参考不等于穿着效果保证。"}</p>
    <details className="border-t border-black/10 pt-4"><summary className="cursor-pointer">{english?"Save and privacy":"档案保存与隐私说明"}</summary><p className="mt-3 text-xs leading-6 text-muted">{english?"Entered values stay on this page until you choose Save. Saving sends your selected measurements and fit preference to your brand account for size guidance and synchronization. Saving is optional; you can delete these measurements from your account at any time. This does not sign you up for marketing.":"填写时只在当前页面计算；主动保存后，所填身体数据和穿着偏好将保存到品牌账号，用于尺码参考及官网、小程序同步。保存完全自愿，可随时删除身体数据，不会因此订阅营销。"}</p></details>
    {ready&&!accountId?<a className="inline-block underline underline-offset-4" href="/account/settings">{english?"Sign in to save your profile":"登录后保存到个人档案"}</a>:<><label className="flex items-start gap-3 text-xs leading-6"><input className="mt-1" type="checkbox" checked={consent} disabled={busy||!ready} onChange={event=>setConsent(event.target.checked)}/><span>{english?"I agree to save these measurements to my brand account for size guidance and synchronization as described above.":"我同意按上述说明，将所填资料保存到品牌账号，用于尺码参考及两端同步。"}</span></label><div className="flex flex-wrap gap-3"><button type="button" className="min-h-12 bg-black px-5 font-semibold !text-white disabled:opacity-40" onClick={()=>void mutate()} disabled={busy||!ready||!consent||invalid}>{busy?(english?"Working…":"处理中…"):(english?"Save profile":"保存个人尺码档案")}</button>{profile?<button type="button" className="min-h-12 border border-black/20 px-5" onClick={()=>setConfirmDelete(true)} disabled={busy}>{english?"Delete profile":"删除档案"}</button>:null}</div></>}
    {confirmDelete?<div className="border border-black/20 p-4"><p>{english?"Delete saved body measurements from this account?":"确认删除账户中保存的身体数据？"}</p><div className="mt-3 flex gap-5"><button type="button" onClick={()=>void mutate(true)} disabled={busy}>{english?"Confirm deletion":"确认删除"}</button><button type="button" onClick={()=>setConfirmDelete(false)} disabled={busy}>{english?"Cancel":"取消"}</button></div></div>:null}
    {profile?<p className="text-xs text-muted">{english?"Updated: ":"最近更新："}{new Date(profile.updatedAt).toLocaleDateString(english?"en":"zh-CN",{timeZone:"Asia/Shanghai"})}</p>:null}
    {message?<p className="text-sm leading-6" role="status">{message}</p>:null}
    <button type="button" className="text-xs underline underline-offset-4" disabled={busy} onClick={()=>{setReady(false);setMessage("");void load(true)}}>{english?"Reload saved profile":"重新加载已保存档案"}</button>
  </section>;
}

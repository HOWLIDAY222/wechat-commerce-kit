"use client";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Template = { id: string; title: string; amountCents: number; minimumCents: number; productIds: string[]; newcomerOnly: boolean; startsAt: string; endsAt: string; totalLimit: number; issuedCount: number; active: boolean; deliveryMode:string; pointsCost:number;longTerm?:boolean;unlimitedRedemption?:boolean;rewardCondition?:string;rewardValidity?:string };
const modes:Record<string,string> = {PUBLIC:'会员主动领取',JOIN:'新会员入会时自动发放',FIRST_ORDER:'首单确认收货后自动发放',MANUAL:'后台指定会员发放',POINTS:'会员使用积分兑换',REWARD:'完成任务后自动发放'};
const box = "grid gap-4 rounded-lg border border-slate-200 bg-white p-5";
const field = "mt-1 min-h-11 w-full rounded border border-slate-300 bg-white px-3 py-2";
const button = "min-h-11 rounded bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-40";
const dateLabel = (value: string) => new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 16).replace("T", " ");
const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`;

export function MembershipPanel({ owner, products, benefits, templates }: { owner: boolean; products: { id: string; name: string }[]; benefits: string[]; templates: Template[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [mode,setMode]=useState('PUBLIC');
  const inFlight = useRef(false);
  const createRequest=useRef<{id:string;fingerprint:string}|null>(null);
  async function save(data: unknown, success: string) {
    if (inFlight.current) return false;
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/admin/membership", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const result = await response.json();
      if (!response.ok || !result.ok) { if(response.status>=400&&response.status<500)createRequest.current=null;throw new Error(result.error || "保存失败"); }
      setMessage(success); router.refresh(); return true;
    } catch (error) { setMessage(error instanceof Error ? error.message : "网络异常，请刷新查看保存结果。"); return false; }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const element = event.currentTarget; const f = new FormData(element);
    const start = new Date(String(f.get("startsAt"))); const end = new Date(String(f.get("endsAt")));
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) { setMessage("请填写有效日期。"); return; }
    const fingerprint=JSON.stringify(Array.from(f.entries()));
    if(createRequest.current&&createRequest.current.fingerprint!==fingerprint){setMessage('上次保存结果尚未确认。请先刷新查看券列表，或使用原资料重试核对。');return;}
    createRequest.current??={id:crypto.randomUUID(),fingerprint};
    const ok = await save({ action: "create",requestId:createRequest.current.id, title: f.get("title"), amountCents: Math.round(Number(f.get("amount")) * 100), minimumCents: Math.round(Number(f.get("minimum")) * 100),
      deliveryMode:mode,pointsCost:mode==='POINTS'?Number(f.get('pointsCost')):0,
      totalLimit: Number(f.get("limit")), newcomerOnly: f.get("newcomer") === "on", productIds: f.getAll("productIds"), startsAt: start.toISOString(), endsAt: end.toISOString() }, "优惠券草稿已保存。核对规则后，点击“启用活动”生效。");
    if (ok) {createRequest.current=null;element.reset();setMode('PUBLIC');}
  }
  return <div className="grid gap-5">
    <p role="status" aria-live="polite" className="rounded bg-blue-50 p-3 text-sm text-blue-900">{message || "新建优惠券先保存为草稿。普通券每人每种限领一次；长期兑换券按100积分兑换1元、积分足够可重复兑换；其他积分券按各自上限执行。暂停领取不影响已领券。金额、适用商品和有效期保存后固定，调整规则请新建券种。"}</p>
    {!owner && <p className="text-sm">可查看会员数据；优惠券与权益设置由负责人管理。</p>}
    <form className={box} onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void save({ action: "benefits", benefits: String(f.get("benefits")).split("\n").map(x => x.trim()).filter(Boolean) }, "会员权益介绍已更新。"); }}>
      <h2 className="font-bold">会员权益介绍</h2><p className="text-sm text-slate-500">每行一项，最多 8 项。只填写已提供的权益；优惠金额以券规则为准。</p>
      <textarea aria-label="会员权益介绍" name="benefits" defaultValue={benefits.join("\n")} rows={4} maxLength={807} className={field} disabled={!owner || busy} required />
      {owner && <button className={button} disabled={busy}>保存权益介绍</button>}
    </form>
    {owner && <form className={box} onSubmit={create}><h2 className="font-bold">创建优惠券</h2><fieldset disabled={busy} className="grid gap-4 md:grid-cols-2">
      <label>名称<input className={field} name="title" minLength={2} maxLength={60} required placeholder="例如：新会员专享券" /></label>
      <label>发放总量<input className={field} name="limit" type="number" min={1} max={100000} required /></label>
      <label>发放方式<select className={field} value={mode} onChange={e=>setMode(e.target.value)} name="deliveryMode">{Object.entries(modes).filter(([value])=>value!=="REWARD").map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label>
      {mode==='POINTS'&&<label>每次兑换扣除积分<input className={field} name="pointsCost" type="number" min={1} max={1000000} step={1} required/></label>}
      <label>优惠金额（元）<input className={field} name="amount" type="number" min="0.01" max="1000" step="0.01" required /></label>
      <label>适用商品金额门槛（元）<input className={field} name="minimum" type="number" min="0" max="100000" step="0.01" required /></label>
      <label>开始时间（本机时区）<input className={field} name="startsAt" type="datetime-local" required /></label>
      <label>结束时间（本机时区）<input className={field} name="endsAt" type="datetime-local" required /></label>
      {!['FIRST_ORDER','POINTS'].includes(mode)&&<label className="flex items-center gap-2"><input name="newcomer" type="checkbox" />仅限没有成功支付记录的会员</label>}
      <label>适用商品（不选表示全部）<select multiple name="productIds" className={field} size={4}>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    </fieldset><p className="text-xs leading-6 text-slate-500">同一账户可在官网与小程序使用，与组合优惠自动择优，不叠加。券不抵扣运费，商品最低实付 0.01 元。未支付取消返券且不延长有效期；已支付退款不返券。门槛按适用商品原价小计计算。</p><button className={button} disabled={busy}>保存优惠券草稿</button></form>}
    <section className={box}><h2 className="font-bold">优惠券（最近 100 项）</h2>{!templates.length && <p className="text-sm text-slate-500">暂无优惠券。创建并开放领取后，会出现在官网和小程序会员中心。</p>}
      {templates.map(t => <article key={t.id} className="grid gap-2 border-t border-slate-200 py-4 text-sm"><div className="flex flex-wrap justify-between gap-3"><h3 className="font-bold">{t.title} · {money(t.amountCents)}</h3><span>{t.active ? "券种已启用" : "券种已暂停"}</span></div>
        <p>{t.rewardCondition||modes[t.deliveryMode]||'按活动规则发放'}{t.deliveryMode==='POINTS'?` · 每张 ${t.pointsCost} 积分`:''}</p>
        <p>{t.minimumCents?`满 ${money(t.minimumCents)} 可用`:"无额外满减门槛"} · 已发放 {t.issuedCount} / {t.unlimitedRedemption?"不限总量":t.totalLimit} · {t.deliveryMode==="REWARD" ? "符合活动条件的会员" : t.newcomerOnly ? "首购会员" : "全部会员"}</p>
        <p className="text-slate-500">{t.rewardValidity||(t.deliveryMode==="REWARD"?"按每张已领券的有效期使用":t.deliveryMode==="POINTS"&&t.unlimitedRedemption?"长期有效，积分足够可重复兑换":t.longTerm?"长期有效":`${dateLabel(t.startsAt)} 至 ${dateLabel(t.endsAt)}`)}</p>
        <p>适用商品：{t.productIds.length ? t.productIds.map(id => products.find(p => p.id === id)?.name || id).join("、") : "全部商品"}</p>
        {owner && <button type="button" className={button} disabled={busy || (!t.active && new Date(t.endsAt) <= new Date())} onClick={() => {if(window.confirm(t.active?'暂停后不再发放新券，已领券仍可使用。确认暂停？':`确认启用「${t.title}」？方式：${modes[t.deliveryMode]}。启用后按此券种的活动条件发放。`))void save({ action: "toggle", id: t.id, active: !t.active }, t.active ? "已暂停活动，已领券继续有效。" : "活动已启用。");}}>{t.active ? "暂停活动" : "启用活动"}</button>}
      </article>)}
    </section>
  </div>;
}

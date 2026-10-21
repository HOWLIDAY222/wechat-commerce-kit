"use client";

import { type FormEvent, useMemo, useState } from "react";
import { FEEDBACK_PREFIX, readFeedback, feedbackDisplay, purposes, blockers, improvements } from "@/lib/website-feedback";
import { useRouter } from "next/navigation";

type Inquiry = { id: string; name: string; contact: string; message: string; status: "NEW" | "IN_PROGRESS" | "RESOLVED"; adminNote?: string | null; createdAt: string };
type Subscription = { id: string; email: string; status: "ACTIVE" | "UNSUBSCRIBED"; subscribedAt: string };
type Campaign = { id: string; subject: string; status: string; sentAt: string | null; createdAt: string; deliveryCount: number };

export function CustomerCarePanel({ campaigns, emailProviderConfigured, inquiries, isOwner, subscriptions }: { campaigns: Campaign[]; emailProviderConfigured: boolean; inquiries: Inquiry[]; isOwner: boolean; subscriptions: Subscription[] }) {
  const router = useRouter();
  const [view, setView] = useState<"inquiries" | "feedback" | "subscriptions">("inquiries");
  const [message, setMessage] = useState("网站体验调研按提交时间排列，统计范围为当前加载的最近记录。");
  const [busyId, setBusyId] = useState("");
  const activeSubscriptions = useMemo(() => subscriptions.filter((item) => item.status === "ACTIVE"), [subscriptions]);

  const feedback = inquiries.filter(item => item.message.startsWith(FEEDBACK_PREFIX));
  const contacts = inquiries.filter(item => !item.message.startsWith(FEEDBACK_PREFIX));
  const visibleInquiries = view === "feedback" ? feedback : contacts;

  const surveys = feedback.map(item => readFeedback(item.message)).filter(item => item !== null);
  const average = surveys.length ? (surveys.reduce((sum, item) => sum + item.rating, 0) / surveys.length).toFixed(1) : "—";
  const completed = surveys.filter(item => item.completion !== "no").length;
  const breakdown = (options: ReadonlyArray<readonly [string, string, string]>, field: "purpose" | "blockers" | "improvements") => options.map(([id, label]) => ({ label, count: surveys.filter(item => field === "purpose" ? item.purpose === id : item[field].includes(id)).length })).filter(item => item.count > 0).sort((a, b) => b.count - a.count);

  async function updateInquiry(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusyId(id);
    const response = await fetch(`/api/admin/customer-care/inquiries/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: String(form.get("status") ?? "NEW"), adminNote: String(form.get("adminNote") ?? "") }) });
    const result = await response.json().catch(() => ({})); setBusyId(""); setMessage(result.ok ? "处理状态已保存。" : "保存失败，请刷新后重试。"); if (result.ok) router.refresh();
  }

  async function sendCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement);
    if (!window.confirm(`确认向 ${activeSubscriptions.length} 个已授权邮箱发送品牌邮件？`)) return;
    setBusyId("campaign");
    const response = await fetch("/api/admin/customer-care/newsletter/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subject: String(form.get("subject") ?? ""), body: String(form.get("body") ?? ""), confirmation: "SEND_VALSENN_KROVEN_NEWSLETTER" }) });
    const result = await response.json().catch(() => ({})); setBusyId("");
    if (!result.ok) { setMessage(result.error === "EMAIL_PROVIDER_NOT_CONFIGURED" ? "邮件服务尚未配置。" : "邮件发送失败，请检查服务状态。"); return; }
    formElement.reset(); setMessage(`发送完成：成功 ${result.sent ?? 0}，失败 ${result.failed ?? 0}。`); router.refresh();
  }

  return <section className="mt-5 grid gap-4 border border-[#d8dde5] bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-black">客户咨询、网站反馈与订阅</h2><p className="mt-1 text-xs font-bold text-[#697386]">只用于处理客户主动提交的联系资料和已授权订阅。</p></div><div className="inline-flex flex-wrap border border-[#d8dde5] p-1"><button className={view === "inquiries" ? "bg-[#111827] px-4 py-2 text-xs font-black text-white" : "px-4 py-2 text-xs font-black"} onClick={() => setView("inquiries")} type="button">咨询 {contacts.length}</button><button className={view === "feedback" ? "bg-[#111827] px-4 py-2 text-xs font-black text-white" : "px-4 py-2 text-xs font-black"} onClick={() => setView("feedback")} type="button">网站反馈 {feedback.length}</button><button className={view === "subscriptions" ? "bg-[#111827] px-4 py-2 text-xs font-black text-white" : "px-4 py-2 text-xs font-black"} onClick={() => setView("subscriptions")} type="button">订阅 {activeSubscriptions.length}</button></div></div><p className="rounded-[8px] bg-[#f8fafc] px-3 py-2 text-xs font-bold text-[#697386]" role="status">{message}</p>{view !== "subscriptions" ? <div className="grid gap-3">{view === "feedback" ? <div className="grid gap-4 border border-[#d8dde5] bg-[#f8fafc] p-4"><div className="flex flex-wrap gap-6 text-sm"><span>有效问卷 <strong>{surveys.length}</strong></span><span>平均满意度 <strong>{average} / 5</strong></span><span>完成或基本完成目的 <strong>{surveys.length ? Math.round(completed / surveys.length * 100) + "%" : "—"}</strong></span></div><div className="grid gap-4 md:grid-cols-3">{([["访问目的", purposes, "purpose"], ["未完成原因", blockers, "blockers"], ["期望改进", improvements, "improvements"]] as const).map(([title, options, field]) => <div key={title}><h3 className="text-xs font-black">{title}</h3>{breakdown(options, field).map(item => <p key={item.label} className="mt-2 text-xs">{item.label} · {item.count}</p>)}{!breakdown(options, field).length ? <p className="mt-2 text-xs text-muted">暂无数据</p> : null}</div>)}</div><p className="text-xs text-muted">统计基于本次加载的最近咨询与反馈记录，最多 300 条；多选题按选择次数统计。</p></div> : null}{visibleInquiries.map((inquiry) => <form className="grid gap-4 rounded-[8px] border border-[#d8dde5] p-4 lg:grid-cols-[minmax(0,1fr)_280px]" key={inquiry.id} onSubmit={(event) => updateInquiry(event, inquiry.id)}><div><div className="flex flex-wrap items-center gap-2"><strong>{inquiry.name}</strong><span className="text-xs font-bold text-[#697386]">{inquiry.contact}</span><span className="rounded-full bg-[#eef1f5] px-2 py-1 text-[11px] font-black">{inquiryStatus(inquiry.status)}</span></div><p className="mt-3 whitespace-pre-wrap break-words text-sm font-bold leading-6 text-[#344054]">{feedbackDisplay(inquiry.message)}</p><p className="mt-3 text-xs font-bold text-[#98a2b3]">{formatDate(inquiry.createdAt)}</p></div><div className="grid gap-3"><label className="vk-field">处理状态<select defaultValue={inquiry.status} name="status"><option value="NEW">待处理</option><option value="IN_PROGRESS">处理中</option><option value="RESOLVED">已处理</option></select></label><label className="vk-field">内部记录<textarea defaultValue={inquiry.adminNote ?? ""} name="adminNote" rows={3} /></label><button className="vk-button vk-button-dark" disabled={busyId === inquiry.id} type="submit">{busyId === inquiry.id ? "保存中" : "保存处理结果"}</button></div></form>)}{!visibleInquiries.length ? <p className="py-6 text-center text-xs font-bold text-[#697386]">{view === "feedback" ? "暂无网站反馈。" : "暂无咨询工单。"}</p> : null}</div> : <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]"><div className="overflow-x-auto"><table className="min-w-[560px] w-full text-left text-xs"><thead><tr className="border-b border-[#d8dde5] text-[#697386]"><th className="py-2">邮箱</th><th>状态</th><th>订阅时间</th></tr></thead><tbody className="divide-y divide-[#eef1f5]">{subscriptions.map((item) => <tr key={item.id}><td className="py-3 font-black">{maskEmail(item.email)}</td><td>{item.status === "ACTIVE" ? "有效" : "已退订"}</td><td>{formatDate(item.subscribedAt)}</td></tr>)}</tbody></table></div><div className="grid gap-4"><form className="grid gap-3 rounded-[8px] bg-[#f8fafc] p-4" onSubmit={sendCampaign}><h3 className="text-sm font-black">发送品牌通知</h3><p className={emailProviderConfigured ? "text-xs font-black text-[#027a48]" : "text-xs font-black text-[#b42318]"}>{emailProviderConfigured ? "邮件服务已配置" : "邮件服务尚未配置"}</p><label className="vk-field">主题<input maxLength={120} name="subject" required /></label><label className="vk-field">正文<textarea maxLength={6000} minLength={10} name="body" required rows={6} /></label><button className="vk-button vk-button-dark" disabled={!isOwner || !emailProviderConfigured || !activeSubscriptions.length || busyId === "campaign"} type="submit">发送给 {activeSubscriptions.length} 个邮箱</button>{!isOwner ? <p className="text-xs font-bold text-[#697386]">仅负责人可发送。</p> : null}</form><div className="rounded-[8px] bg-[#f8fafc] p-4"><h3 className="text-sm font-black">最近发送</h3>{campaigns.slice(0, 5).map((item) => <p className="mt-2 text-xs font-bold text-[#697386]" key={item.id}>{item.subject} · {item.status} · {item.deliveryCount} 封</p>)}</div></div></div>}</section>;
}

function inquiryStatus(value: Inquiry["status"]) { return value === "RESOLVED" ? "已处理" : value === "IN_PROGRESS" ? "处理中" : "待处理"; }
function maskEmail(value: string) { const [name, domain] = value.split("@"); return domain ? `${name.slice(0, 2)}***@${domain}` : "***"; }
function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }

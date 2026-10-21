"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { formatAdminActionError } from "@/lib/client/admin-error-message";
import { formatStatusLabel } from "@/lib/display-labels";

const executableStatuses = new Set(["CREATED", "MANUAL_MARKED", "PROCESSING", "FAILED"]);

export function RefundTaskForm({ canExecuteProviderRefund, paymentRefundId, refundNo, status }: { canExecuteProviderRefund: boolean; paymentRefundId?: string | null; refundNo: string; status: string }) {
  const inFlight = useRef(false);
  const router = useRouter();
  const [message, setMessage] = useState("退款状态由支付服务结果推进，后台不能直接选择成功状态。");
  const [tone, setTone] = useState<"idle" | "success" | "error">("idle");
  const [busy, setBusy] = useState<"note" | "execute" | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const canExecute = canExecuteProviderRefund && executableStatuses.has(status.toUpperCase());

  async function saveNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(inFlight.current) return; const form = new FormData(event.currentTarget); inFlight.current=true; setBusy("note"); try {
    const response = await fetch(`/api/admin/refunds/${encodeURIComponent(refundNo)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(stripEmpty({ paymentRefundId: String(form.get("paymentRefundId") ?? "").trim(), failureReason: String(form.get("failureReason") ?? "").trim(), note: String(form.get("note") ?? "").trim() })) });
    const result = await response.json().catch(() => ({})); setBusy(null);
    if (!response.ok || !result.ok) { setTone("error"); setMessage(formatAdminActionError(result.error, response.status, "退款记录保存")); return; }
    setTone("success"); setMessage("退款核对记录已保存，资金状态没有被手工修改。"); router.refresh();
    } catch { setTone("error"); setMessage("连接中断，结果尚未确认。请刷新核对退款记录；不要重复发起新的退款。"); router.refresh(); } finally { inFlight.current=false; setBusy(null); }
  }

  async function executeRefund() {
    if(inFlight.current) return;
    if (!window.confirm("确认调用真实支付退款？该操作可能产生资金变动。")) return;
    inFlight.current=true; setBusy("execute"); try { setTone("idle"); setMessage("正在调用支付服务并等待真实结果...");
    const response = await fetch(`/api/admin/refunds/${encodeURIComponent(refundNo)}/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmExecute: true, confirmRefundNo: confirmation.trim() }) });
    const result = await response.json().catch(() => ({})); setBusy(null);
    if (!response.ok || !result.ok) { setTone("error"); setMessage(formatAdminActionError(result.error, response.status, "支付退款")); return; }
    setTone("success"); setMessage(result.refund?.refundStatus === "SUCCEEDED" ? "支付渠道已确认退款成功，订单与售后状态已同步。" : "支付请求已处理，退款状态以支付渠道后续确认为准，请刷新核对。"); router.refresh();
    } catch { setTone("error"); setMessage("连接中断，结果尚未确认。请刷新核对退款记录；不要重复发起新的退款。"); router.refresh(); } finally { inFlight.current=false; setBusy(null); }
  }

  return <section className="grid gap-4 rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4"><div><p className="text-xs font-black text-[#697386]">退款任务 {refundNo}</p><h3 className="mt-1 text-base font-black">{formatStatusLabel(status)}</h3></div><form className="grid gap-3 bg-white p-4" onSubmit={saveNote}><label className="vk-field">网关退款单号<input defaultValue={paymentRefundId ?? ""} disabled={busy !== null} name="paymentRefundId" /></label><label className="vk-field">失败原因<input disabled={busy !== null} name="failureReason" /></label><label className="vk-field">核对备注<input disabled={busy !== null} name="note" /></label><button className="vk-button vk-button-light" disabled={busy !== null} type="submit">{busy === "note" ? "保存中" : "保存处理记录"}</button></form><div className="bg-white p-4"><p className="text-sm font-black">执行支付退款</p><p className="mt-1 text-xs font-bold leading-5 text-[#697386]">只有店铺负责人可执行真实支付退款；输入退款单号进行二次确认。</p><input className="mt-3 w-full rounded-[8px] border border-[#d8dde5] px-3 py-3 text-sm font-bold" disabled={!canExecute || busy !== null} onChange={(event) => setConfirmation(event.target.value)} placeholder={canExecute ? `输入 ${refundNo}` : "当前不可执行"} value={confirmation} /><button className="vk-button vk-button-dark mt-3 w-full" disabled={!canExecute || busy !== null || confirmation.trim() !== refundNo} onClick={executeRefund} type="button">{busy === "execute" ? "执行中" : "执行真实退款"}</button></div><p className={tone === "success" ? "bg-[#ecfdf3] px-3 py-2 text-xs font-black text-[#027a48]" : tone === "error" ? "bg-[#fff1f3] px-3 py-2 text-xs font-black text-[#b42318]" : "bg-white px-3 py-2 text-xs font-bold text-[#697386]"}>{message}</p></section>;
}
function stripEmpty(payload: Record<string, string>) { return Object.fromEntries(Object.entries(payload).filter(([, value]) => value)); }

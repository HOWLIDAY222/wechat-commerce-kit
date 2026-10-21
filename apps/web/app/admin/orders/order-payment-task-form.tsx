"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { formatAdminActionError } from "@/lib/client/admin-error-message";
import { formatStatusLabel } from "@/lib/display-labels";

export function OrderPaymentTaskForm({ gatewayTradeNo, paymentId, provider, status }: { gatewayTradeNo?: string | null; paymentId: string; provider: string; status: string }) {
  const inFlight = useRef(false);
  const router = useRouter(); const [message, setMessage] = useState("支付状态只能来自支付通知或主动查单同步。"); const [tone, setTone] = useState<"idle" | "success" | "error">("idle"); const [busy, setBusy] = useState(false); const normalizedProvider = provider.toUpperCase(); const canSync = (normalizedProvider === "ALIPAY" || normalizedProvider === "WECHAT_PAY" || normalizedProvider === "MOCK") && status.toUpperCase() !== "PAID";
  async function sync() { if(inFlight.current) return; if (!window.confirm("确认向支付服务商主动查单并同步状态？")) return; inFlight.current=true; setBusy(true); try { setTone("idle"); setMessage("正在向支付服务商查单..."); const response = await fetch(`/api/admin/payments/${encodeURIComponent(paymentId)}/sync`, { method: "POST", headers: { "Content-Type": "application/json" } }); const result = await response.json().catch(() => ({})); setBusy(false); if (!response.ok || !result.ok) { setTone("error"); setMessage(formatAdminActionError(result.error, response.status, "支付查单")); return; } if (!result.paid) { setMessage(result.query?.subMsg ?? result.query?.tradeStatus ?? "服务商暂未确认支付成功。"); return; } setTone("success"); setMessage("服务商已确认支付成功，订单状态已同步。"); router.refresh(); } catch { setTone("error"); setMessage("查单连接中断，请重新查单核对最新状态。"); } finally { inFlight.current=false; setBusy(false); } }
  return <section className="rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4" id="payment-task"><p className="text-xs font-black text-[#697386]">支付任务</p><div className="mt-3 grid gap-2 rounded-[8px] bg-white px-3 py-3 text-xs font-bold text-[#697386]"><p>当前状态：{formatStatusLabel(status)}</p><p>支付渠道：{formatStatusLabel(provider)}</p><p>网关交易号：{gatewayTradeNo ?? "暂无"}</p></div><button className="vk-button vk-button-dark mt-3 w-full" disabled={!canSync || busy} onClick={sync} type="button">{busy ? "查单中" : "主动查单并同步"}</button><p className={tone === "success" ? "mt-3 bg-[#ecfdf3] px-3 py-2 text-xs font-black text-[#027a48]" : tone === "error" ? "mt-3 bg-[#fff1f3] px-3 py-2 text-xs font-black text-[#b42318]" : "mt-3 bg-white px-3 py-2 text-xs font-bold text-[#697386]"}>{message}</p></section>;
}

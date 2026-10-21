"use client";

import { useRef, useState } from "react";

type Rule = { enabled: boolean; activatedAt: string | null };

export function WeChatLogisticsSettings({ initialRule }: { initialRule: Rule }) {
  const [rule, setRule] = useState(initialRule);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inFlight = useRef(false);

  async function toggle() {
    if (inFlight.current) return;
    const enabled = !rule.enabled;
    if (enabled && !window.confirm("启用后，系统会为已付款、在启用后发货的普通小程序订单接入微信物流查询和节点通知，包括此前下单但尚未发货的订单，信息发送给实际购买者。启用前已发出的运单不自动补传。确认启用？")) return;
    inFlight.current = true;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/logistics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }) });
      const result = await response.json();
      if (!response.ok || !result.ok || typeof result.rule?.enabled !== "boolean") {
        const messages: Record<string, string> = { OWNER_REQUIRED: "仅店铺负责人可更改此设置。", ADMIN_UNAUTHORIZED: "登录已过期，请重新登录。", WECHAT_LOGISTICS_SCHEMA_REQUIRED: "物流服务尚未准备好，请联系维护人员。" };
        throw new Error(messages[result.error] || "保存失败，请稍后重试。");
      }
      setRule(result.rule);
      setNotice(result.rule.enabled ? "已启用，已有待发货订单在正常发货后也会自动接入。" : "已关闭新运单接入；已交给微信的物流通知可能继续发送。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "保存失败，请稍后重试。"); }
    finally { inFlight.current = false; setSaving(false); }
  }

  return <section className="scroll-mt-24 border border-[#d8dde5] bg-white p-5" id="logistics">
    <h2 className="text-base font-black">微信物流查询与通知</h2>
    <p className="mt-3 text-sm font-bold">{rule.enabled ? "已启用" : rule.activatedAt ? "已暂停新运单接入" : "尚未启用"}</p>
    <p className="mt-2 text-xs font-bold leading-5 text-[#697386]">接入后，客户可在订单详情查看微信物流轨迹，并按微信的订阅条件收到揽件、派送、签收通知。自动处理已付款、在启用后发货的普通小程序订单，包括此前下单的待发货订单。</p>
    <p className="mt-2 text-xs font-bold leading-5 text-[#697386]">启用前已发出的运单不自动补传。此开关独立于原有发货同步；关闭后原有发货同步仍正常运行，也不会撤回已交给微信的运单。</p>
    {rule.activatedAt ? <p className="mt-2 text-xs text-[#697386]">本次启用时间：{new Date(rule.activatedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p> : null}
    <button className="vk-button vk-button-dark mt-4 min-h-11 px-5" type="button" disabled={saving} onClick={() => void toggle()}>{saving ? "正在保存…" : rule.enabled ? "关闭新运单接入" : "启用微信物流服务"}</button>
    {error ? <p className="mt-3 text-sm text-red-700" role="alert">{error}</p> : null}
    {notice ? <p className="mt-3 text-sm" role="status">{notice}</p> : null}
  </section>;
}

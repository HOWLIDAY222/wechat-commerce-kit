"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { formatAdminActionError } from "@/lib/client/admin-error-message";

type InitialSettings = {
  siteName: string;
  supportEmail: string;
  supportPhone: string;
  xProfileUrl: string;
  shippingFeeCents: number | null;
  shippingRemoteFeeCents: number | null;
  shippingFarRemoteFeeCents: number | null;
};

export function SettingsAdminForm({ initialSettings }: { initialSettings: InitialSettings }) {
  const router = useRouter();
  const [message, setMessage] = useState("保存后请在公开联系页和结账页核对展示结果。");
  const [tone, setTone] = useState<"idle" | "success" | "error">("idle");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const shippingYuan = readMoney(form, "shippingFeeYuan");
    const shippingRemoteYuan = readMoney(form, "shippingRemoteFeeYuan");
    const shippingFarRemoteYuan = readMoney(form, "shippingFarRemoteFeeYuan");
    if (shippingYuan === null || shippingRemoteYuan === null || shippingFarRemoteYuan === null) {
      setTone("error");
      setMessage("配送费用必须是大于或等于 0 的金额，最多保留两位小数。");
      return;
    }
    setSubmitting(true);
    setTone("idle");
    setMessage("正在保存运营设置...");
    const response = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          siteName: String(form.get("siteName") ?? ""),
          supportEmail: String(form.get("supportEmail") ?? ""),
          supportPhone: String(form.get("supportPhone") ?? ""),
          xProfileUrl: String(form.get("xProfileUrl") ?? ""),
          shippingFeeCents: Math.round(shippingYuan * 100),
          shippingRemoteFeeCents: Math.round(shippingRemoteYuan * 100),
          shippingFarRemoteFeeCents: Math.round(shippingFarRemoteYuan * 100),
        },
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setSubmitting(false);
    if (!response.ok || !result.ok) {
      setTone("error");
      setMessage(formatAdminActionError(result.error, response.status, "运营设置保存"));
      return;
    }
    setTone("success");
    setMessage("运营设置已保存。公开页面会读取同一份数据。");
    router.refresh();
  }

  return (
    <form className="grid gap-5 border border-[#d8dde5] bg-white p-5" onSubmit={submit}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="vk-field">站点名称<input defaultValue={initialSettings.siteName} maxLength={80} name="siteName" placeholder="MerchantKit" required /></label>
        <label className="vk-field">客服邮箱<input defaultValue={initialSettings.supportEmail} maxLength={160} name="supportEmail" placeholder="service@example.com" required type="email" /></label>
        <label className="vk-field">客服电话（可留空）<input defaultValue={initialSettings.supportPhone} maxLength={40} name="supportPhone" placeholder="未公开时留空" /></label>
        <label className="vk-field md:col-span-2">X 官方账号地址<input defaultValue={initialSettings.xProfileUrl} maxLength={240} name="xProfileUrl" placeholder="https://x.com/你的账号" type="url" /><span className="text-xs font-bold leading-5 text-[#667085]">只接受 x.com 或 twitter.com 的 HTTPS 账号主页；公开页会统一使用去掉分享参数后的稳定地址。</span></label>
        <label className="vk-field">中国大陆标准运费（元）<input defaultValue={formatSettingMoney(initialSettings.shippingFeeCents)} min="0" name="shippingFeeYuan" placeholder="免费配送填写 0" required step="0.01" type="number" /></label>
        <label className="vk-field">特殊地区运费（元）<input defaultValue={formatSettingMoney(initialSettings.shippingRemoteFeeCents)} min="0" name="shippingRemoteFeeYuan" placeholder="内蒙古、甘肃、青海、宁夏、海南" required step="0.01" type="number" /></label>
        <label className="vk-field">偏远地区运费（元）<input defaultValue={formatSettingMoney(initialSettings.shippingFarRemoteFeeCents)} min="0" name="shippingFarRemoteFeeYuan" placeholder="新疆、西藏" required step="0.01" type="number" /></label>
      </div>
      <div className="border-t border-[#eef1f5] pt-4">
        <p className="text-sm font-black">安全边界</p>
        <p className="mt-1 text-xs font-bold leading-5 text-[#667085]">全站交易开关在“发售控制”中由店铺负责人操作；支付、短信、数据库和邮件密钥不会在后台显示。</p>
      </div>
      <button className="vk-button vk-button-dark w-fit" disabled={submitting} type="submit">{submitting ? "保存中..." : "保存运营设置"}</button>
      <p className={statusClass(tone)} role="status">{message}</p>
    </form>
  );
}

function readMoney(form: FormData, key: string) {
  const value = Number(String(form.get(key) ?? ""));
  if (!Number.isFinite(value) || value < 0 || Math.round(value * 100) !== value * 100) return null;
  return value;
}

function formatSettingMoney(value: number | null) {
  return value === null ? "" : (value / 100).toFixed(2);
}

function statusClass(tone: "idle" | "success" | "error") {
  if (tone === "success") return "bg-[#ecfdf3] px-3 py-2 text-sm font-black text-[#027a48]";
  if (tone === "error") return "bg-[#fff1f3] px-3 py-2 text-sm font-black text-[#b42318]";
  return "bg-[#f2f4f7] px-3 py-2 text-sm font-bold text-[#475467]";
}

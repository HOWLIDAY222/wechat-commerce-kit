"use client";

import { useState } from "react";

export function NewsletterUnsubscribeForm({ token }: { token: string }) {
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState(token ? "点击确认完成退订。" : "退订链接无效，请使用邮件中的完整链接。");

  async function unsubscribe() {
    if (!token || status === "submitting" || status === "success") return;
    setStatus("submitting");
    setMessage("正在处理...");
    const response = await fetch("/api/newsletter/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean };
    if (!response.ok || !result.ok) {
      setStatus("error");
      setMessage("退订链接无效或已失效，请联系客服处理。");
      return;
    }
    setStatus("success");
    setMessage("已完成退订。之后重新提交邮箱即可恢复订阅。");
  }

  return (
    <div className="mt-8 grid gap-4">
      <button className="vk-button vk-button-dark w-fit" disabled={!token || status === "submitting" || status === "success"} onClick={unsubscribe} type="button">
        {status === "submitting" ? "处理中..." : status === "success" ? "已退订" : "确认退订"}
      </button>
      <p className={status === "error" ? "text-sm font-bold text-[#b42318]" : "text-sm font-semibold text-muted"} role="status">{message}</p>
    </div>
  );
}

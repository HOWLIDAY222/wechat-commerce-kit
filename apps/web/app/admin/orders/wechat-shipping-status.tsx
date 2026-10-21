"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { weChatShippingErrorMessage, weChatShippingLabels, type WeChatShippingState } from "@/lib/commerce/wechat-shipping-status";

export function WeChatShippingStatus({ state, errors, syncedAt, pickup = false }: { state: WeChatShippingState; errors: string[]; syncedAt?: string | null; pickup?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (state !== "PENDING") return;
    let checks = 0;
    const timer = window.setInterval(() => {
      router.refresh();
      checks++;
      if (checks >= 24) window.clearInterval(timer);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [router, state]);

  if (state === "NOT_REQUIRED") return null;
  const failed = state === "FAILED";
  return (
    <section aria-label="微信发货同步" className={`mt-4 rounded-[8px] border p-4 ${failed ? "border-[#fedf89] bg-[#fffaeb]" : "border-[#d8dde5] bg-white"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-black">微信发货同步 · {weChatShippingLabels[state]}</h2>
        {state === "PENDING" || failed ? <button className="vk-button vk-button-light min-h-10 text-xs" onClick={() => router.refresh()} type="button">刷新同步状态</button> : null}
      </div>
      <div aria-live="polite" className="mt-2 grid gap-1 text-xs font-bold leading-6 text-[#697386]">
        {state === "NOT_SHIPPED" ? <p>{pickup ? '取货码核销完成后，系统自动向微信报送自提交付。' : '在本页填写物流并确认发货后，系统自动报送到微信，无需在两个后台重复录入。'}</p> : null}
        {state === "PENDING" ? <p>{pickup ? '核销已完成，正在自动报送微信。' : '发货信息已保存，正在自动报送微信。'}定时任务每两分钟补查，失败后自动重试。</p> : null}
        {failed ? [...new Set(errors)].map(error => <p key={error}>{weChatShippingErrorMessage(error)}</p>) : null}
        {state === "SYNCED" ? <p>发货信息已成功报送微信{syncedAt ? `，最近同步：${new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(syncedAt))}` : ""}。</p> : null}
      </div>
    </section>
  );
}

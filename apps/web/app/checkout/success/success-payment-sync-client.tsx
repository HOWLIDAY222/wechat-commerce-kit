"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getConsumerErrorMessage } from "@/lib/client/consumer-error-message";
import { trackStorefrontEvent } from "@/lib/client/analytics-events";

type SyncState = {
  title: string;
  message: string;
  orderNo?: string;
  tone: "idle" | "success" | "error";
};

export function SuccessPaymentSyncClient({ orderNo }: { orderNo: string }) {
  const syncStarted = useRef(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<SyncState>({
    title: "正在核对",
    message: "支付结果确认中，请稍候。",
    orderNo,
    tone: "idle",
  });

  const syncPayment = useCallback(async () => {
    setBusy(true);
    setState({ title: "正在核对", message: "支付结果确认中，请稍候。", orderNo, tone: "idle" });
    const response = await fetch("/api/payments/alipay/query", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNo }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      paid?: boolean;
      order?: { orderNo: string; paymentStatus: string };
      error?: string;
      query?: { subMsg?: string; tradeStatus?: string };
    };
    setBusy(false);

    if (!response.ok || !result.ok) {
      setState({
        title: "暂未确认",
        message: getConsumerErrorMessage(result.error, "暂时无法确认支付结果，请稍后在订单中心查看。"),
        orderNo,
        tone: "error",
      });
      return;
    }

    if (!result.paid || !result.order || result.order.paymentStatus?.toUpperCase() !== "PAID") {
      setState({
        title: "尚未确认支付",
        message: "订单暂未显示为已支付。如果你已完成付款，请稍后在订单中心刷新状态。",
        orderNo: result.order?.orderNo ?? orderNo,
        tone: "idle",
      });
      return;
    }

    setState({
      title: "支付成功",
      message: `订单 ${result.order.orderNo} 已确认支付，正在进入后续处理。`,
      orderNo: result.order.orderNo,
      tone: "success",
    });
    trackStorefrontEvent("payment_success", { provider: "alipay" });
  }, [orderNo]);

  useEffect(() => {
    if (syncStarted.current) return;
    syncStarted.current = true;
    void syncPayment();
  }, [syncPayment]);

  return (
    <section className="mt-8 grid gap-4 rounded-[8px] border border-line bg-soft p-5">
      <div>
        <p className="text-xs font-black text-muted">{state.title}</p>
        <p className="mt-1 break-all text-sm font-black">订单号：{state.orderNo}</p>
      </div>
      <p className={statusClass(state.tone)} role="status">
        {state.message}
      </p>
      <div className="flex flex-wrap gap-3">
        <button className="vk-button vk-button-light" disabled={busy} onClick={syncPayment} type="button">
          {busy ? "确认中..." : "重新确认"}
        </button>
        <Link className="vk-button vk-button-dark" href={state.orderNo ? `/account/orders/${encodeURIComponent(state.orderNo)}` : "/account/orders"}>
          查看订单
        </Link>
      </div>
    </section>
  );
}

function statusClass(tone: SyncState["tone"]) {
  if (tone === "success") return "rounded-[18px] bg-foreground px-4 py-3 text-sm font-black text-background";
  if (tone === "error") return "rounded-[18px] border border-foreground px-4 py-3 text-sm font-black text-foreground";
  return "rounded-[18px] bg-background px-4 py-3 text-sm font-bold text-muted";
}

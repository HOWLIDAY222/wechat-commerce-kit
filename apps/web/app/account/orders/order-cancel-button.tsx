"use client";

import { useState } from "react";
import { getConsumerErrorMessage } from "@/lib/client/consumer-error-message";
import { formatOrderStatusLabel, formatPaymentStatusLabel } from "@/lib/display-labels";

type CancelState = {
  message: string;
  orderStatus?: string;
  paymentStatus?: string;
  tone: "idle" | "success" | "error";
};

export function OrderCancelButton({ orderNo }: { orderNo: string }) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<CancelState>({
    message: "未支付订单可直接取消。",
    tone: "idle",
  });

  async function cancelOrder() {
    setBusy(true);
    setState({ message: "正在取消订单...", tone: "idle" });
    const response = await fetch(`/api/orders/${encodeURIComponent(orderNo)}/cancel`, {
      method: "POST",
      credentials: "same-origin",
    });
    const result = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      order?: { paymentStatus?: string; status?: string };
      error?: string;
    };
    setBusy(false);

    if (!response.ok || !result.ok || !result.order) {
      setState({ message: getConsumerErrorMessage(result.error, "暂时无法取消订单，请稍后重试。"), tone: "error" });
      return;
    }

    setState({
      message: "订单已取消。",
      orderStatus: result.order.status,
      paymentStatus: result.order.paymentStatus,
      tone: "success",
    });
  }

  return (
    <div className="grid gap-2">
      <button className="vk-button vk-button-light w-full" disabled={busy || state.tone === "success"} onClick={() => void cancelOrder()} type="button">
        {busy ? "取消中..." : "取消订单"}
      </button>
      <p className={statusClass(state.tone)} role="status">
        {state.message}
        {state.orderStatus ? ` 状态：${formatOrderStatusLabel(state.orderStatus)} / ${formatPaymentStatusLabel(state.paymentStatus)}` : ""}
      </p>
    </div>
  );
}

function statusClass(tone: CancelState["tone"]) {
  if (tone === "success") return "text-xs font-black text-[#067647]";
  if (tone === "error") return "text-xs font-black text-[#b42318]";
  return "text-xs font-bold text-muted";
}

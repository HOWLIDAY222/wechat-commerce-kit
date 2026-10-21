"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { getConsumerErrorMessage } from "@/lib/client/consumer-error-message";
import { trackStorefrontEvent } from "@/lib/client/analytics-events";

type PendingPayment = {
  amountCents: number;
  appId: string;
  merchantId: string;
  merchantOrderNo: string;
  orderNo: string;
  paymentId: string;
  provider: "mock" | "alipay";
  redirectUrl: string;
  sellerId: string;
};

type PendingState = {
  message: string;
  orderNo?: string;
  tone: "idle" | "success" | "error";
};

export function PendingPaymentClient({ payment }: { payment: PendingPayment }) {
  const autoSyncStarted = useRef(false);
  const actionPending = useRef(false);
  const [completed, setCompleted] = useState(false);
  const [busy, setBusy] = useState<"pay" | "sync" | "cancel" | null>(null);
  const [state, setState] = useState<PendingState>({
    message:
      payment.provider === "alipay"
        ? "待支付订单已创建，可以继续支付宝支付、同步支付状态或取消支付。"
        : "待支付订单已创建，可以继续支付或取消支付。",
    tone: "idle",
  });

  async function continuePayment() {
    if (completed || actionPending.current) return;
    actionPending.current = true;
    setBusy("pay");
    trackStorefrontEvent("payment_attempt", { provider: payment.provider });
    if (payment.provider === "alipay") {
      setState({ message: "正在跳转支付宝 H5...", tone: "idle" });
      window.location.href = payment.redirectUrl;
      return;
    }

    setState({ message: "正在模拟支付通知...", tone: "idle" });
    try {
      const response = await fetch("/api/payments/mock/notify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payment),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        order?: { orderNo: string; paymentStatus: string };
        error?: string;
      };
      setBusy(null);
      if (!response.ok || !result.ok || !result.order || !isPaid(result.order.paymentStatus)) {
        setState({ message: getConsumerErrorMessage(result.error, "当前无法完成支付，请稍后重试。"), orderNo: result.order?.orderNo, tone: "error" });
        return;
      }
      const paidOrder = result.order;
      setCompleted(true);
      trackStorefrontEvent("payment_success", { provider: payment.provider });
      setState({ message: `订单 ${paidOrder.orderNo} 已支付。`, orderNo: paidOrder.orderNo, tone: "success" });
    } catch {
      setState({ message: "网络连接中断，请查看订单状态后重试。", tone: "error" });
    } finally { actionPending.current = false; setBusy(null); }
  }

  const syncAlipayPayment = useCallback(async () => {
    if (actionPending.current) return;
    actionPending.current = true;
    try {
      setBusy("sync");
      setState({ message: "正在向支付宝查询支付状态...", tone: "idle" });
      const response = await fetch("/api/payments/alipay/query", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNo: payment.orderNo }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        paid?: boolean;
        order?: { orderNo: string; paymentStatus: string };
        error?: string;
        query?: { subMsg?: string; tradeStatus?: string };
      };
      setBusy(null);
      if (!response.ok || !result.ok) {
        setState({ message: getConsumerErrorMessage(result.error, "暂时无法确认支付结果，请稍后重试。"), orderNo: result.order?.orderNo, tone: "error" });
        return;
      }
      if (!result.paid || !result.order || !isPaid(result.order.paymentStatus)) {
        setState({
          message: "订单暂未显示为已支付。如果你已完成付款，请稍后再确认。",
          orderNo: result.order?.orderNo,
          tone: "idle",
        });
        return;
      }
      const paidOrder = result.order;
      setCompleted(true);
      trackStorefrontEvent("payment_success", { provider: "alipay" });
      setState({ message: `订单 ${paidOrder.orderNo} 已支付。`, orderNo: paidOrder.orderNo, tone: "success" });
    } catch {
      setState({ message: "网络连接中断，请查看订单状态后重试。", tone: "error" });
    } finally { actionPending.current = false; setBusy(null); }
  }, [payment.orderNo]);

  useEffect(() => {
    if (payment.provider !== "alipay" || autoSyncStarted.current) return;
    autoSyncStarted.current = true;
    const timer = window.setTimeout(() => {
      void syncAlipayPayment();
    }, 800);
    return () => window.clearTimeout(timer);
  }, [payment.provider, payment.orderNo, syncAlipayPayment]);

  async function cancelPayment() {
    if (completed || actionPending.current) return;
    actionPending.current = true;
    try {
      setBusy("cancel");
      setState({ message: "正在取消支付...", tone: "idle" });
      const response = await fetch("/api/payments/cancel", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderNo: payment.orderNo, paymentId: payment.paymentId, reason: "user_cancelled" }),
      });
      const result = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        order?: { orderNo: string; paymentStatus: string };
        error?: string;
      };
      setBusy(null);
      if (!response.ok || !result.ok || !result.order || !isCancelled(result.order.paymentStatus)) {
        setState({ message: getConsumerErrorMessage(result.error, "暂时无法取消支付，请前往订单中心查看。"), orderNo: result.order?.orderNo, tone: "error" });
        return;
      }
      const cancelledOrder = result.order;
      setCompleted(true);
      setState({ message: `订单 ${cancelledOrder.orderNo} 已取消支付。`, orderNo: cancelledOrder.orderNo, tone: "success" });
    } catch {
      setState({ message: "网络连接中断，请查看订单状态后重试。", tone: "error" });
    } finally { actionPending.current = false; setBusy(null); }
  }

  return (
    <section className="mt-8 grid gap-6 border border-line bg-soft p-6">
      <div className="grid gap-2 text-sm font-bold text-muted">
        <p>
          订单号：<span className="break-all text-foreground">{payment.orderNo}</span>
        </p>
        <p className="break-all">支付单号：{payment.paymentId}</p>
        <p>金额：{formatMoney(payment.amountCents)}</p>
      </div>
      {!completed ? <div className="flex flex-wrap gap-3">
        <button className="vk-button vk-button-dark" disabled={busy !== null} onClick={continuePayment} type="button">
          {busy === "pay" ? "处理中..." : payment.provider === "alipay" ? "继续支付宝支付" : "继续支付"}
        </button>
        {payment.provider === "alipay" ? (
          <button className="vk-button vk-button-light" disabled={busy !== null} onClick={syncAlipayPayment} type="button">
            {busy === "sync" ? "确认中..." : "确认支付结果"}
          </button>
        ) : null}
        <button className="vk-button vk-button-light" disabled={busy !== null} onClick={cancelPayment} type="button">
          {busy === "cancel" ? "处理中..." : "取消支付"}
        </button>
      </div> : null}
      <p className={statusClass(state.tone)} role="status">
        {state.message}
      </p>
      <div className="flex flex-wrap gap-3">
        <Link className="vk-button vk-button-light" href={state.orderNo ? `/account/orders/${encodeURIComponent(state.orderNo)}` : "/account/orders"}>
          查看订单
        </Link>
        <Link className="vk-button vk-button-light" href="/shop">
          继续购物
        </Link>
      </div>
    </section>
  );
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("zh-CN", { currency: "CNY", style: "currency" }).format(cents / 100);
}

function isPaid(status: string | undefined) {
  return status?.toLowerCase() === "paid";
}

function isCancelled(status: string | undefined) {
  return status?.toLowerCase() === "cancelled";
}

function statusClass(tone: PendingState["tone"]) {
  if (tone === "success") return "rounded-[18px] bg-foreground px-4 py-3 text-sm font-black text-background";
  if (tone === "error") return "rounded-[18px] border border-foreground px-4 py-3 text-sm font-black text-foreground";
  return "rounded-[18px] bg-background px-4 py-3 text-sm font-bold text-muted";
}

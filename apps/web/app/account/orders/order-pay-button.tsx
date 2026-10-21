"use client";

import { useState } from "react";
import Link from "next/link";
import { MINI_PROGRAM_PATH } from "@/lib/storefront-market";
import { getConsumerErrorMessage } from "@/lib/client/consumer-error-message";

type PayState = {
  message: string;
  tone: "idle" | "success" | "error";
};

type PaymentResult = {
  provider: "mock" | "alipay";
  paymentId: string;
  redirectUrl: string;
  notifyIdentity: {
    appId: string;
    sellerId: string;
    merchantId: string;
    merchantOrderNo: string;
  };
};

export function OrderPayButton({
  amountCents,
  disabled,
  orderNo,
  domestic = false,
}: {
  amountCents: number;
  disabled: boolean;
  orderNo: string;
  domestic?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<PayState>({
    message: disabled ? "当前订单不能继续支付。" : "未支付订单可继续支付。",
    tone: "idle",
  });

  async function continuePayment() {
    setBusy(true);
    setState({ message: "正在创建支付...", tone: "idle" });
    const response = await fetch("/api/payments/create", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderNo,
        amountCents,
        currency: "CNY",
      }),
    });
    const result = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      payment?: PaymentResult;
      error?: string;
    };
    setBusy(false);

    if (!response.ok || !result.ok || !result.payment) {
      setState({ message: getConsumerErrorMessage(result.error, "当前无法发起支付，请稍后重试。"), tone: "error" });
      return;
    }

    setState({ message: "支付已创建，正在跳转。", tone: "success" });
    if (result.payment.provider === "alipay") {
      window.location.assign(result.payment.redirectUrl);
      return;
    }
    window.location.assign(buildPendingPaymentUrl({
      amountCents,
      orderNo,
      payment: result.payment,
    }));
  }

  if (domestic) return <div className="grid gap-2">
    <Link className="vk-button vk-button-dark w-full" href={MINI_PROGRAM_PATH}>小程序购买说明</Link>
    <p className="text-xs leading-6 text-muted">已有订单请在原下单渠道处理；如需帮助，请联系客服。</p>
  </div>;

  return (
    <div className="grid gap-2">
      <button className="vk-button vk-button-dark w-full" disabled={disabled || busy} onClick={() => void continuePayment()} type="button">
        {busy ? "处理中..." : "继续支付"}
      </button>
      <p className={statusClass(state.tone)} role="status">{state.message}</p>
    </div>
  );
}

function buildPendingPaymentUrl(input: { amountCents: number; orderNo: string; payment: PaymentResult }) {
  const params = new URLSearchParams({
    amountCents: String(input.amountCents),
    appId: input.payment.notifyIdentity.appId,
    provider: input.payment.provider,
    redirectUrl: input.payment.redirectUrl,
    merchantId: input.payment.notifyIdentity.merchantId,
    merchantOrderNo: input.payment.notifyIdentity.merchantOrderNo,
    orderNo: input.orderNo,
    paymentId: input.payment.paymentId,
    sellerId: input.payment.notifyIdentity.sellerId,
  });
  return `/checkout/pending?${params.toString()}`;
}

function statusClass(tone: PayState["tone"]) {
  if (tone === "success") return "text-xs font-black text-[#067647]";
  if (tone === "error") return "text-xs font-black text-[#b42318]";
  return "text-xs font-bold text-muted";
}

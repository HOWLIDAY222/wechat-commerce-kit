import Link from "next/link";
import { PendingPaymentClient } from "@/app/checkout/pending/pending-payment-client";
import { InfoPanel, StorefrontPage } from "@/components/storefront/storefront-ui";

type PendingPaymentPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata = {
  description: "MerchantKit 待支付页面，可以继续支付、查看订单状态或取消待支付订单。",
  title: "待支付",
};

export default async function PendingPaymentPage({ searchParams }: PendingPaymentPageProps) {
  const params = await searchParams;
  const provider: "mock" | "alipay" = readParam(params.provider) === "alipay" ? "alipay" : "mock";
  const payment = {
    amountCents: Number(readParam(params.amountCents)),
    appId: readParam(params.appId),
    merchantId: readParam(params.merchantId),
    merchantOrderNo: readParam(params.merchantOrderNo),
    orderNo: readParam(params.orderNo),
    paymentId: readParam(params.paymentId),
    provider,
    redirectUrl: readParam(params.redirectUrl),
    sellerId: readParam(params.sellerId),
  };
  const valid = Boolean(payment.orderNo && payment.paymentId && payment.amountCents > 0);

  return (
    <StorefrontPage>
      <InfoPanel className="mx-auto max-w-3xl p-6">
        <p className="text-xs font-black text-brand">等待支付</p>
        <h1 className="mt-3 break-all text-[34px] font-black leading-tight md:text-[44px]">订单待支付</h1>
        <p className="mt-4 text-sm font-bold leading-7 text-muted">完成支付后，订单状态可能需要短暂时间更新。请勿重复支付，你也可以前往订单中心查看最新结果。</p>
        {valid ? (
          <PendingPaymentClient payment={payment} />
        ) : (
          <div className="mt-8 rounded-[8px] bg-soft p-6">
            <p className="font-bold text-muted">支付参数不完整，请返回订单中心查看订单。</p>
            <Link className="vk-button vk-button-dark mt-5 w-max" href="/account/orders">返回订单</Link>
          </div>
        )}
      </InfoPanel>
    </StorefrontPage>
  );
}

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

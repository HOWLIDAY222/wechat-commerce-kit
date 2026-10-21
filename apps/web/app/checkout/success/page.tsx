import Link from "next/link";
import { SuccessPaymentSyncClient } from "@/app/checkout/success/success-payment-sync-client";
import { InfoPanel, StorefrontPage } from "@/components/storefront/storefront-ui";

type CheckoutSuccessPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata = {
  title: "支付结果",
  description: "MerchantKit 支付结果确认页，可核对订单当前支付状态并返回订单中心。",
};

export default async function CheckoutSuccessPage({ searchParams }: CheckoutSuccessPageProps) {
  const params = await searchParams;
  const orderNo = readFirst(params.out_trade_no) || readFirst(params.orderNo) || readFirst(params.merchantOrderNo);

  return (
    <StorefrontPage>
      <InfoPanel className="mx-auto max-w-3xl p-6">
        <p className="text-xs font-black text-brand">支付结果</p>
        <h1 className="mt-3 text-[34px] font-black leading-tight md:text-[44px]">正在确认支付结果</h1>
        <p className="mt-4 text-sm font-bold leading-7 text-muted">请稍候，我们正在核对订单状态。确认完成前，请勿重复支付。</p>
        {orderNo ? (
          <SuccessPaymentSyncClient orderNo={orderNo} />
        ) : (
          <p className="mt-8 rounded-[8px] bg-soft px-4 py-3 text-sm font-bold text-muted">未找到对应订单，请前往订单中心核对。</p>
        )}
        <div className="mt-8 flex flex-wrap gap-3">
          <Link className="vk-button vk-button-dark" href="/account/orders">查看订单</Link>
          <Link className="vk-button vk-button-light" href="/shop">继续购物</Link>
        </div>
      </InfoPanel>
    </StorefrontPage>
  );
}

function readFirst(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

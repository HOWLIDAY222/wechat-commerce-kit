import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckoutClient } from "@/app/checkout/checkout-client";
import { StorefrontPage } from "@/components/storefront/storefront-ui";
import { readCurrentUserSession } from "@/lib/auth/session";
import { cartCookieName, getCartSummary, resolveCartKey } from "@/lib/services/cart-service";
import { getCommerceMode } from "@/lib/commerce/release-control";
import { getShippingRateConfig } from "@/lib/commerce/shipping";
import { appConfig } from "@/lib/config";
import { listAddresses } from "@/lib/services/address-service";

export const metadata = {
  title: "结账",
  description: "提交 MerchantKit 收货信息、创建订单并进入支付或待支付流程。",
};


export default async function CheckoutPage() {
  const session = await readCurrentUserSession();
  if (!session) redirect("/auth/login?next=/checkout");
  const currentKey = (await cookies()).get(cartCookieName)?.value;
  const cartKey = await resolveCartKey(currentKey, session?.userId);
  const [cart, commerceMode, shippingRateConfig, savedAddresses] = await Promise.all([getCartSummary(cartKey, session.userId), getCommerceMode(), getShippingRateConfig(), listAddresses(session.userId)]);

  return (
    <StorefrontPage>
      <section className="mb-8">

        <h1 className="mt-3 text-[34px] font-black leading-tight md:text-[44px]">结账</h1>
        <p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-muted">确认收货信息、配送方式和支付方式后提交订单。</p>
      </section>
      {commerceMode !== "OPEN" ? <CheckoutUnavailable /> : cart.itemCount === 0 ? <section className="border-y border-line py-12"><h2 className="text-2xl">购物袋为空</h2><p className="mt-4 text-sm text-muted">选好商品后，再来确认收货和付款信息。</p><Link href="/products/x1-air-white" className="vk-button vk-button-dark mt-6">选购 X1 Air</Link></section> : shippingRateConfig === null ? <CheckoutConfigurationUnavailable /> : <CheckoutClient initialCart={cart} shippingRateConfig={shippingRateConfig} paymentProvider={appConfig.PAYMENT_PROVIDER} savedAddresses={savedAddresses.map(({ id, name, phone, province, city, district, detail, isDefault }) => ({ id, name, phone, province, city, district, detail, isDefault }))} />}
    </StorefrontPage>
  );
}

function CheckoutUnavailable() {
  return <section className="border-y border-black/15 py-10 md:py-14"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-black/50">购买服务</p><h2 className="mt-3 text-2xl font-semibold md:text-3xl">暂未开放结账</h2><p className="mt-3 max-w-xl text-sm leading-7 text-black/60">当前可继续浏览商品与了解系列信息，购买入口开放时间请以官网发布为准。</p><Link className="vk-button vk-button-dark mt-6" href="/shop">返回商品系列</Link></section>;
}

function CheckoutConfigurationUnavailable() {
  return <section className="border-y border-black/15 py-10 md:py-14"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-black/50">结账维护</p><h2 className="mt-3 text-2xl font-semibold md:text-3xl">暂时无法提交订单</h2><p className="mt-3 max-w-xl text-sm leading-7 text-black/60">配送费用正在确认，请稍后再试。商品和购物袋内容不会受影响。</p><Link className="vk-button vk-button-dark mt-6" href="/bag">返回购物袋</Link></section>;
}

import Link from "next/link";
import { InfoPanel, StorefrontPage } from "@/components/storefront/storefront-ui";

export const metadata = {
  title: "支付已取消",
  description: "MerchantKit 支付取消页，引导用户返回订单中心或重新购物。",
};

export default function CheckoutCancelPage() {
  return (
    <StorefrontPage>
      <InfoPanel className="mx-auto max-w-3xl p-6">
        <p className="text-xs font-black text-brand">支付已取消</p>
        <h1 className="mt-3 text-[34px] font-black leading-tight md:text-[44px]">支付已取消</h1>
        <p className="mt-4 text-sm font-bold leading-7 text-muted">未支付订单可以在订单中心继续查看，也可以重新选择商品结账。取消支付不会把订单标记为已支付。</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link className="vk-button vk-button-dark" href="/account/orders">返回订单</Link>
          <Link className="vk-button vk-button-light" href="/shop">继续购物</Link>
        </div>
      </InfoPanel>
    </StorefrontPage>
  );
}

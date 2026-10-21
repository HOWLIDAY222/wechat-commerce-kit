import Link from "next/link";
import { StorefrontPage } from "@/components/storefront/storefront-ui";
import { MINI_PROGRAM_NAME } from "@/lib/storefront-market";
import { CopyNameButton } from "./copy-name-button";
import { MiniProgramLaunch } from "./launch-client";

export const metadata = { title: "小程序购买", description: "通过 MerchantKit 微信小程序选购商品。" };
export const dynamic = "force-dynamic";

export default function MiniProgramPage() {
  // Set only after verifying the released mini-program can be found and paid in.
  const released = process.env.MINIPROGRAM_STORE_RELEASED === "true";
  return <StorefrontPage narrow>
    <section className="py-8 md:py-16">
      <p className="text-xs font-semibold tracking-[0.16em] text-muted">MerchantKit</p>
      <h1 className="mt-5 text-4xl font-semibold leading-tight md:text-5xl">在微信小程序中选购</h1>
      <p className="mt-6 max-w-xl text-base leading-8 text-muted">国内站的下单与支付将由微信小程序提供。你可以在这里浏览商品，并在小程序中选择款式、确认收货信息和完成付款。</p>
      {!released ? <p className="mt-6 border-l-2 border-black bg-soft px-5 py-4 text-sm leading-7" role="status">小程序购买入口准备中，正式开放后可通过下方名称搜索进入。当前国内网页不提供结算与支付。</p> : null}
      {released ? <MiniProgramLaunch released /> : null}
      <div className="my-10 border-y border-line py-8">
        <p className="text-sm text-muted">微信小程序名称</p>
        <h2 className="mt-3 select-text text-2xl font-semibold">{MINI_PROGRAM_NAME}</h2>
        <ol className="my-6 list-inside list-decimal space-y-3 text-sm leading-7">
          <li>打开微信，进入「发现 → 小程序」。</li>
          <li>搜索上方名称，核对后进入商城。</li>
          <li>在小程序内重新确认商品规格、数量与价格。</li>
        </ol>
        <CopyNameButton />
      </div>
      <p className="text-sm leading-7 text-muted">网页购物袋不会自动转入小程序。已有订单请在原下单渠道查询，或联系客服协助处理。</p>
      <div className="mt-6 flex flex-wrap gap-4">
        <Link className="vk-button vk-button-light" href="/shop">继续浏览商品</Link>
        <Link className="vk-button vk-button-light" href="/contact">联系客服</Link>
      </div>
    </section>
  </StorefrontPage>;
}

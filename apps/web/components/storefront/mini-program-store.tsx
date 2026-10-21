import Link from "next/link";
import { MiniProgramLaunch } from "@/app/mini-program/launch-client";
import { StorefrontPage } from "./storefront-ui";
import { getProductBySlug } from "@/lib/services/catalog-service";
import { ProductInformation } from "@/components/product/product-information";

export async function MiniProgramStore() {
  const product = await getProductBySlug("x1-air-white");
  return <StorefrontPage narrow>
    <section className="py-8 md:py-16">
      <p className="text-xs font-semibold tracking-[0.16em] text-muted">MerchantKit</p>
      <h1 className="mt-5 text-3xl font-semibold leading-tight md:text-5xl">前往微信小程序商城</h1>
      <p className="mt-6 text-base leading-8 text-muted">选购商品、确认规格与付款，请在小程序中完成。</p>
      <MiniProgramLaunch released={process.env.MINIPROGRAM_STORE_RELEASED === "true"} />
      <div className="mt-8 flex flex-wrap gap-4">
        <Link className="vk-button vk-button-light" href="/">返回品牌首页</Link>
        <Link className="vk-button vk-button-light" href="/contact">联系客服</Link>
      </div>
      {product ? <ProductInformation product={product} /> : null}
    </section>
  </StorefrontPage>;
}

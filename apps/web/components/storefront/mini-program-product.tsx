import Link from "next/link";
import { StorefrontPage } from "./storefront-ui";
import { MiniProgramLaunch } from "@/app/mini-program/launch-client";
import { CopyNameButton } from "@/app/mini-program/copy-name-button";
import { MINI_PROGRAM_NAME } from "@/lib/storefront-market";
import { ProductInformation } from "@/components/product/product-information";
import type { StorefrontProduct } from "@/lib/storefront-product";

export function MiniProgramProduct({ product }: { product: StorefrontProduct }) {
  const { slug, name } = product;
  return <StorefrontPage narrow>
    <section className="py-8 md:py-16">
      <p className="text-xs font-semibold tracking-[0.16em] text-muted">MerchantKit</p>
      <h1 className="mt-5 text-3xl font-semibold leading-tight md:text-5xl">{name}</h1>
      <p className="mt-6 text-base leading-8 text-muted">在微信小程序查看这件商品并完成购买。</p>
      <MiniProgramLaunch key={slug} slug={slug} released={process.env.MINIPROGRAM_STORE_RELEASED === "true"} />
      <p className="mb-4 select-text text-lg">{MINI_PROGRAM_NAME}</p>
      <CopyNameButton />
      <div className="mt-8 flex flex-wrap gap-4">
        <Link className="vk-button vk-button-light" href="/shop">返回商品列表</Link>
        <Link className="vk-button vk-button-light" href="/contact">联系客服</Link>
      </div>
      <ProductInformation product={product} />
    </section>
  </StorefrontPage>;
}

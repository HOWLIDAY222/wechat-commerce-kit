import Link from "next/link";
import Image from "next/image";
import type { StorefrontProduct } from "@/lib/storefront-product";
import { formatProductPrice } from "@/lib/storefront-product";
import { dispatchDate, productPriceRows } from "@/lib/services/storefront-information-service";
import { X1SizeTable } from "./x1-size-table";
import { ProductDetailArtwork } from "./product-detail-artwork";
import { ProductImageGallery } from "./product-image-gallery";
import { ProductCampaignFilm } from "./campaign-video";
import { X1_AIR_WHITE_PACK_QUANTITIES, getX1AirWhiteOfferImage } from "@/lib/commerce/x1-air-white-offers";

export function ProductInformation({ product }: { product: StorefrontProduct }) {
  const date = dispatchDate(product), rows = productPriceRows(product);
  return <section className="mt-12 border-t border-black/10 pt-8" aria-label="商品信息">
    <div className="grid items-start gap-7 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <ProductImageGallery images={product.images.length ? product.images : [product.image]} name={product.name} productSlug={product.slug} />
      <div><h2 className="text-2xl">{product.name}</h2><p className="mt-3 text-sm leading-7 text-muted">{product.summary}</p>{product.release.showPrice ? <p className="mt-3 text-xl font-semibold">{formatProductPrice(product)} / 条</p> : null}<p className="mt-3 text-sm leading-7">{product.release.statusLabel}{date ? ` · 预计 ${date}前发货` : ""}</p></div>
    </div>
    <div className="mt-8 grid gap-5 sm:grid-cols-2">{rows.map(row => <article className="border border-black/10 p-5" key={row.key}><h3 className="font-semibold">{row.label}</h3><p className="mt-2 text-sm leading-7 text-muted">{row.summary}</p><dl className="mt-4 grid gap-3 text-sm">{row.prices.map(p => <div key={p.quantity} className="flex justify-between gap-5"><dt>{p.quantity} 条</dt><dd>¥{(p.cents / 100).toFixed(2).replace(/\.00$/, "")}</dd></div>)}</dl></article>)}</div>
    {product.slug === "x1-air-white" ? <section aria-label="组合装商品图" className="mt-8"><h3 className="font-semibold">按所需条数选择</h3><div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{X1_AIR_WHITE_PACK_QUANTITIES.map(quantity=><figure key={quantity}><div className="relative aspect-[4/3] overflow-hidden bg-[#f5f5f5]"><Image alt={`${product.name} 白色 ${quantity} 条装`} src={getX1AirWhiteOfferImage('白色',quantity)!} fill sizes="(min-width:640px) 25vw, 50vw" className="object-contain"/></div><figcaption className="mt-2 text-sm">{quantity} 条装</figcaption></figure>)}</div></section> : null}
    <p className="mt-5 text-sm leading-7 text-muted">{product.colors.join(" / ")} · {[...product.sizes].sort().join(" / ")}。{product.quantityPricing?.repeatBundles ? "一条起售，两条起享组合价；超过四条自动按最省组合计价。" : ""}同款不同尺码可合并享组合价，不同款式分别计价；优惠券与组合优惠自动择优，不叠加。</p>
    {product.slug === "x1-air-white" ? <details className="mt-6 border-y border-black/10 py-5"><summary className="cursor-pointer font-semibold">尺码参考</summary><div className="pt-5"><X1SizeTable /></div></details> : null}
    <details className="border-b border-black/10 py-5"><summary className="cursor-pointer font-semibold">商品详情与洗护</summary><div className="pt-4 text-sm leading-7 text-muted"><p>{product.description}</p><p className="mt-3">{product.fabricComposition}</p><p className="mt-3">{product.careInstructions}</p></div></details>
    <div className="mt-7 flex flex-wrap gap-x-6 gap-y-4 text-sm underline underline-offset-4"><Link href="/shipping-policy">配送与运费</Link><Link href="/after-sales-policy">售后政策</Link><Link href="/faq">优惠券与积分说明</Link></div>
    {product.slug === "x1-air-white" ? <ProductCampaignFilm /> : null}
    <ProductDetailArtwork images={product.detailMedia} />
  </section>;
}

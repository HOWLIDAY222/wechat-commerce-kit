import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { ProductPurchaseExperience } from "@/app/products/[slug]/product-purchase-experience";
import { ReleaseCountdown } from "@/app/products/[slug]/release-countdown";
import { FavoriteButton } from "@/components/product/favorite-button";
import { StorefrontPage } from "@/components/storefront/storefront-ui";
import { readCurrentUserSession } from "@/lib/auth/session";
import { BRAND_NAME, BRAND_SITE_URL } from "@/lib/brand";
import { isProductFavorited } from "@/lib/services/favorite-service";
import { getProductBySlug } from "@/lib/services/catalog-service";
import { formatProductPrice, type StorefrontProduct } from "@/lib/storefront-product";

import { isDomesticStorefront } from "@/lib/server/storefront-market";
import { MiniProgramProduct } from "@/components/storefront/mini-program-product";
import { ProductDetailArtwork } from "@/components/product/product-detail-artwork";
import { ProductCampaignFilm } from "@/components/product/campaign-video";

export const dynamic = "force-dynamic";
type ProductRouteProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: ProductRouteProps) {
  const product = await getProductBySlug((await params).slug);
  if (!product) return {};
  return { title: product.name, description: product.summary, alternates: { canonical: `/products/${product.slug}` }, openGraph: { title: product.name, description: product.summary, images: [product.image] } };
}

export default async function ProductDetailPage({ params }: ProductRouteProps) {
  const { slug } = await params;
  if (await isDomesticStorefront()) {
    const product = await getProductBySlug(slug);
    if (!product) notFound();
    return <MiniProgramProduct product={product} />;
  }
  const [product, session] = await Promise.all([getProductBySlug(slug), readCurrentUserSession()]);
  if (!product) notFound();
  const favorited = session ? await isProductFavorited(session.userId, product.slug) : false;
  const images = product.images.length ? product.images : [product.image];
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    sku: product.code,
    image: images.filter(Boolean).map((image) => `${BRAND_SITE_URL}${image}`),
    description: product.summary,
    brand: { "@type": "Brand", name: BRAND_NAME },
    ...(product.release.showPrice && product.minPriceCents > 0 ? { offers: { "@type": "Offer", priceCurrency: "CNY", price: (product.minPriceCents / 100).toFixed(2), availability: product.release.purchasable ? "https://schema.org/InStock" : "https://schema.org/PreOrder", url: `${BRAND_SITE_URL}/products/${product.slug}` } } : {}),
  };

  return (
    <StorefrontPage fullBleed>
      <script dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} type="application/ld+json" />
      <ProductPurchaseExperience
        afterForm={<div className="border-t border-black/10">
          <ProductDisclosure label="设计细节"><p>{product.description || product.summary}</p></ProductDisclosure>
          <ProductDisclosure label="商品详情"><ProductFacts product={product} /></ProductDisclosure>
          {(product.fabricComposition || product.careInstructions) ? <ProductDisclosure label="面料与洗护"><ProductTextRow label="面料" value={product.fabricComposition} /><ProductTextRow label="洗护" value={product.careInstructions} /></ProductDisclosure> : null}
          <ProductDisclosure label="配送与售后"><p>配送时间及费用以结账页实时信息为准。</p><p className="mt-2">贴身衣物的退换条件以售后政策和商品实际状态为准。</p><Link className="mt-3 inline-block font-semibold text-black underline underline-offset-4" href="/after-sales-policy">查看售后政策</Link></ProductDisclosure>
        </div>}
        beforeForm={<>
          <div className="pb-1">
            <div className="flex items-start justify-between gap-5">
              <div>

                <h1 className="text-[48px] font-normal leading-tight md:text-[64px]">{product.name}</h1>
              </div>
              <FavoriteButton initialFavorited={favorited} productName={product.name} productSlug={product.slug} />
            </div>
            {product.release.showPrice ? (
              <div className="mt-5 flex flex-wrap items-baseline gap-3">
                <p className="text-2xl font-semibold">{formatProductPrice(product)}</p>
              </div>
            ) : null}
            <p className="mt-3 max-w-xl text-base leading-7 text-black/65">{product.slug === "x1-air-white" ? product.summary : product.summary}</p>
            {product.release.saleStartsAt && product.release.countdownEnabled ? <div className="mt-5 border-t border-black/10 pt-4"><p className="text-sm font-semibold">开放时间：{formatDate(product.release.saleStartsAt)}</p><ReleaseCountdown saleStartsAt={product.release.saleStartsAt} /></div> : null}
            {product.release.estimatedShipAt ? <p className="mt-3 text-sm text-black/55">{product.release.statusLabel} · 预计 {new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric" }).format(new Date(product.release.estimatedShipAt))}前发货</p> : null}
          </div>
        </>}
        galleryImages={images}
        productName={product.name}
        purchaseFormProps={{ productSlug: product.slug, quantityPricing: product.release.showPrice ? product.quantityPricing : null, release: product.release, variants: product.variants.map((variant) => ({ ...variant, priceCents: product.release.showPrice ? variant.priceCents : null })) }}
      />
      <div className="vk-container">{product.slug === "x1-air-white" ? <ProductCampaignFilm /> : null}<ProductDetailArtwork images={product.detailMedia} /></div>
    </StorefrontPage>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "long", timeStyle: "short" }).format(new Date(value));
}

function ProductFacts({ product }: { product: StorefrontProduct }) {
  const facts = [
    ["版型", product.silhouette],
    ["腰位", product.rise],
    ["后幅", product.coverage],
    ["支撑感", product.supportLevel],
    ["贴合", product.fitNote],
    ["结构", product.features.join("、")],
    ["包装", product.packSize ? `${product.packSize} 件装` : "按所选数量购买"],
    ["商品编码", product.code],
  ].filter(([, value]) => value);
  return <dl className="grid gap-3">{facts.map(([label, value]) => <div className="grid grid-cols-[88px_1fr] gap-4" key={label}><dt className="text-black/50">{label}</dt><dd className="text-black">{value}</dd></div>)}</dl>;
}

function ProductDisclosure({ children, label }: { children: ReactNode; label: string }) {
  return <details className="group border-b border-black/10 py-5"><summary className="flex cursor-pointer list-none items-center justify-between text-base font-semibold"><span>{label}</span><ChevronRight aria-hidden="true" className="h-5 w-5 transition-transform group-open:rotate-90" /></summary><div className="pt-4 whitespace-pre-line text-sm leading-7 text-black/65">{children}</div></details>;
}

function ProductTextRow({ label, value }: { label: string; value: string }) {
  return value ? <p className="mb-3 last:mb-0"><strong className="font-semibold text-black">{label}：</strong>{value}</p> : null;
}

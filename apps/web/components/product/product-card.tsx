import Image from "next/image";
import Link from "next/link";
import { FavoriteButton } from "@/components/product/favorite-button";
import { getQuantityPriceOptions } from "@/lib/commerce/quantity-pricing";
import { formatCents } from "@/lib/money";
import { getProductColorSwatch } from "@/lib/product-merchandising";
import { formatProductPrice, type StorefrontProduct } from "@/lib/storefront-product";
import mediaStyles from "./product-media.module.css";

export function ProductCard({ compact = false, eager = false, favorited = false, product }: { compact?: boolean; eager?: boolean; favorited?: boolean; product: StorefrontProduct }) {
  const primaryImage = findRoleImage(product.images, ["primary", "pack"])
    || product.image
    || product.images[0]
    || "/assets/brand/product-placeholder.webp";
  const hoverImage = findRoleImage(product.images, ["model", "model-full", "lifestyle"], primaryImage)
    || product.images.find((image) => image !== primaryImage);
  const imageSizes = compact ? "(min-width: 768px) 25vw, 50vw" : "(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw";
  const isPreorder = product.release.status === "PREORDER";
  const pricingTiers = getQuantityPriceOptions(product.minPriceCents, product.quantityPricing)
    .map((tier) => `${tier.quantity}条 ${formatCents(tier.totalPriceCents)}`);

  return (
    <article className="group relative min-w-0 bg-white">
      <FavoriteButton
        className="absolute right-3 top-3 z-10"
        initialFavorited={favorited}
        productName={product.name}
        productSlug={product.slug}
      />
      {isPreorder ? <span className="absolute left-3 top-3 z-10 bg-black px-2.5 py-1.5 text-[10px] font-bold tracking-[0.08em] text-white">预售中</span> : null}
      <Link
        href={`/products/${product.slug}`}
        className={`${mediaStyles.cardMedia} vk-product-card-media relative grid place-items-center overflow-hidden bg-[#f3f1ef] ${compact ? "aspect-[4/3]" : "aspect-[4/5]"}`}
      >
        <Image
          src={primaryImage}
          alt={`${product.name} 商品陈列图`}
          width={520}
          height={520}
          className="vk-product-card-primary absolute inset-0 h-full w-full object-contain"
          loading={eager ? "eager" : "lazy"}
          sizes={imageSizes}
        />
        {hoverImage ? (
          <Image
            src={hoverImage}
            alt={`${product.name} 上身展示图`}
            width={520}
            height={520}
            className="vk-product-card-secondary absolute inset-0 h-full w-full object-contain"
            sizes={imageSizes}
          />
        ) : null}
      </Link>
      <div className="grid gap-1 px-1 pb-8 pt-4 md:px-2">
        <Link className="line-clamp-1 text-[14px] font-semibold text-black hover:underline" href={`/products/${product.slug}`}>
          {product.name}
        </Link>
        {product.colors.length ? (
          <div className="order-first mb-1 flex h-5 items-center gap-1.5" aria-label={`${product.colors.length} 种颜色`}>
            {product.colors.slice(0, 5).map((color) => <span className="h-3.5 w-3.5 rounded-full border border-black/20" key={color} style={{ backgroundColor: getProductColorSwatch(color) }} title={color} />)}
            {product.colors.length > 5 ? <span className="text-[11px] font-bold text-muted">+{product.colors.length - 5}</span> : null}
          </div>
        ) : null}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[14px] font-semibold">{product.release.showPrice ? formatProductPrice(product) : product.release.statusLabel}</span>
          {isPreorder && product.quantityPricing?.compareAtUnitPriceCents ? <span className="text-xs text-black/45 line-through">原价 {formatCents(product.quantityPricing.compareAtUnitPriceCents)}</span> : null}
        </div>
        {isPreorder && pricingTiers.length ? <p className="text-xs font-semibold leading-5 text-black/72">{product.quantityPricing?.styles?.[0]?.label ? product.quantityPricing.styles[0].label+"：" : ""}{pricingTiers.join(" · ")}</p> : null}
        {isPreorder && product.release.estimatedShipAt ? <p className="text-[11px] leading-5 text-black/58">预计 {formatShortDate(product.release.estimatedShipAt)}前发货</p> : null}
        {(product.silhouette || product.features[0]) ? <p className="mt-1 line-clamp-1 text-xs text-black/55">{[product.silhouette, product.features[0]].filter(Boolean).join(" · ")}</p> : null}
      </div>
    </article>
  );
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", month: "numeric", day: "numeric" }).format(date);
}

function findRoleImage(images: string[], roles: string[], excluded = "") {
  return images.find((image) => {
    if (image === excluded) return false;
    const fileName = image.split("?")[0]?.split("/").pop() ?? "";
    return roles.some((role) => fileName === `${role}.webp` || new RegExp(`^${role}-v\\d+\\.webp$`).test(fileName));
  });
}

import type { CatalogProduct } from "@/lib/catalog";
import type { ProductReleaseState } from "@/lib/commerce/release-control";
import type { QuantityPricing } from "@/lib/commerce/quantity-pricing";
import { formatCents } from "@/lib/money";
import type { ProductDetailImage } from "@/lib/product-detail-media";

export type StorefrontProduct = CatalogProduct & {
  description: string;
  id: string;
  images: string[];
  detailMedia?: ProductDetailImage[];
  activeSkuCount: number;
  maxPriceCents: number;
  minPriceCents: number;
  quantityPricing: QuantityPricing | null;
  variants: Array<{ color: string; size: string; priceCents: number; availableQuantity: number }>;
  release: ProductReleaseState;
};

export function formatProductPrice(product: Pick<StorefrontProduct, "maxPriceCents" | "minPriceCents" | "priceCents">) {
  const minPrice = product.minPriceCents ?? product.priceCents;
  const maxPrice = product.maxPriceCents ?? product.priceCents;
  if (minPrice <= 0 || maxPrice <= 0) return "未定价";
  if (maxPrice > minPrice) return `${formatCents(minPrice)} - ${formatCents(maxPrice)}`;
  return formatCents(minPrice);
}

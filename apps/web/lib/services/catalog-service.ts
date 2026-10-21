import { isSupportedProductSpecification } from "@/lib/commerce/x1-specifications";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { resolvePublicProductImages } from "@/lib/catalog-media";
import { getProductDetailMedia } from "@/lib/product-detail-media";
import { getCommerceMode, getProductReleaseState } from "@/lib/commerce/release-control";
import { parseQuantityPricing } from "@/lib/commerce/quantity-pricing";
import { X1_AIR_WHITE_QUANTITY_PRICING } from "@/lib/commerce/x1-air-white-pricing";
import { listAdminProducts } from "@/lib/services/admin-catalog-service";
import type { StorefrontProduct } from "@/lib/storefront-product";

export async function listProducts(): Promise<StorefrontProduct[]> {
  const commerceMode = await getCommerceMode();
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const products = await listAdminProducts();
    return products
      .filter((product) => product.status === "ACTIVE")
      .map((product) => mapRuntimeProduct(product, commerceMode))
      .filter((product): product is StorefrontProduct => Boolean(product));
  }

  const products = await prisma.product.findMany({
    where: { status: "ACTIVE" },
    include: {
      skus: { where: { status: "ACTIVE" }, orderBy: [{ color: "asc" }, { size: "asc" }] },
      images: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return products.map((product) => mapPrismaProduct(product, commerceMode)).filter((product): product is StorefrontProduct => Boolean(product));
}

export async function getProductBySlug(slug: string): Promise<StorefrontProduct | null> {
  const commerceMode = await getCommerceMode();
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const products = await listAdminProducts();
    const product = products.find((candidate) => candidate.slug === slug && candidate.status === "ACTIVE");
    return product ? mapRuntimeProduct(product, commerceMode) : null;
  }

  const product = await prisma.product.findFirst({
    where: { slug, status: "ACTIVE" },
    include: {
      skus: { where: { status: "ACTIVE" }, orderBy: [{ color: "asc" }, { size: "asc" }] },
      images: { orderBy: { sortOrder: "asc" } },
    },
  });

  return product ? mapPrismaProduct(product, commerceMode) : null;
}

export async function listProductSlugs() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const products = await listAdminProducts();
    return products.filter((product) => product.status === "ACTIVE").map((product) => product.slug);
  }

  const products = await prisma.product.findMany({
    where: { status: "ACTIVE" },
    select: { slug: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return products.map((product) => product.slug);
}

export async function listProductSitemapEntries() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const products = await listAdminProducts();
    return products
      .filter((product) => product.status === "ACTIVE")
      .map((product) => ({ slug: product.slug, updatedAt: product.updatedAt }));
  }

  return prisma.product.findMany({
    where: { status: "ACTIVE" },
    select: { slug: true, updatedAt: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export function toPublicProductJson(product: StorefrontProduct) {
  if (product.release.showPrice) return product;
  return {
    ...product,
    priceCents: null,
    minPriceCents: null,
    maxPriceCents: null,
    quantityPricing: null,
    variants: product.variants.map((variant) => ({ ...variant, priceCents: null })),
  };
}

function mapRuntimeProduct(product: RuntimeProductForStorefront, commerceMode: Awaited<ReturnType<typeof getCommerceMode>>): StorefrontProduct | null {
  const activeSkus = product.skus.filter((sku) => sku.status === "ACTIVE" && isSupportedProductSpecification(product.slug, sku.color, sku.size));
  const stylePricing = parseQuantityPricing(product.quantityPricing ?? (product.slug === "x1-air-white" ? X1_AIR_WHITE_QUANTITY_PRICING : null));
  const prices = stylePricing?.styles?.map(style => style.unitPriceCents) ?? activeSkus.map((sku) => sku.priceCents);
  const minPriceCents = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPriceCents = prices.length > 0 ? Math.max(...prices) : 0;
  if (!activeSkus.length) return null;
  const images = resolvePublicProductImages(product.slug, product.images.map((image) => image.imageUrl), product.image ?? "");

  return {
    id: product.id,
    description: product.description ?? "",
    images,
    detailMedia: getProductDetailMedia(product.slug),
    slug: product.slug,
    code: toPublicProductCode(product.code),
    name: product.name,
    category: product.category,
    scene: product.scene ?? "",
    summary: product.summary,
    silhouette: product.silhouette ?? "",
    rise: product.rise ?? "",
    coverage: product.coverage ?? "",
    supportLevel: product.supportLevel ?? "",
    fabricComposition: product.fabricComposition ?? "",
    features: product.features ?? [],
    fitNote: product.fitNote ?? "",
    careInstructions: product.careInstructions ?? "",
    packSize: product.packSize ?? null,
    image: images[0] ?? "",
    priceCents: minPriceCents,
    activeSkuCount: activeSkus.length,
    minPriceCents,
    maxPriceCents,
    quantityPricing: parseQuantityPricing(product.quantityPricing ?? (product.slug === "x1-air-white" ? X1_AIR_WHITE_QUANTITY_PRICING : null)),
    variants: activeSkus.map((sku) => ({ color: sku.color, size: sku.size, priceCents: sku.priceCents, availableQuantity: Math.max(0, sku.stockQuantity - sku.reservedQuantity) })),
    release: getProductReleaseState(product, commerceMode),
    colors: Array.from(new Set(activeSkus.map((sku) => sku.color))),
    sizes: Array.from(new Set(activeSkus.map((sku) => sku.size))),
  };
}

function mapPrismaProduct(product: PrismaProductWithCatalogRelations, commerceMode: Awaited<ReturnType<typeof getCommerceMode>>): StorefrontProduct | null {
  product = { ...product, skus: product.skus.filter((sku) => isSupportedProductSpecification(product.slug, sku.color, sku.size)) };
  const stylePricing = parseQuantityPricing(product.quantityPricing);
  const prices = stylePricing?.styles?.map(style => style.unitPriceCents) ?? product.skus.map((sku) => sku.priceCents);
  const minPriceCents = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPriceCents = prices.length > 0 ? Math.max(...prices) : 0;
  if (!product.skus.length) return null;
  const images = resolvePublicProductImages(product.slug, product.images.map((image) => image.imageUrl), product.image ?? "");

  return {
      id: product.id,
      description: product.description ?? "",
      images,
      detailMedia: getProductDetailMedia(product.slug),
      slug: product.slug,
      code: toPublicProductCode(product.code),
      name: product.name,
      category: product.category,
      scene: product.scene ?? "",
      summary: product.summary,
      silhouette: product.silhouette ?? "",
      rise: product.rise ?? "",
      coverage: product.coverage ?? "",
      supportLevel: product.supportLevel ?? "",
      fabricComposition: product.fabricComposition ?? "",
      features: product.features,
      fitNote: product.fitNote ?? "",
      careInstructions: product.careInstructions ?? "",
      packSize: product.packSize,
      image: images[0] ?? "",
      priceCents: minPriceCents,
      activeSkuCount: product.skus.length,
      minPriceCents,
      maxPriceCents,
      quantityPricing: parseQuantityPricing(product.quantityPricing),
      variants: product.skus.map((sku) => ({ color: sku.color, size: sku.size, priceCents: sku.priceCents, availableQuantity: Math.max(0, sku.stockQuantity - sku.reservedQuantity) })),
      release: getProductReleaseState(product, commerceMode),
      colors: Array.from(new Set(product.skus.map((sku) => sku.color))),
      sizes: Array.from(new Set(product.skus.map((sku) => sku.size))),
  };
}

type PrismaProductWithCatalogRelations = Awaited<ReturnType<typeof prisma.product.findMany>>[number] & {
  skus: Array<{
    color: string;
    priceCents: number;
    reservedQuantity: number;
    size: string;
    stockQuantity: number;
  }>;
  images: Array<{
    imageUrl: string;
  }>;
};

type RuntimeProductForStorefront = {
  id: string;
  slug: string;
  code: string;
  name: string;
  category: string;
  scene?: string | null;
  summary: string;
  description?: string | null;
  image?: string | null;
  silhouette?: string | null;
  rise?: string | null;
  coverage?: string | null;
  supportLevel?: string | null;
  fabricComposition?: string | null;
  features?: string[];
  fitNote?: string | null;
  careInstructions?: string | null;
  packSize?: number | null;
  status: string;
  saleMode?: string | null;
  saleStartsAt?: Date | string | null;
  estimatedShipAt?: Date | string | null;
  countdownEnabled?: boolean | null;
  showPrice?: boolean | null;
  quantityPricing?: unknown;
  skus: Array<{
    color: string;
    priceCents: number;
    reservedQuantity: number;
    size: string;
    stockQuantity: number;
    status: string;
  }>;
  images: Array<{
    imageUrl: string;
  }>;
};

function toPublicProductCode(code: string) {
  const retiredPrefix = ["T", "C", "-"].join("");
  return code.replace(new RegExp(`^${retiredPrefix}`, "i"), "VK-");
}

import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { getCommerceMode, getProductReleaseState, type CommerceMode } from "@/lib/commerce/release-control";
import { parseQuantityPricing } from "@/lib/commerce/quantity-pricing";
import { listAdminProducts } from "@/lib/services/admin-catalog-service";
import type { StorefrontProduct } from "@/lib/storefront-product";

export type FavoriteProduct = StorefrontProduct & {
  favoriteCreatedAt: Date | string;
};

const globalForFavorites = globalThis as typeof globalThis & {
  __merchantkitRuntimeFavorites?: Map<string, Set<string>>;
};

const runtimeFavorites = globalForFavorites.__merchantkitRuntimeFavorites ?? new Map<string, Set<string>>();
globalForFavorites.__merchantkitRuntimeFavorites = runtimeFavorites;

export async function listFavoriteProducts(userId: string): Promise<FavoriteProduct[]> {
  const commerceMode = await getCommerceMode();
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const favorites = runtimeFavorites.get(userId) ?? new Set<string>();
    const products = await listAdminProducts();
    return products
      .filter((product) => product.status === "ACTIVE" && favorites.has(product.slug))
      .map((product) => ({
        id: product.id,
        slug: product.slug,
        code: product.code,
        name: product.name,
        category: product.category,
        scene: product.scene ?? "",
        summary: product.summary,
        description: product.description ?? "",
        silhouette: product.silhouette ?? "",
        rise: product.rise ?? "",
        coverage: product.coverage ?? "",
        supportLevel: product.supportLevel ?? "",
        fabricComposition: product.fabricComposition ?? "",
        features: product.features ?? [],
        fitNote: product.fitNote ?? "",
        careInstructions: product.careInstructions ?? "",
        packSize: product.packSize ?? null,
        image: product.images[0]?.imageUrl ?? product.image ?? "",
        images: product.images.map((image) => image.imageUrl),
        priceCents: getMinPrice(product.skus),
        activeSkuCount: product.skus.filter((sku) => sku.status === "ACTIVE").length,
        minPriceCents: getMinPrice(product.skus),
        maxPriceCents: getMaxPrice(product.skus),
        quantityPricing: parseQuantityPricing("quantityPricing" in product ? product.quantityPricing : null),
        variants: product.skus.filter((sku) => sku.status === "ACTIVE").map((sku) => ({
          color: sku.color,
          size: sku.size,
          priceCents: sku.priceCents,
          availableQuantity: Math.max(0, sku.stockQuantity - sku.reservedQuantity),
        })),
        release: getProductReleaseState(product, commerceMode),
        colors: Array.from(new Set(product.skus.filter((sku) => sku.status === "ACTIVE").map((sku) => sku.color))),
        sizes: Array.from(new Set(product.skus.filter((sku) => sku.status === "ACTIVE").map((sku) => sku.size))),
        favoriteCreatedAt: new Date(),
      }));
  }

  const favorites = await prisma.favorite.findMany({
    where: {
      userId,
      product: { status: "ACTIVE" },
    },
    include: {
      product: {
        include: {
          images: { orderBy: { sortOrder: "asc" } },
          skus: { where: { status: "ACTIVE" }, orderBy: [{ color: "asc" }, { size: "asc" }] },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return favorites.map((favorite) => mapFavoriteProduct(favorite, commerceMode));
}

export async function isProductFavorited(userId: string, productSlug: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return Boolean(runtimeFavorites.get(userId)?.has(productSlug));
  }

  const favorite = await prisma.favorite.findFirst({
    where: {
      userId,
      product: { slug: productSlug },
    },
    select: { id: true },
  });
  return Boolean(favorite);
}

export async function addFavoriteProduct(userId: string, productSlug: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const favorites = runtimeFavorites.get(userId) ?? new Set<string>();
    favorites.add(productSlug);
    runtimeFavorites.set(userId, favorites);
    return { productSlug };
  }

  const product = await prisma.product.findFirst({
    where: { slug: productSlug, status: "ACTIVE" },
    select: { id: true, slug: true },
  });
  if (!product) throw new Error("PRODUCT_NOT_FOUND");

  await prisma.favorite.upsert({
    where: {
      userId_productId: {
        productId: product.id,
        userId,
      },
    },
    update: {},
    create: {
      productId: product.id,
      userId,
    },
  });
  return { productSlug: product.slug };
}

export async function removeFavoriteProduct(userId: string, productSlug: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    runtimeFavorites.get(userId)?.delete(productSlug);
    return { productSlug };
  }

  await prisma.favorite.deleteMany({
    where: {
      userId,
      product: { slug: productSlug },
    },
  });
  return { productSlug };
}

function mapFavoriteProduct(favorite: PrismaFavoriteWithProduct, commerceMode: CommerceMode): FavoriteProduct {
  const prices = favorite.product.skus.map((sku) => sku.priceCents);
  const minPriceCents = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPriceCents = prices.length > 0 ? Math.max(...prices) : 0;

  return {
    id: favorite.product.id,
    slug: favorite.product.slug,
    code: favorite.product.code,
    name: favorite.product.name,
    category: favorite.product.category,
    scene: favorite.product.scene ?? "",
    summary: favorite.product.summary,
    description: favorite.product.description ?? "",
    silhouette: favorite.product.silhouette ?? "",
    rise: favorite.product.rise ?? "",
    coverage: favorite.product.coverage ?? "",
    supportLevel: favorite.product.supportLevel ?? "",
    fabricComposition: favorite.product.fabricComposition ?? "",
    features: favorite.product.features,
    fitNote: favorite.product.fitNote ?? "",
    careInstructions: favorite.product.careInstructions ?? "",
    packSize: favorite.product.packSize,
    image: favorite.product.images[0]?.imageUrl ?? favorite.product.image ?? "",
    images: favorite.product.images.map((image) => image.imageUrl),
    priceCents: minPriceCents,
    activeSkuCount: favorite.product.skus.length,
    minPriceCents,
    maxPriceCents,
    quantityPricing: parseQuantityPricing(favorite.product.quantityPricing),
    variants: favorite.product.skus.map((sku) => ({
      color: sku.color,
      size: sku.size,
      priceCents: sku.priceCents,
      availableQuantity: Math.max(0, sku.stockQuantity - sku.reservedQuantity),
    })),
    release: getProductReleaseState(favorite.product, commerceMode),
    colors: Array.from(new Set(favorite.product.skus.map((sku) => sku.color))),
    sizes: Array.from(new Set(favorite.product.skus.map((sku) => sku.size))),
    favoriteCreatedAt: favorite.createdAt,
  };
}

function getMinPrice(skus: Array<{ priceCents: number; status: string }>) {
  const prices = skus.filter((sku) => sku.status === "ACTIVE").map((sku) => sku.priceCents);
  return prices.length ? Math.min(...prices) : 0;
}

function getMaxPrice(skus: Array<{ priceCents: number; status: string }>) {
  const prices = skus.filter((sku) => sku.status === "ACTIVE").map((sku) => sku.priceCents);
  return prices.length ? Math.max(...prices) : 0;
}

type PrismaFavoriteWithProduct = Awaited<ReturnType<typeof prisma.favorite.findMany>>[number] & {
  product: {
    id: string;
    slug: string;
    code: string;
    name: string;
    category: string;
    scene: string | null;
    summary: string;
    description: string | null;
    image: string | null;
    silhouette: string | null;
    rise: string | null;
    coverage: string | null;
    supportLevel: string | null;
    fabricComposition: string | null;
    features: string[];
    fitNote: string | null;
    careInstructions: string | null;
    packSize: number | null;
    saleMode: string;
    saleStartsAt: Date | null;
    estimatedShipAt: Date | null;
    countdownEnabled: boolean;
    showPrice: boolean;
    quantityPricing: unknown;
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
};

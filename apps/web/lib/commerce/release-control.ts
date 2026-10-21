import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";

export type CommerceMode = "SHOWCASE" | "OPEN" | "PAUSED";
export type ProductSaleMode = "SHOWCASE" | "PREORDER" | "IN_STOCK" | "PAUSED";
export type ProductReleaseState = {
  commerceMode: CommerceMode;
  saleMode: ProductSaleMode;
  purchasable: boolean;
  status: "SHOWCASE" | "UPCOMING" | "PREORDER" | "IN_STOCK" | "PAUSED";
  statusLabel: string;
  saleStartsAt: string | null;
  estimatedShipAt: string | null;
  countdownEnabled: boolean;
  showPrice: boolean;
};

type ProductReleaseInput = {
  saleMode?: ProductSaleMode | string | null;
  saleStartsAt?: Date | string | null;
  estimatedShipAt?: Date | string | null;
  countdownEnabled?: boolean | null;
  showPrice?: boolean | null;
};

export async function getCommerceMode(): Promise<CommerceMode> {
  try {
    if (appConfig.COMMERCE_STORAGE !== "prisma") {
      const { listAdminSettings } = await import("@/lib/services/admin-ops-service");
      const setting = (await listAdminSettings()).find((row) => row.key === "commerceMode");
      return parseCommerceMode(setting?.value);
    }
    const setting = await prisma.siteSetting.findUnique({ where: { key: "commerceMode" }, select: { value: true } });
    return parseCommerceMode(setting?.value);
  } catch (error) {
    console.warn("commerce.mode.fallback", {
      error: error instanceof Error ? error.message : "COMMERCE_MODE_READ_FAILED",
    });
    return "SHOWCASE";
  }
}

export function getProductReleaseState(
  product: ProductReleaseInput,
  commerceMode: CommerceMode,
  now = new Date(),
): ProductReleaseState {
  const saleMode = parseProductSaleMode(product.saleMode);
  const saleStartsAt = toValidDate(product.saleStartsAt);
  const estimatedShipAt = toValidDate(product.estimatedShipAt);
  const isUpcoming = saleMode === "PREORDER" && Boolean(saleStartsAt && saleStartsAt.getTime() > now.getTime());
  const globallyOpen = commerceMode === "OPEN";

  let status: ProductReleaseState["status"] = "SHOWCASE";
  if (commerceMode === "PAUSED" || saleMode === "PAUSED") status = "PAUSED";
  else if (isUpcoming) status = "UPCOMING";
  else if (saleMode === "PREORDER") status = "PREORDER";
  else if (saleMode === "IN_STOCK") status = "IN_STOCK";

  return {
    commerceMode,
    saleMode,
    purchasable: globallyOpen && (status === "PREORDER" || status === "IN_STOCK"),
    status,
    statusLabel: getReleaseStatusLabel(status),
    saleStartsAt: saleStartsAt?.toISOString() ?? null,
    estimatedShipAt: estimatedShipAt?.toISOString() ?? null,
    countdownEnabled: Boolean(product.countdownEnabled && saleStartsAt),
    showPrice: Boolean(product.showPrice),
  };
}

export function assertCommerceOpen(mode: CommerceMode) {
  if (mode === "SHOWCASE") throw new Error("COMMERCE_SHOWCASE_ONLY");
  if (mode === "PAUSED") throw new Error("COMMERCE_PAUSED");
}

export function assertProductPurchasable(product: ProductReleaseInput, mode: CommerceMode, now = new Date()) {
  assertCommerceOpen(mode);
  const state = getProductReleaseState(product, mode, now);
  if (state.status === "UPCOMING") throw new Error("PRODUCT_SALE_NOT_STARTED");
  if (state.status === "PAUSED") throw new Error("PRODUCT_SALE_PAUSED");
  if (!state.purchasable) throw new Error("PRODUCT_SHOWCASE_ONLY");
  return state;
}

function parseCommerceMode(value: unknown): CommerceMode {
  const candidate = typeof value === "string" ? value : readObjectString(value, "mode");
  return candidate === "OPEN" || candidate === "PAUSED" ? candidate : "SHOWCASE";
}

function parseProductSaleMode(value: unknown): ProductSaleMode {
  return value === "PREORDER" || value === "IN_STOCK" || value === "PAUSED" ? value : "SHOWCASE";
}

function readObjectString(value: unknown, key: string) {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : undefined;
}

function toValidDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getReleaseStatusLabel(status: ProductReleaseState["status"]) {
  if (status === "UPCOMING") return "即将开放";
  if (status === "PREORDER") return "预售中";
  if (status === "IN_STOCK") return "现货发售";
  if (status === "PAUSED") return "暂未开放";
  return "系列展示";
}

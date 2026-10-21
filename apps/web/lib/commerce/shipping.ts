import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { calculateShippingQuote, type ShippingRateConfig } from "@/lib/commerce/shipping-rates";

export async function getConfiguredShippingFeeCents(): Promise<number | null> {
  return (await getShippingRateConfig())?.baseFeeCents ?? null;
}

export async function getShippingRateConfig(): Promise<ShippingRateConfig | null> {
  const keys = ["shippingFeeCents", "shippingRemoteFeeCents", "shippingFarRemoteFeeCents"];
  const settings = appConfig.COMMERCE_STORAGE !== "prisma"
    ? await import("@/lib/services/admin-ops-service").then(({ listAdminSettings }) => listAdminSettings())
    : await prisma.siteSetting.findMany({ where: { key: { in: keys } }, select: { key: true, value: true } });
  const values = new Map(settings.map((setting) => [setting.key, parseShippingFee(setting.value)]));
  const baseFeeCents = values.get("shippingFeeCents") ?? null;
  const remoteFeeCents = values.get("shippingRemoteFeeCents") ?? null;
  const farRemoteFeeCents = values.get("shippingFarRemoteFeeCents") ?? null;
  if (baseFeeCents === null || remoteFeeCents === null || farRemoteFeeCents === null) return null;
  return { baseFeeCents, remoteFeeCents, farRemoteFeeCents };
}

export async function requireShippingQuote(province: string) {
  const config = await getShippingRateConfig();
  if (!config) throw new Error("SHIPPING_FEE_CONFIGURATION_REQUIRED");
  return calculateShippingQuote(province, config);
}

export async function requireConfiguredShippingFeeCents(province?: string) {
  if (province) return (await requireShippingQuote(province)).feeCents;
  const value = await getConfiguredShippingFeeCents();
  if (value === null) throw new Error("SHIPPING_FEE_CONFIGURATION_REQUIRED");
  return value;
}

function parseShippingFee(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 99900 ? value : null;
}

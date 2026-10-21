import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { normalizeXProfileUrl } from "@/lib/international-market";
import { OFFICIAL_X_PROFILE_URL } from "@/lib/official-social";

const publicSiteSettingKeys = ["supportEmail", "supportPhone", "siteName", "xProfileUrl"] as const;

type PublicSiteSettingKey = (typeof publicSiteSettingKeys)[number];

export type PublicSiteSettings = Record<PublicSiteSettingKey, string>;

export async function getPublicSiteSettings(): Promise<PublicSiteSettings> {
  const settings: PublicSiteSettings = {
    supportEmail: "",
    supportPhone: "",
    siteName: "MerchantKit",
    xProfileUrl: OFFICIAL_X_PROFILE_URL,
  };

  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const { listAdminSettings } = await import("@/lib/services/admin-ops-service");
    applyPublicSiteSettings(settings, await listAdminSettings());
    return settings;
  }

  try {
    const rows = await prisma.siteSetting.findMany({
      where: {
        key: {
          in: [...publicSiteSettingKeys],
        },
      },
      select: {
        key: true,
        value: true,
      },
    });

    applyPublicSiteSettings(settings, rows);
  } catch (error) {
    console.warn("public.site_settings.fallback", {
      error: error instanceof Error ? error.message : "PUBLIC_SITE_SETTINGS_READ_FAILED",
    });
  }

  return settings;
}

function applyPublicSiteSettings(settings: PublicSiteSettings, rows: Array<{ key: string; value: unknown }>) {
  for (const row of rows) {
    if (!isPublicSiteSettingKey(row.key)) continue;
    const value = sanitizePublicValue(row.key, stringifyPublicSettingValue(row.value));
    if (value) settings[row.key] = value;
  }
}

function sanitizePublicValue(key: PublicSiteSettingKey, value: string) {
  const singleLine = value.split(/\r?\n/).map((item) => item.trim()).find(Boolean) ?? "";
  if (key === "supportEmail") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(singleLine) ? singleLine : "";
  if (key === "xProfileUrl") return normalizeXProfileUrl(singleLine);
  if (key === "siteName") return singleLine.slice(0, 80) || "MerchantKit";
  return singleLine.slice(0, 40);
}

function isPublicSiteSettingKey(value: string): value is PublicSiteSettingKey {
  return (publicSiteSettingKeys as readonly string[]).includes(value);
}

function stringifyPublicSettingValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

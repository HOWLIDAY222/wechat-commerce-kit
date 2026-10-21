import { appConfig } from "@/lib/config";
import {
  contentSettingKeys,
  getDefaultContentSettings,
  isContentSettingKey,
  type ContentSettingKey,
  type PublicContentSettings,
} from "@/lib/content-settings";
import { prisma } from "@/lib/db/prisma";

export async function getPublicContentSettings(): Promise<PublicContentSettings> {
  const content = getDefaultContentSettings();

  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const { listAdminSettings } = await import("@/lib/services/admin-ops-service");
    applyContentSettings(content, await listAdminSettings());
    return content;
  }

  try {
    const settings = await prisma.siteSetting.findMany({
      where: {
        key: {
          in: [...contentSettingKeys],
        },
      },
      select: {
        key: true,
        value: true,
      },
    });

    applyContentSettings(content, settings);
  } catch (error) {
    console.warn("content.public_settings.fallback", {
      error: error instanceof Error ? error.message : "CONTENT_SETTINGS_READ_FAILED",
    });
  }

  return content;
}

export async function getPublicContentSetting(key: ContentSettingKey) {
  const content = await getPublicContentSettings();
  return content[key];
}

function applyContentSettings(content: PublicContentSettings, settings: Array<{ key: string; value: unknown }>) {
  for (const setting of settings) {
    if (isContentSettingKey(setting.key) && typeof setting.value === "string" && setting.value.trim()) {
      content[setting.key] = setting.value;
    }
  }
}

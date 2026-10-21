import { OFFICIAL_XIAOHONGSHU_PROFILE_URL, OFFICIAL_X_PROFILE_URL } from "@/lib/official-social";

export type FooterNavigationLink = {
  label: string;
  href: string;
};

export type FooterNavigationColumn = {
  title: string;
  links: FooterNavigationLink[];
};

export type SocialChannel = {
  label: string;
  account: string;
  url: string;
  visible: boolean;
};

export const footerNavigationSettingKey = "content.footer.navigation" as const;
export const socialChannelsSettingKey = "content.social.channels" as const;

export const structuredContentSettingKeys = [footerNavigationSettingKey, socialChannelsSettingKey] as const;

export const defaultFooterNavigation: FooterNavigationColumn[] = [
  {
    title: "购物指南",
    links: [
      { label: "选购帮助", href: "/shopping-guide" },
      { label: "尺码指南", href: "/size-guide" },
      { label: "配送方式", href: "/shipping-policy" },
      { label: "支付方式", href: "/payment-methods" },
    ],
  },
  {
    title: "售后服务",
    links: [
      { label: "退换货政策", href: "/return-policy" },
      { label: "售后流程", href: "/after-sales-process" },
      { label: "常见问题", href: "/faq" },
      { label: "联系我们", href: "/contact" },
    ],
  },
  {
    title: "关于我们",
    links: [
      { label: "品牌故事", href: "/about" },
      { label: "官方渠道", href: "/official-channels" },
      { label: "隐私政策", href: "/privacy-policy" },
      { label: "服务条款", href: "/terms" },
    ],
  },
];

export const defaultSocialChannels: SocialChannel[] = [
  { label: "X", account: "@MerchantKit", url: OFFICIAL_X_PROFILE_URL, visible: true },
  { label: "微信", account: "", url: "", visible: true },
  { label: "微博", account: "", url: "", visible: true },
  { label: "小红书", account: "MerchantKit", url: OFFICIAL_XIAOHONGSHU_PROFILE_URL, visible: true },
  { label: "抖音", account: "", url: "", visible: true },
  { label: "TikTok", account: "", url: "", visible: true },
];

export function isStructuredContentSettingKey(value: string): value is (typeof structuredContentSettingKeys)[number] {
  return (structuredContentSettingKeys as readonly string[]).includes(value);
}

export function stringifyFooterNavigation(value: FooterNavigationColumn[] = defaultFooterNavigation) {
  return JSON.stringify(normalizeFooterNavigation(value, true), null, 2);
}

export function stringifySocialChannels(value: SocialChannel[] = defaultSocialChannels) {
  return JSON.stringify(normalizeSocialChannels(value, true), null, 2);
}

export function parseFooterNavigationSetting(value: unknown) {
  try {
    return normalizeFooterNavigation(parseJsonish(value), false);
  } catch {
    return defaultFooterNavigation;
  }
}

export function parseSocialChannelsSetting(value: unknown) {
  try {
    return normalizeSocialChannels(parseJsonish(value), false);
  } catch {
    return defaultSocialChannels;
  }
}

export function normalizeContentSettingValue(key: string, value: string) {
  if (key === footerNavigationSettingKey) return stringifyFooterNavigation(normalizeFooterNavigation(parseJsonish(value), true));
  if (key === socialChannelsSettingKey) return stringifySocialChannels(normalizeSocialChannels(parseJsonish(value), true));
  return value.trim();
}

function parseJsonish(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return JSON.parse(value);
}

function normalizeFooterNavigation(value: unknown, strict: boolean): FooterNavigationColumn[] {
  if (!Array.isArray(value)) throw new Error("FOOTER_NAVIGATION_MUST_BE_ARRAY");
  const columns = value.slice(0, 6).flatMap((column) => {
    if (!isRecord(column)) {
      if (strict) throw new Error("FOOTER_NAVIGATION_COLUMN_INVALID");
      return [];
    }
    const title = cleanText(column.title, 24);
    if (!title) {
      if (strict) throw new Error("FOOTER_NAVIGATION_TITLE_REQUIRED");
      return [];
    }
    if (!Array.isArray(column.links)) {
      if (strict) throw new Error("FOOTER_NAVIGATION_LINKS_REQUIRED");
      return [];
    }
    const links = column.links.slice(0, 8).flatMap((link) => {
      if (!isRecord(link)) {
        if (strict) throw new Error("FOOTER_NAVIGATION_LINK_INVALID");
        return [];
      }
      const label = cleanText(link.label, 24);
      const href = normalizeFooterHref(link.href, strict);
      if (!label || !href) {
        if (strict) throw new Error("FOOTER_NAVIGATION_LINK_REQUIRED");
        return [];
      }
      return { label, href };
    });
    if (links.length === 0) {
      if (strict) throw new Error("FOOTER_NAVIGATION_LINKS_EMPTY");
      return [];
    }
    return { title, links };
  });
  if (columns.length === 0) throw new Error("FOOTER_NAVIGATION_EMPTY");
  return columns;
}

function normalizeSocialChannels(value: unknown, strict: boolean): SocialChannel[] {
  if (!Array.isArray(value)) throw new Error("SOCIAL_CHANNELS_MUST_BE_ARRAY");
  const channels = value.slice(0, 12).flatMap((channel) => {
    if (!isRecord(channel)) {
      if (strict) throw new Error("SOCIAL_CHANNEL_INVALID");
      return [];
    }
    const label = cleanText(channel.label, 24);
    const account = cleanText(channel.account, 120);
    const url = normalizeExternalUrl(channel.url, strict);
    const visible = typeof channel.visible === "boolean" ? channel.visible : true;
    if (!label) {
      if (strict) throw new Error("SOCIAL_CHANNEL_LABEL_REQUIRED");
      return [];
    }
    return { label, account, url, visible };
  });
  if (channels.length === 0) throw new Error("SOCIAL_CHANNELS_EMPTY");
  return channels;
}

function normalizeFooterHref(value: unknown, strict: boolean) {
  const href = cleanText(value, 200);
  if (!href) return "";
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  return normalizeHttpUrl(href, strict, "FOOTER_NAVIGATION_HREF_INVALID");
}

function normalizeExternalUrl(value: unknown, strict: boolean) {
  const rawUrl = cleanText(value, 240);
  if (!rawUrl) return "";
  const url = normalizeHttpUrl(rawUrl, strict, "SOCIAL_CHANNEL_URL_INVALID");
  if (!url) return "";
  if (hasSuspiciousExternalUrlText(rawUrl) || hasSuspiciousExternalUrlText(safeDecodeUri(url))) {
    if (strict) throw new Error("SOCIAL_CHANNEL_URL_SUSPICIOUS");
    return "";
  }
  return url;
}

function normalizeHttpUrl(value: string, strict: boolean, errorCode: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(errorCode);
    return url.toString();
  } catch {
    if (strict) throw new Error(errorCode);
    return "";
  }
}

function hasSuspiciousExternalUrlText(value: string) {
  return /[\u0000-\u001f\s]/.test(value) || /%20/i.test(value) || /@\w+(?:\.\w+)+/i.test(value) || /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(value);
}

function safeDecodeUri(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

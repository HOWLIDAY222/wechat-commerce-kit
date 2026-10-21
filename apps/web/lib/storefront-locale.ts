export type StorefrontLocale = "zh-CN" | "en";

const ENGLISH_PREFIX = "/en";
const INTERNATIONAL_BLOCKED_PREFIXES = ["/account", "/auth", "/bag", "/checkout", "/mini-program"];

export function isEnglishStorefrontPath(pathname: string) {
  return pathname === ENGLISH_PREFIX || pathname.startsWith(`${ENGLISH_PREFIX}/`);
}

export function getStorefrontLocaleFromPathname(pathname: string): StorefrontLocale {
  return isEnglishStorefrontPath(pathname) ? "en" : "zh-CN";
}

export function stripStorefrontLocale(pathname: string) {
  if (!isEnglishStorefrontPath(pathname)) return pathname || "/";
  const stripped = pathname.slice(ENGLISH_PREFIX.length);
  return stripped || "/";
}

export function localizeStorefrontHref(href: string, locale: StorefrontLocale) {
  if (!href.startsWith("/")) return href;
  const match = href.match(/^([^?#]*)(.*)$/u);
  const pathname = match?.[1] || "/";
  const suffix = match?.[2] || "";
  const basePath = stripStorefrontLocale(pathname);

  if (locale === "zh-CN") return `${basePath}${suffix}`;
  if (INTERNATIONAL_BLOCKED_PREFIXES.some((prefix) => basePath === prefix || basePath.startsWith(`${prefix}/`))) {
    return "/en/availability";
  }
  return `${basePath === "/" ? ENGLISH_PREFIX : `${ENGLISH_PREFIX}${basePath}`}${suffix}`;
}

export function getLanguageSwitchHref(pathname: string) {
  if (pathname === "/en/availability") return "/";
  return isEnglishStorefrontPath(pathname)
    ? localizeStorefrontHref(pathname, "zh-CN")
    : localizeStorefrontHref(pathname, "en");
}

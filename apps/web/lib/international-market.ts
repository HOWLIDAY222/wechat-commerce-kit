const X_PROFILE_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);

export const internationalMarket = {
  checkoutEnabled: false,
  shippingEnabled: false,
  paymentEnabled: false,
  status: "COMING_SOON" as const,
};

export function normalizeXProfileUrl(value: string | null | undefined) {
  const candidate = value?.trim();
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" || !X_PROFILE_HOSTS.has(url.hostname.toLowerCase())) return "";
    const pathParts = url.pathname.split("/").filter(Boolean);
    if (!pathParts.length || pathParts[0] === "intent" || pathParts[0] === "share") return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function getConfiguredXProfileUrl() {
  return normalizeXProfileUrl(process.env.NEXT_PUBLIC_X_PROFILE_URL);
}

export const X_PRODUCT_CAMPAIGN_PATH = "/en/products/x1-air-white?utm_source=x&utm_medium=social&utm_campaign=x1_preorder";

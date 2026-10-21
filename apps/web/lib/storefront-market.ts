export const DOMESTIC_DOMAIN = "example.invalid.cn";
export const MINI_PROGRAM_PATH = "/mini-program";
export const MINI_PROGRAM_NAME = "MerchantKit商城";

// Use the Host preserved by the web server, never a client-supplied market flag
// or X-Forwarded-Host. Language does not determine the purchase channel.
export function isDomesticHost(host: string | null | undefined) {
  const hostname = (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  return hostname === DOMESTIC_DOMAIN || hostname === `www.${DOMESTIC_DOMAIN}`;
}

export function isWebPaymentPage(pathname: string) {
  const path = pathname.replace(/^\/en(?=\/)/, "").replace(/\/$/, "");
  return path === "/checkout" || path.startsWith("/checkout/") || path === "/payment-methods";
}

export function domesticPurchaseLink<T extends { href: string; label: string }>(link: T): T {
  const pathname = link.href.split(/[?#]/)[0];
  return isWebPaymentPage(pathname) ? { ...link, href: MINI_PROGRAM_PATH, label: "小程序购买" } : link;
}

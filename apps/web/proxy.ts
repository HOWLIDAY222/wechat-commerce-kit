import { NextRequest, NextResponse } from "next/server";
import { isDomesticHost, isWebPaymentPage, MINI_PROGRAM_PATH } from "@/lib/storefront-market";
import { adminSessionCookieName, sessionCookieName } from "@/lib/auth/session";

const customerProtectedRoutes = ["/account"];
const adminRoutes = ["/admin", "/api/admin"];
const publicAdminRoutes = ["/admin/login"];
const adminWorkspaceRedirects: Array<[string, string]> = [
  ["/admin/content", "/admin/design"],
  ["/admin/seo", "/admin/design/seo"],
  ["/admin/payments", "/admin/orders"],
  ["/admin/payment-notifications", "/admin/orders"],
  ["/admin/shipments", "/admin/orders"],
  ["/admin/refunds", "/admin/after-sales"],
  ["/admin/reshipments", "/admin/after-sales"],
  ["/admin/inventory", "/admin/products"],
  ["/admin/releases", "/admin/products"],
  ["/admin/audit-logs", "/admin/audit"],
  ["/admin/system-health", "/admin/settings?section=status"],
  ["/admin/operations/data", "/admin/settings?section=data"],
  ["/admin/operations", "/admin"],
  ["/admin/dashboard", "/admin"],
  ["/admin/customer-care", "/admin/users"],
];
const legacyRedirects = new Map([
  ["/index.html", "/"],
  ["/login.html", "/auth/login"],
  ["/register.html", "/auth/login"],
  ["/forgot-password.html", "/auth/login"],
  ["/pages/shopping-guide.html", "/shopping-guide"],
  ["/pages/shop.html", "/shop"],
  ["/pages/products.html", "/products"],
  ["/pages/product-vk-01.html", "/shop"],
  ["/pages/product-vk-s02.html", "/shop"],
  ["/pages/product-vk-b03.html", "/shop"],
  ["/pages/product-vk-q04.html", "/products"],
  ["/pages/new-arrivals.html", "/products"],
  ["/pages/category-underwear.html", "/shop"],
  ["/pages/category-socks.html", "/shop"],
  ["/pages/category-bundles.html", "/shop"],
  ["/pages/bag.html", "/bag"],
  ["/pages/checkout.html", "/checkout"],
  ["/pages/payment.html", "/payment-methods"],
  ["/pages/payment-methods.html", "/payment-methods"],
  ["/pages/account.html", "/account"],
  ["/pages/client-center.html", "/account"],
  ["/pages/orders.html", "/account/orders"],
  ["/pages/favorites.html", "/account"],
  ["/pages/contact.html", "/contact"],
  ["/pages/support.html", "/contact"],
  ["/pages/faq.html", "/faq"],
  ["/pages/official-channels.html", "/official-channels"],
  ["/pages/careers.html", "/careers"],
  ["/pages/about.html", "/about"],
  ["/pages/privacy.html", "/privacy-policy"],
  ["/pages/policy.html", "/privacy-policy"],
  ["/pages/terms.html", "/terms"],
  ["/pages/returns.html", "/return-policy"],
  ["/pages/shipping.html", "/shipping-policy"],
  ["/pages/after-sales-policy.html", "/after-sales-policy"],
  ["/pages/after-sales.html", "/after-sales-process"],
  ["/pages/after-sales-process.html", "/after-sales-process"],
  ["/pages/services.html", "/after-sales-process"],
  ["/pages/size-guide.html", "/size-guide"],
  ["/pages/guide.html", "/size-guide"],
  ["/pages/fabric-tech.html", "/size-guide"],
  ["/pages/styling.html", "/size-guide"],
  ["/pages/quality-control.html", "/after-sales-policy"],
  ["/pages/essentials.html", "/shop"],
  ["/pages/compare.html", "/shop"],
  ["/pages/search.html", "/shop"],
  ["/pages/vision.html", "/about"],
  ["/pages/governance.html", "/about"],
  ["/pages/order-guide.html", "/shipping-policy"],
  ["/pages/media-kit.html", "/contact"],
  ["/pages/responsibility.html", "/about"],
  ["/pages/investor-relations.html", "/about"],
  ["/pages/locations.html", "/contact"],
  ["/pages/flight-workshop.html", "/about"],
  ["/pages/brand-service.html", "/contact"],
  ["/pages/leadership.html", "/about"],
  ["/pages/ai-visual.html", "/about"],
  ["/pages/milestones.html", "/about"],
  ["/pages/fulfillment.html", "/shipping-policy"],
  ["/pages/updates.html", "/about"],
  ["/pages/ecommerce-support.html", "/contact"],
  ["/pages/sitemap.html", "/sitemap.xml"],
  ["/shopping-guide.html", "/shopping-guide"],
  ["/shop.html", "/shop"],
  ["/products.html", "/products"],
  ["/new-arrivals.html", "/products"],
  ["/product-vk-01.html", "/shop"],
  ["/product-vk-s02.html", "/shop"],
  ["/product-vk-b03.html", "/shop"],
  ["/product-vk-q04.html", "/products"],
  ["/category-underwear.html", "/shop"],
  ["/category-socks.html", "/shop"],
  ["/category-bundles.html", "/shop"],
  ["/bag.html", "/bag"],
  ["/checkout.html", "/checkout"],
  ["/payment.html", "/payment-methods"],
  ["/payment-methods.html", "/payment-methods"],
  ["/account.html", "/account"],
  ["/client-center.html", "/account"],
  ["/orders.html", "/account/orders"],
  ["/favorites.html", "/account"],
  ["/contact.html", "/contact"],
  ["/support.html", "/contact"],
  ["/faq.html", "/faq"],
  ["/official-channels.html", "/official-channels"],
  ["/careers.html", "/careers"],
  ["/about.html", "/about"],
  ["/privacy.html", "/privacy-policy"],
  ["/policy.html", "/privacy-policy"],
  ["/terms.html", "/terms"],
  ["/returns.html", "/return-policy"],
  ["/shipping.html", "/shipping-policy"],
  ["/after-sales-policy.html", "/after-sales-policy"],
  ["/after-sales.html", "/after-sales-process"],
  ["/after-sales-process.html", "/after-sales-process"],
  ["/services.html", "/after-sales-process"],
  ["/size-guide.html", "/size-guide"],
  ["/guide.html", "/size-guide"],
  ["/fabric-tech.html", "/size-guide"],
  ["/styling.html", "/size-guide"],
  ["/quality-control.html", "/after-sales-policy"],
  ["/essentials.html", "/shop"],
  ["/compare.html", "/shop"],
  ["/search.html", "/shop"],
  ["/sitemap.html", "/sitemap.xml"],
  ["/admin.html", "/admin"],
  ["/account/index.html", "/account"],
  ["/account/profile/index.html", "/account"],
  ["/account/settings/index.html", "/account/settings"],
  ["/account/addresses/index.html", "/account/addresses"],
  ["/account/orders/index.html", "/account/orders"],
  ["/account/orders/detail.html", "/account/orders"],
  ["/account/orders/after-sales.html", "/account/orders"],
  ["/account/after-sales/index.html", "/account/after-sales"],
  ["/account/after-sales/detail.html", "/account/after-sales"],
  ["/account/favorites/index.html", "/account"],
  ["/admin/index.html", "/admin"],
  ["/admin/users/index.html", "/admin/users"],
  ["/admin/users/detail.html", "/admin/users"],
]);

function matchesRoute(pathname: string, routes: string[]) {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const legacyDestination = getLegacyDestination(pathname);

  if (isDomesticHost(request.headers.get("host")) && isWebPaymentPage(legacyDestination ?? pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = MINI_PROGRAM_PATH;
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  if (legacyDestination) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = legacyDestination;
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl, 301);
  }

  const adminWorkspaceDestination = pathname === "/admin/inventory/logs" ? undefined : adminWorkspaceRedirects.find(([source]) => pathname === source || pathname.startsWith(`${source}/`))?.[1];
  if (adminWorkspaceDestination) {
    const redirectUrl = request.nextUrl.clone();
    const [destinationPath, destinationSearch] = adminWorkspaceDestination.split("?");
    redirectUrl.pathname = destinationPath;
    redirectUrl.search = destinationSearch ? `?${destinationSearch}` : "";
    return NextResponse.redirect(redirectUrl);
  }

  if ((pathname === "/checkout" || matchesRoute(pathname, customerProtectedRoutes)) && !request.cookies.get(sessionCookieName)?.value) {
    const loginUrl = new URL("/auth/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (matchesRoute(pathname, adminRoutes) && !matchesRoute(pathname, publicAdminRoutes)) {
    if (!request.cookies.get(adminSessionCookieName)?.value) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
      }
      const loginUrl = new URL("/admin/login", request.url);
      loginUrl.searchParams.set("returnTo", pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  if (pathname === "/en" || pathname.startsWith("/en/")) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-vk-locale", "en");
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  return NextResponse.next();
}

function getLegacyDestination(pathname: string) {
  const exact = legacyRedirects.get(pathname);
  if (exact) return exact;

  if (pathname.startsWith("/pages/") && pathname.endsWith(".html")) {
    return "/shop";
  }

  if (pathname.startsWith("/account/") && pathname.endsWith(".html")) {
    return "/account";
  }

  if (pathname.startsWith("/admin/") && pathname.endsWith(".html")) {
    return "/admin";
  }

  return null;
}

export const config = {
  matcher: [
    "/index.html",
    "/login.html",
    "/register.html",
    "/forgot-password.html",
    "/shopping-guide.html",
    "/shop.html",
    "/products.html",
    "/new-arrivals.html",
    "/product-vk-01.html",
    "/product-vk-s02.html",
    "/product-vk-b03.html",
    "/product-vk-q04.html",
    "/category-underwear.html",
    "/category-socks.html",
    "/category-bundles.html",
    "/bag.html",
    "/checkout.html",
    "/payment.html",
    "/payment-methods.html",
    "/account.html",
    "/client-center.html",
    "/orders.html",
    "/favorites.html",
    "/contact.html",
    "/support.html",
    "/faq.html",
    "/official-channels.html",
    "/careers.html",
    "/about.html",
    "/privacy.html",
    "/policy.html",
    "/terms.html",
    "/returns.html",
    "/shipping.html",
    "/after-sales-policy.html",
    "/after-sales.html",
    "/after-sales-process.html",
    "/services.html",
    "/size-guide.html",
    "/guide.html",
    "/fabric-tech.html",
    "/styling.html",
    "/quality-control.html",
    "/essentials.html",
    "/compare.html",
    "/search.html",
    "/sitemap.html",
    "/admin.html",
    "/pages/:path*",
    "/checkout/:path*",
    "/payment-methods",
    "/account/:path*",
    "/admin/:path*",
    "/api/admin/:path*",
    "/en/:path*",
  ],
};

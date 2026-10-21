import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteHeader } from "@/components/layout/site-header";
import { AnalyticsProvider } from "@/components/analytics/analytics-provider";
import { BRAND_NAME, BRAND_SITE_URL } from "@/lib/brand";
import { StorefrontFrame } from "@/components/layout/storefront-frame";
import "./globals.css";
import "./ui-enhancements.css";
import { decodeConsentCookie, privacyConsentCookieName } from "@/lib/services/analytics-service";

const siteUrl = BRAND_SITE_URL;

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${BRAND_NAME} X1 Air White | 当前预售`,
    template: `%s | ${BRAND_NAME}`,
  },
  description: `${BRAND_NAME} X1 Air White 男士三角内裤当前预售，提供白色及 S、M、L 三个尺码与单条、多条组合。`,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: siteUrl,
    siteName: BRAND_NAME,
    title: `${BRAND_NAME} X1 Air White`,
    description: `${BRAND_NAME} X1 Air White 男士三角内裤当前预售。`,
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [requestHeaders, cookieStore] = await Promise.all([headers(), cookies()]);
  const initialPreferences = decodeConsentCookie(cookieStore.get(privacyConsentCookieName)?.value);
  const locale = requestHeaders.get("x-vk-locale") === "en" ? "en" : "zh-CN";
  const organizationJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: BRAND_NAME,
    url: siteUrl,
    parentOrganization: {
      "@type": "Organization",
      name: locale === "en" ? "Demo Merchant" : "演示商家",
    },
  };

  return (
    <html lang={locale}>
      <body className="min-h-screen">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd) }}
        />
        <StorefrontFrame>
        <SiteHeader />
        {children}
        <SiteFooter />
        </StorefrontFrame>
        <AnalyticsProvider initialPreferences={initialPreferences} />
      </body>
    </html>
  );
}

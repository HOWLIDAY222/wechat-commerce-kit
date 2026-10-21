import type { MetadataRoute } from "next";
import { BRAND_SITE_URL } from "@/lib/brand";
import { listProductSitemapEntries } from "@/lib/services/catalog-service";
import { getPublicSiteLastModified } from "@/lib/services/site-builder-service";
import { talentRoles } from "@/lib/careers-content";

export const dynamic = "force-dynamic";

const baseUrl = BRAND_SITE_URL;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, siteLastModified] = await Promise.all([listProductSitemapEntries(), getPublicSiteLastModified()]);
  const staticLastModified = siteLastModified ?? new Date("2026-07-13T00:00:00.000Z");
  const routes = [
    "",
    "/shop",
    "/products",
    "/shopping-guide",
    "/size-guide",
    "/shipping-policy",
    "/payment-methods",
    "/return-policy",
    "/after-sales-process",
    "/faq",
    "/contact",
    "/feedback",
    "/careers",
    "/about",
    "/official-channels",
    "/after-sales-policy",
    "/privacy-policy",
    "/terms",
  ];
  const englishRoutes = [
    "",
    "/shop",
    "/products",
    "/products/x1-air-white",
    "/shopping-guide",
    "/size-guide",
    "/shipping-policy",
    "/payment-methods",
    "/return-policy",
    "/after-sales-process",
    "/after-sales-policy",
    "/faq",
    "/contact",
    "/feedback",
    "/careers",
    "/about",
    "/official-channels",
    "/privacy-policy",
    "/terms",
    "/availability",
  ];

  return [
    ...talentRoles.flatMap(role => ["", "/en"].map(locale => ({
      url: `${baseUrl}${locale}/careers/${role.id}`, lastModified: new Date("2026-09-15T00:00:00Z"),
      changeFrequency: "monthly" as const, priority: 0.5,
      alternates: { languages: { "zh-CN": `${baseUrl}/careers/${role.id}`, en: `${baseUrl}/en/careers/${role.id}` } },
    }))),
    ...routes.map((route) => ({
      url: `${baseUrl}${route}`,
      lastModified: staticLastModified,
      changeFrequency: "weekly" as const,
      priority: route === "" ? 1 : 0.7,
      alternates: { languages: { "zh-CN": `${baseUrl}${route}`, en: `${baseUrl}/en${route}`, "x-default": `${baseUrl}${route}` } },
    })),
    ...englishRoutes.map((route) => ({
      url: `${baseUrl}/en${route}`,
      lastModified: staticLastModified,
      changeFrequency: "weekly" as const,
      priority: route === "" ? 0.9 : 0.7,
      alternates: { languages: { "zh-CN": `${baseUrl}${route === "/availability" ? "" : route}`, en: `${baseUrl}/en${route}`, "x-default": `${baseUrl}${route === "/availability" ? "" : route}` } },
    })),
    ...products.map((product) => ({
      url: `${baseUrl}/products/${product.slug}`,
      lastModified: product.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
  ];
}

import { isDomesticStorefront } from "@/lib/server/storefront-market";
import { SiteHeaderClient } from "@/components/layout/site-header-client";
import { getPublishedSitePage } from "@/lib/services/site-builder-service";
import { defaultHeaderDocument, resolvePageHref, sitePageDefinitions } from "@/lib/site-builder";

export async function SiteHeader() {
  const result = await getPublishedSitePage("header");
  const document = result?.version.document.documentType === "header" ? result.version.document : defaultHeaderDocument();
  const navigation = document.items.map((item) => ({ label: item.label, href: resolvePageHref(item, sitePageDefinitions) }));
  return <SiteHeaderClient navigation={navigation} domestic={await isDomesticStorefront()} />;
}

import { getPublishedSitePage } from "@/lib/services/site-builder-service";
import { defaultFooterDocument, resolvePageHref, sitePageDefinitions } from "@/lib/site-builder";
import { OFFICIAL_XIAOHONGSHU_PROFILE_URL, OFFICIAL_X_PROFILE_URL } from "@/lib/official-social";

export async function getPublicSiteManagementSettings() {
  const result = await getPublishedSitePage("footer");
  const document = result?.version.document.documentType === "footer" ? result.version.document : defaultFooterDocument();
  const socialChannels = document.socialChannels.map((channel) => {
    if (channel.label.trim() === "小红书" && !channel.url) return { ...channel, account: channel.account || "MerchantKit", url: OFFICIAL_XIAOHONGSHU_PROFILE_URL };
    if (/^(x|twitter)$/i.test(channel.label.trim())) return { ...channel, label: "X", account: channel.account || "@MerchantKit", url: channel.url || OFFICIAL_X_PROFILE_URL, visible: true };
    return channel;
  });
  if (!socialChannels.some((channel) => /^(x|twitter)$/i.test(channel.label.trim()))) {
    socialChannels.unshift({ id: "official-x", label: "X", account: "@MerchantKit", url: OFFICIAL_X_PROFILE_URL, visible: true });
  }
  return {
    brandText: document.brandText,
    footerNavigation: document.columns.map((column) => ({
      title: column.title,
      links: column.links.map((link) => ({ label: link.label, href: resolvePageHref(link, sitePageDefinitions) })),
    })),
    legalLinks: document.legalLinks.map((link) => ({ label: link.label, href: resolvePageHref(link, sitePageDefinitions) })),
    socialChannels,
  };
}

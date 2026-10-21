import { SiteFooterClient } from "@/components/layout/site-footer-client";
import { isDomesticStorefront } from "@/lib/server/storefront-market";
import { getConfiguredXProfileUrl } from "@/lib/international-market";
import { getPublicSiteSettings } from "@/lib/services/public-site-settings-service";
import { getPublicSiteManagementSettings } from "@/lib/services/site-management-service";

export async function SiteFooter() {
  const [{ brandText, footerNavigation, legalLinks, socialChannels }, publicSettings] = await Promise.all([getPublicSiteManagementSettings(), getPublicSiteSettings()]);

  const configuredXChannel = socialChannels.find((channel) => /^(x|twitter)$/i.test(channel.label.trim()) && channel.url)?.url ?? "";
  return <SiteFooterClient domestic={await isDomesticStorefront()} brandText={brandText} footerNavigation={footerNavigation} legalLinks={legalLinks} socialChannels={socialChannels} xProfileUrl={configuredXChannel || publicSettings.xProfileUrl || getConfiguredXProfileUrl()} />;
}

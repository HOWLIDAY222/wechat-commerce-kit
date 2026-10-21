import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EnglishInfo } from "@/components/international/english-storefront";
import { englishInfoPageKeys, englishInfoPages } from "@/lib/english-storefront-content";
import { getConfiguredXProfileUrl } from "@/lib/international-market";
import { getPublicSiteManagementSettings } from "@/lib/services/site-management-service";
import { getPublicSiteSettings } from "@/lib/services/public-site-settings-service";
import { currentEnglishInformation } from "@/lib/services/english-information-service";

type EnglishInfoPageProps = { params: Promise<{ pageKey: string }> };
export const dynamic = "force-dynamic";

export function generateStaticParams() { return englishInfoPageKeys.map((pageKey) => ({ pageKey })); }

export async function generateMetadata({ params }: EnglishInfoPageProps): Promise<Metadata> {
  const { pageKey } = await params;
  const page = englishInfoPages[pageKey];
  if (!page) return {};
  const englishPath = `/en/${pageKey}`;
  const chinesePath = pageKey === "availability" ? "/" : `/${pageKey}`;
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: englishPath, languages: { "zh-CN": chinesePath, en: englishPath, "x-default": chinesePath } },
    openGraph: { url: englishPath, locale: "en_US", title: page.title, description: page.description },
  };
}

export default async function EnglishInfoPage({ params }: EnglishInfoPageProps) {
  const { pageKey } = await params;
  const page = englishInfoPages[pageKey];
  if (!page) notFound();
  let xProfileUrl = "";
  if (pageKey === "official-channels") {
    const [{ socialChannels }, publicSettings] = await Promise.all([getPublicSiteManagementSettings(), getPublicSiteSettings()]);
    xProfileUrl = socialChannels.find((channel) => /^(x|twitter)$/i.test(channel.label.trim()) && channel.url)?.url || publicSettings.xProfileUrl || getConfiguredXProfileUrl();
  }
  return <EnglishInfo page={await currentEnglishInformation(pageKey, page)} pageKey={pageKey} xProfileUrl={xProfileUrl} />;
}

import type { Metadata } from "next";
import { EnglishHome } from "@/components/international/english-storefront";
import { BRAND_NAME } from "@/lib/brand";

export const metadata: Metadata = {
  title: `${BRAND_NAME} Essential Brief Demo`,
  description: "Explore the MerchantKit Essential Brief Demo in English. International checkout and shipping are coming soon.",
  alternates: { canonical: "/en", languages: { "zh-CN": "/", en: "/en", "x-default": "/" } },
  openGraph: { url: "/en", locale: "en_US", title: `${BRAND_NAME} Essential Brief Demo`, description: "White low-rise briefs with breathable side panels. International pricing to be announced." },
};

export default function EnglishHomePage() { return <EnglishHome />; }

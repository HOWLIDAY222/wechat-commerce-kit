import type { Metadata } from "next";
import { EnglishShop } from "@/components/international/english-storefront";
import { isDomesticStorefront } from "@/lib/server/storefront-market";
import { MiniProgramStore } from "@/components/storefront/mini-program-store";

export const metadata: Metadata = {
  title: "Men's Underwear",
  description: "Explore the current MerchantKit X-Series preorder in English.",
  alternates: { canonical: "/en/shop", languages: { "zh-CN": "/shop", en: "/en/shop", "x-default": "/shop" } },
};

export default async function EnglishShopPage() {
  if (await isDomesticStorefront()) return <MiniProgramStore />;
  return <EnglishShop />;
}

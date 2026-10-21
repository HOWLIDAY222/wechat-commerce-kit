import type { Metadata } from "next";
import { CareersPage } from "@/components/careers/careers-page";

export const metadata: Metadata = {
  title: "Join us",
  description: "Introduce your work to MerchantKit: brand content, visual design, commerce, apparel product and supply chain, photography and video, livestream hosting, print modelling and the VK NEXT emerging talent pool.",
  alternates: { canonical: "/en/careers", languages: { "zh-CN": "/careers", en: "/en/careers" } },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ role?: string }> }) { return <CareersPage english selectedRole={(await searchParams).role} />; }

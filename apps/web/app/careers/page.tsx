import type { Metadata } from "next";
import { CareersPage } from "@/components/careers/careers-page";

export const metadata: Metadata = {
  title: "加入我们",
  description: "加入 MerchantKit 人才储备：品牌内容、视觉设计、电商运营、服装商品与供应链、摄影与视频内容、直播主播、平面模特与 VK NEXT 青年人才计划。",
  alternates: { canonical: "/careers", languages: { "zh-CN": "/careers", en: "/en/careers" } },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ role?: string }> }) { return <CareersPage selectedRole={(await searchParams).role} />; }

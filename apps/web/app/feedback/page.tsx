import type { Metadata } from "next";
import { FeedbackPage } from "@/components/feedback/feedback-page";
export const metadata: Metadata = { title: "网站反馈", description: "用 30–60 秒分享你在 MerchantKit 官网的访问体验，帮助我们持续改善。", alternates: { canonical: "/feedback", languages: { "zh-CN": "/feedback", en: "/en/feedback" } } };
export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = (await searchParams).page;
  return <FeedbackPage english={false} initialPage={typeof page === "string" ? page : ""} />;
}

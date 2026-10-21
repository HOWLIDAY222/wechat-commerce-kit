import type { Metadata } from "next";
import { FeedbackPage } from "@/components/feedback/feedback-page";
export const metadata: Metadata = { title: "Website feedback", description: "Share your website experience in a short 30–60 second MerchantKit survey.", alternates: { canonical: "/en/feedback", languages: { "zh-CN": "/feedback", en: "/en/feedback" } } };
export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = (await searchParams).page;
  return <FeedbackPage english={true} initialPage={typeof page === "string" ? page : ""} />;
}

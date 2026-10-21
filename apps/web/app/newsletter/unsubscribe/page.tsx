import { NewsletterUnsubscribeForm } from "@/app/newsletter/unsubscribe/unsubscribe-form";
import { StorefrontPage } from "@/components/storefront/storefront-ui";

export const metadata = { title: "退订品牌资讯", robots: { index: false, follow: false } };

export default async function NewsletterUnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = (await searchParams).token ?? "";
  return (
    <StorefrontPage>
      <section className="mx-auto max-w-xl py-12 md:py-20">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-muted">Brand updates</p>
        <h1 className="mt-3 text-4xl font-semibold">退订品牌资讯</h1>
        <p className="mt-4 text-sm font-semibold leading-7 text-muted">确认后，该邮箱将不再接收 MerchantKit 新品与发售邮件。</p>
        <NewsletterUnsubscribeForm token={token} />
      </section>
    </StorefrontPage>
  );
}

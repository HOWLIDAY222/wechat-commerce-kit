import type { Metadata } from "next";
import Link from "next/link";
import { EmailDirectory } from "@/components/contact/email-directory";
import { ContactInquiryForm } from "@/app/contact/contact-inquiry-form";
import { HomePageRenderer } from "@/components/site-builder/home-page-renderer";
import { SitePageRenderer } from "@/components/site-builder/site-page-renderer";
import { getPublicSiteSettings } from "@/lib/services/public-site-settings-service";
import { listProducts } from "@/lib/services/catalog-service";
import { collectMediaAssetIds, getDraftSitePage, getMediaAssetMap, getPublishedSitePage } from "@/lib/services/site-builder-service";
import { sitePageDefinitions, type FooterDocument, type PageDocument } from "@/lib/site-builder";
import { withStorefrontInformation } from "@/lib/services/storefront-information-service";

export async function ManagedPage({ pageKey, preview = false }: { pageKey: string; preview?: boolean }) {
  const result = preview ? await getDraftSitePage(pageKey) : await getPublishedSitePage(pageKey);
  if (!result || result.version.document.documentType !== "page") return null;
  const document = preview ? result.version.document as PageDocument : await withStorefrontInformation(pageKey, result.version.document as PageDocument);
  const [products, assets] = await Promise.all([listProducts(), getMediaAssetMap(collectMediaAssetIds(document))]);
  const extension = pageKey === "contact"
    ? <ContactExtension />
    : pageKey === "official-channels"
      ? <OfficialChannelsExtension preview={preview} />
      : null;
  return (
    pageKey === "home" ? (
      <HomePageRenderer assets={assets} document={document} products={products} />
    ) : (
      <SitePageRenderer assets={assets} document={document} extension={extension} pageKey={pageKey} pages={sitePageDefinitions} products={products} />
    )
  );
}

export async function generateManagedPageMetadata(pageKey: string): Promise<Metadata> {
  const result = await getPublishedSitePage(pageKey);
  const definition = sitePageDefinitions.find((page) => page.key === pageKey);
  if (!result) return { title: definition?.name ?? "MerchantKit" };
  const seoTitle = result.version.seoTitle || definition?.name || "MerchantKit";
  return {
    title: { absolute: seoTitle },
    description: result.version.seoDescription || undefined,
    openGraph: {
      title: seoTitle,
      description: result.version.seoDescription || undefined,
      images: result.version.ogImageUrl ? [result.version.ogImageUrl] : undefined,
    },
  };
}

async function ContactExtension() {
  const settings = await getPublicSiteSettings();
  return (
    <section className="mt-14 border-t border-black pt-8">
      <EmailDirectory />
      <div className="mt-10 grid gap-8 md:grid-cols-[200px_minmax(0,1fr)]">
        <div>
          <h2 className="text-xl font-semibold">客服信息</h2>
          <p className="mt-2 text-sm leading-6 text-black/55">{settings.supportPhone && settings.supportPhone !== "13900000004" ? settings.supportPhone : "暂未公开固定热线"}</p>
          <Link className="mt-5 inline-flex border-b border-black pb-0.5 text-sm font-semibold" href="/account/orders">从订单进入售后</Link>
        </div>
        <div>
          <h2 className="text-xl font-semibold">普通咨询</h2>
          <p className="mt-2 text-sm leading-7 text-black/60">非订单问题可在这里提交，订单售后建议从订单详情发起。</p>
          <ContactInquiryForm />
        </div>
      </div>
    </section>
  );
}

async function OfficialChannelsExtension({ preview }: { preview: boolean }) {
  const result = preview ? await getDraftSitePage("footer") : await getPublishedSitePage("footer");
  if (!result || result.version.document.documentType !== "footer") return null;
  const footer = result.version.document as FooterDocument;
  const channels = footer.socialChannels.filter((channel) => channel.visible);
  return (
    <section className="mt-14 border-t border-black pt-8">
      <h2 className="text-[26px] font-semibold">官方账号</h2>
      <div className="mt-5 divide-y divide-line border-y border-line md:grid md:grid-cols-3 md:divide-x md:divide-y-0">
        {channels.map((channel) => <article className="py-6 md:px-6 md:first:pl-0" key={channel.id}><h3 className="text-lg font-semibold">{channel.label}</h3><p className="mt-3 break-all text-sm leading-7 text-black/60">{channel.account || "官方入口"}</p>{channel.url ? <Link className="mt-4 inline-flex border-b border-black pb-0.5 text-sm font-semibold" href={channel.url} rel="noreferrer" target="_blank">访问官方渠道</Link> : <p className="mt-4 text-sm text-black/45">暂未配置外部链接</p>}</article>)}
      </div>
    </section>
  );
}

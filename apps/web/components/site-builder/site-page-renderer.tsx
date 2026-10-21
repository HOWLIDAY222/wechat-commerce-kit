import Image from "next/image";
import Link from "next/link";
import { Gauge, ShieldCheck, Sparkles, Waves } from "lucide-react";
import { ProductCard } from "@/components/product/product-card";
import { isServicePageKey, ServicePageRenderer } from "@/components/site-builder/service-page-renderer";
import { resolvePageHref, type PageDocument, type SiteSection } from "@/lib/site-builder";
import type { StorefrontProduct } from "@/lib/storefront-product";
import type { ReactNode } from "react";

type Asset = { id: string; url: string; altText: string | null; name: string };
type Page = { key: string; path: string | null };

export function SitePageRenderer({ assets, document, extension, pageKey, pages, products }: { assets: Map<string, Asset>; document: PageDocument; extension?: ReactNode; pageKey: string; pages: Page[]; products: StorefrontProduct[] }) {
  if (isServicePageKey(pageKey)) {
    return <ServicePageRenderer assets={assets} document={document} extension={extension} pageKey={pageKey} pages={pages} />;
  }

  const productMap = new Map(products.map((product) => [product.id, product]));
  return (
    <main className="vk-storefront">
      {[...document.sections].sort((a, b) => a.sortOrder - b.sortOrder).filter((section) => section.visible).map((section) => (
        <PublishedSection assets={assets} key={section.id} pages={pages} productMap={productMap} section={section} />
      ))}
    </main>
  );
}

function PublishedSection({ assets, pages, productMap, section }: { assets: Map<string, Asset>; pages: Page[]; productMap: Map<string, StorefrontProduct>; section: SiteSection }) {
  if (section.type === "hero") {
    const asset = section.mediaAssetId ? assets.get(section.mediaAssetId) : null;
    const featureIcons = [Sparkles, Waves, Gauge, ShieldCheck];
    return (
      <section className="overflow-hidden bg-[#eef0f3]" id={section.id}>
        <div className="vk-container grid min-h-[440px] md:grid-cols-[0.95fr_1.05fr]">
          <div className="relative z-10 grid content-center py-10 md:py-12">
            <p className="text-sm font-black">{section.eyebrow}</p>
            <h1 className="mt-4 max-w-2xl text-[40px] font-black leading-tight md:text-[54px]">{section.title}</h1>
            <p className="mt-4 max-w-xl text-base font-bold leading-8 text-[#344054] md:text-lg">{section.body}</p>
            {section.features.length ? (
              <div className="mt-6 grid max-w-lg grid-cols-2 gap-3 text-xs font-black sm:grid-cols-4">
                {section.features.map((label, index) => {
                  const Icon = featureIcons[index % featureIcons.length];
                  return <div className="flex items-center gap-2" key={`${label}-${index}`}><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#111827]"><Icon className="h-4 w-4" /></span><span>{label}</span></div>;
                })}
              </div>
            ) : null}
            <Link className="vk-button vk-button-dark mt-7 w-fit px-8" href={resolvePageHref(section.action, pages)}>{section.action.label}</Link>
          </div>
          <div className="relative min-h-[300px] md:min-h-[440px]">
            {asset ? <Image alt={asset.altText || asset.name} className="object-cover object-center" fill priority={section.sortOrder === 0} sizes="(min-width: 768px) 52vw, 100vw" src={asset.url} /> : null}
          </div>
        </div>
      </section>
    );
  }

  if (section.type === "categoryGrid") {
    return (
      <section className="vk-container py-7" id={section.id}>
        <h2 className="mb-5 text-[28px] font-black">{section.title}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {section.items.map((item) => {
            const asset = item.mediaAssetId ? assets.get(item.mediaAssetId) : null;
            return <Link className="group overflow-hidden border border-line bg-white" href={resolvePageHref(item.link, pages)} key={item.id}><div className="relative aspect-[4/3] bg-[#f2f4f7]">{asset ? <Image alt={asset.altText || item.title} className="object-cover transition duration-300 group-hover:scale-[1.02]" fill sizes="(max-width: 640px) 100vw, 25vw" src={asset.url} /> : null}</div><div className="p-4"><strong className="text-lg font-black">{item.title}</strong><p className="mt-1 text-sm font-bold text-muted">{item.body}</p></div></Link>;
          })}
        </div>
      </section>
    );
  }

  if (section.type === "productGrid") {
    const selected = section.productIds.map((id) => productMap.get(id)).filter(Boolean) as StorefrontProduct[];
    return (
      <section className="vk-container py-7" id={section.id}>
        <div className="mb-5 flex items-center justify-between gap-4"><h2 className="text-[28px] font-black">{section.title}</h2><Link className="text-sm font-black text-brand hover:underline" href={resolvePageHref(section.action, pages)}>{section.action.label}</Link></div>
        {selected.length ? <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">{selected.map((product) => <ProductCard compact key={product.slug} product={product} />)}</div> : <div className="border border-line px-5 py-12 text-center text-sm font-bold text-muted">当前板块还没有可展示的在售商品。</div>}
      </section>
    );
  }

  const gridClass = section.columns === 1 ? "grid-cols-1" : section.columns === 2 ? "md:grid-cols-2" : "md:grid-cols-3";
  return (
    <section className="vk-container py-7" id={section.id}>
      {section.title ? <h2 className="mb-5 text-[28px] font-black">{section.title}</h2> : null}
      <div className={`grid gap-4 ${gridClass}`}>
        {section.items.map((item) => {
          const asset = item.mediaAssetId ? assets.get(item.mediaAssetId) : null;
          return <article className="overflow-hidden border border-line bg-white" key={item.id}>{asset ? <div className="relative aspect-[16/9]"><Image alt={asset.altText || item.title} className="object-cover" fill sizes="(max-width: 768px) 100vw, 33vw" src={asset.url} /></div> : null}<div className="p-5"><h2 className="text-xl font-black">{item.title}</h2><p className="mt-3 whitespace-pre-line text-sm font-bold leading-7 text-muted">{item.body}</p>{item.link ? <Link className="mt-4 inline-flex text-sm font-black text-brand hover:underline" href={resolvePageHref(item.link, pages)}>{item.link.label}</Link> : null}</div></article>;
        })}
      </div>
    </section>
  );
}

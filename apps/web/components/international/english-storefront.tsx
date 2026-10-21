import { BrandStoryPage } from "@/components/brand-story-page";
import Image from "next/image";
import Link from "next/link";
import { EmailDirectory } from "@/components/contact/email-directory";
import { OfficialSocialLogo } from "@/components/layout/official-social-logo";
import { CampaignHome } from "@/components/product/campaign-home";
import { ProductImageGallery } from "@/components/product/product-image-gallery";
import { ProductDetailArtwork } from "@/components/product/product-detail-artwork";
import { ProductCampaignFilm } from "@/components/product/campaign-video";
import type { EnglishInfoPage } from "@/lib/english-storefront-content";
import { X1SizeTable } from "@/components/product/x1-size-table";
import { X1_AIR_WHITE_PRIMARY_IMAGE } from "@/lib/catalog-media";
import { getProductBySlug } from "@/lib/services/catalog-service";
import { getPublicSiteSettings } from "@/lib/services/public-site-settings-service";
import type { StorefrontProduct } from "@/lib/storefront-product";

const productPath = "/en/products/x1-air-white";

export function EnglishHome() {
  return <CampaignHome
    price={null} productImage={X1_AIR_WHITE_PRIMARY_IMAGE}
    href={productPath} action="Explore X1 Air" note="International pricing to be announced · Checkout is not open yet"
    english />;
}

export async function EnglishShop() {
  const product = await getProductBySlug("x1-air-white");
  return (
    <main className="min-h-[70svh] bg-white pb-20">
      <header className="vk-container pb-10 pt-12 md:pb-14 md:pt-16"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-black/50">X-Series</p><div className="mt-4 grid gap-5 md:grid-cols-[1fr_0.8fr] md:items-end"><h1 className="text-[42px] font-normal leading-none md:text-[62px]">Men&apos;s underwear</h1><p className="text-sm leading-7 text-black/60">Only products currently on sale or preorder are shown. International checkout remains closed.</p></div></header>
      <div className="vk-container grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {product ? <Link className="group block" href={productPath}><div className="relative aspect-square overflow-hidden bg-[#efeeec]"><Image alt={product.name} className="object-contain transition duration-500 group-hover:scale-[1.015]" fill sizes="(max-width: 640px) 100vw, 50vw" src={product.image} /></div><div className="mt-5"><p className="text-xs font-bold uppercase tracking-[0.12em] text-black/45">International preview</p><h2 className="mt-2 text-xl font-semibold">{product.name}</h2><p className="mt-2 text-sm text-black/55">White · {[...product.sizes].sort().join(" / ")}</p><p className="mt-3 text-sm">International pricing to be announced</p></div></Link> : <p>No product preview is available at the moment.</p>}
      </div>
    </main>
  );
}

export function EnglishProduct({ product }: { product: StorefrontProduct }) {
  return (
    <main className="bg-white text-[#111]">
      <div className="minimal-product-layout">
        <ProductImageGallery images={product.images.length ? product.images : [product.image]} name={product.name} productSlug={product.slug} english />
        <aside className="minimal-product-info">
          <nav aria-label="Breadcrumb" className="text-xs text-black/45"><Link className="hover:underline" href="/en/shop">Men&apos;s underwear</Link><span className="px-2">/</span><span>Briefs</span></nav>
          <p className="mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-black/50">X-Series · International preview</p>
          <h1 className="mt-3 text-[48px] font-normal leading-tight md:text-[64px]">{product.name}</h1>
          <p className="mt-6 text-xl">International pricing to be announced</p>
          <p className="mt-6 max-w-xl text-sm leading-8 text-black/65">White low-rise briefs. The current product range offers single pieces with selectable quantities. International pack availability and pricing will be confirmed before orders open.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">{product.quantityPricing?.styles?.map(style => <article className="border border-black/15 p-5" key={style.key}><h2 className="font-semibold">{style.key === "regular" ? "Regular" : style.key === "upgraded" ? "Upgraded" : style.label}</h2><p className="mt-3 text-sm leading-7 text-black/65">{style.key === "regular" ? "Standard gusset fabric. Breathable construction." : style.key === "upgraded" ? "Only the gusset is upgraded to modal and Xinjiang cotton. The main body fabric remains the same. Follow the care label for fibre percentages." : style.summary}</p></article>)}</div>
          <dl className="mt-8 grid gap-4 border-y border-black/10 py-7 text-sm"><ProductFact label="Colours" value={product.colors.map(c => c === "白色" ? "White" : c).join(" / ")} /><ProductFact label="Sizes" value={[...product.sizes].sort().join(" / ")} /><ProductFact label="Fit" value="Low-rise brief" /><ProductFact label="Construction" value="Contoured front / mesh side panels / wide elastic waistband" /><ProductFact label="Care" value="Gentle wash below 30°C. Do not bleach or tumble dry. Dry in shade. Follow the product care label." /></dl>
          <details className="mt-6"><summary className="cursor-pointer py-3 text-sm underline underline-offset-4">Size guide</summary><X1SizeTable english /></details><Link className="mt-8 flex min-h-14 w-full items-center justify-center bg-black px-6 text-sm font-bold !text-white" href="/en/availability">International checkout coming soon</Link>
          <p className="mt-4 text-xs leading-6 text-black/50">International prices, payment methods, shipping, taxes and return terms will be announced before ordering opens. Mainland China ordering is available through the WeChat mini-program.</p><Link className="mt-3 inline-block text-sm underline underline-offset-4" href="https://example.invalid.cn/products/x1-air-white">Mainland China product information</Link>
        </aside>
      </div>
      <div className="vk-container pb-12">{product.slug === "x1-air-white" ? <ProductCampaignFilm english /> : null}<ProductDetailArtwork images={product.detailMedia} english /></div>
    </main>
  );
}

export async function EnglishInfo({ page, pageKey, xProfileUrl }: { page: EnglishInfoPage; pageKey: string; xProfileUrl?: string }) {
  const contactSettings = pageKey === "contact" ? await getPublicSiteSettings() : null;
  if (pageKey === "about") return <BrandStoryPage title={page.title} tagline={page.description} sections={page.sections} english />;
  return (
    <main className="min-h-[70svh] bg-white py-8 md:py-12">
      <article className="vk-container-narrow">
        <header className="max-w-3xl"><h1 className="text-[32px] font-normal leading-tight md:text-[40px]">{page.title}</h1><p className="mt-4 text-sm leading-7 text-black/62">{page.description}</p></header>
        {page.notice ? <p className="mt-9 border-l-4 border-black bg-[#f3f2f0] px-5 py-4 text-sm font-semibold leading-7">{page.notice}</p> : null}
        {pageKey === "contact" ? <EmailDirectory english supportEmail={contactSettings?.supportEmail} /> : null}
        <div className="mt-12 grid gap-10 md:mt-16 md:grid-cols-2 md:gap-x-14 md:gap-y-14">
          {page.sections.map((section) => <section className="border-t border-black/15 pt-6" key={section.title}><h2 className="text-xl font-semibold">{section.title}</h2>{section.paragraphs?.map((paragraph) => <p className="mt-4 text-sm leading-7 text-black/62" key={paragraph}>{paragraph}</p>)}{section.items ? <ul className="mt-4 grid gap-3 text-sm leading-7 text-black/62">{section.items.map((item) => <li className="flex gap-3" key={item}><span aria-hidden="true">—</span><span>{item}</span></li>)}</ul> : null}{pageKey === "official-channels" && section.title === "X" && xProfileUrl ? <a className="mt-5 inline-flex min-h-11 items-center justify-center gap-3 bg-black px-6 text-sm font-bold !text-white" href={xProfileUrl} rel="noreferrer" target="_blank"><span className="grid size-7 place-items-center rounded-full bg-white"><OfficialSocialLogo label="X" /></span><span>Open MerchantKit on X</span></a> : null}</section>)}
        </div>
        {pageKey === "availability" ? <div className="mt-14 flex flex-wrap gap-4"><Link className="inline-flex min-h-12 items-center justify-center bg-black px-7 text-sm font-bold !text-white" href={productPath}>Explore X1 Air White</Link><Link className="inline-flex min-h-12 items-center justify-center border border-black px-7 text-sm font-bold" href="/en#newsletter">Get launch updates</Link></div> : null}
      </article>
    </main>
  );
}

function ProductFact({ label, value }: { label: string; value: string }) { return <div className="grid grid-cols-[100px_1fr] gap-4"><dt className="text-black/45">{label}</dt><dd>{value}</dd></div>; }

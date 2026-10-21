import type { Metadata } from "next";
import { isDomesticStorefront } from "@/lib/server/storefront-market";
import { MiniProgramProduct } from "@/components/storefront/mini-program-product";
import { notFound } from "next/navigation";
import { EnglishProduct } from "@/components/international/english-storefront";
import { BRAND_NAME, BRAND_SITE_URL } from "@/lib/brand";
import { X1_AIR_WHITE_GALLERY_IMAGES } from "@/lib/catalog-media";
import { getProductBySlug } from "@/lib/services/catalog-service";

type EnglishProductPageProps = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: EnglishProductPageProps): Promise<Metadata> {
  if ((await params).slug !== "x1-air-white") return {};
  return {
    title: "Essential Brief Demo",
    description: "White low-rise briefs in regular and upgraded-gusset styles, with single and multi-pack options. International pricing and checkout are coming soon.",
    alternates: { canonical: "/en/products/x1-air-white", languages: { "zh-CN": "/products/x1-air-white", en: "/en/products/x1-air-white", "x-default": "/products/x1-air-white" } },
    openGraph: { url: "/en/products/x1-air-white", locale: "en_US", title: "Essential Brief Demo", images: [X1_AIR_WHITE_GALLERY_IMAGES[0]] },
  };
}

export default async function EnglishProductPage({ params }: EnglishProductPageProps) {
  if ((await params).slug !== "x1-air-white") notFound();
  const product = await getProductBySlug("x1-air-white");
  if (!product) notFound();
  if (await isDomesticStorefront()) return <MiniProgramProduct product={product} />;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Essential Brief Demo",
    sku: "DEMO-ESSENTIAL-BRIEF",
    image: product.images.map((image) => `${BRAND_SITE_URL}${image}`),
    description: "Low-rise briefs with a contoured front, mesh side panels and a wide elastic waistband.",
    brand: { "@type": "Brand", name: BRAND_NAME },
    url: `${BRAND_SITE_URL}/en/products/x1-air-white`,
  };
  return <><script dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} type="application/ld+json" /><EnglishProduct product={product} /></>;
}

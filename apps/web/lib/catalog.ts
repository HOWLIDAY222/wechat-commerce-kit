import { X1_COLORS, X1_SIZES } from "@/lib/commerce/x1-specifications";
import { X1_AIR_WHITE_GALLERY_IMAGES } from "@/lib/catalog-media";
import { X1_AIR_WHITE_UNIT_PRICE_CENTS } from "@/lib/commerce/x1-air-white-pricing";
import type { ProductMerchandising } from "@/lib/product-merchandising";

export type CatalogProduct = ProductMerchandising & {
  slug: string;
  code: string;
  name: string;
  category: string;
  scene: string;
  summary: string;
  description: string;
  image: string;
  images: string[];
  priceCents: number;
  colors: string[];
  sizes: string[];
};

export const catalogProducts: CatalogProduct[] = [
  {
    slug: "x1-air-white",
    code: "DEMO-ESSENTIAL-BRIEF",
    name: "Essential Brief Demo",
    category: "三角内裤",
    scene: "日常穿着",
    summary: "白色低腰三角内裤，提供 S、M、L 三个尺码与单条、多条组合。",
    description: "Essential Brief Demo 采用立体前片、侧片网眼和低腰版型，仅提供白色，尺码为 S、M、L。",
    silhouette: "三角",
    rise: "低腰",
    coverage: "标准后幅",
    supportLevel: "适中",
    fabricComposition: "弹力针织面料，侧片网眼拼接",
    features: ["侧片网眼", "立体前片", "宽幅弹力腰头"],
    fitNote: "贴身版型",
    careInstructions: "30℃以下轻柔洗涤；不可漂白；不可烘干；阴凉处晾干。具体洗护要求以商品洗标为准。",
    packSize: 1,
    image: "/assets/catalog/x1-air-white/vk-20260818/offers/white-3.webp",
    images: [...X1_AIR_WHITE_GALLERY_IMAGES],
    priceCents: X1_AIR_WHITE_UNIT_PRICE_CENTS,
    colors: [...X1_COLORS],
    sizes: [...X1_SIZES],
  },
];

export const catalogProductSlugs = catalogProducts.map((product) => product.slug);

export function findProduct(slug: string) {
  return catalogProducts.find((product) => product.slug === slug);
}

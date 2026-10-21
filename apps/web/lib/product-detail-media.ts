import { X1_PRODUCT_DETAIL_COPY, type ProductDetailCopy } from "./product-detail-copy";

export type ProductDetailImage = {
  id: string;
  title: string;
  titleEn: string;
  style: "all" | "upgraded";
  url: string;
  mobileUrl: string;
  width: number;
  height: number;
  mobileWidth: number;
  mobileHeight: number;
  detail?: ProductDetailCopy;
};

// Curated detail artwork is separate from the main gallery and SKU photographs.
const details: Array<[string, string, string, "all" | "upgraded", number, number]> = [
  ["waist-embossing", "商品主图示例", "Product artwork example", "all", 1080, 1350],
  ["contoured-front", "细节展示示例", "Detail artwork example", "all", 1080, 1350],
  ["mesh-panel", "款式展示示例", "Style artwork example", "all", 1080, 1350],
];

export function getProductDetailMedia(slug: string): ProductDetailImage[] {
  if (slug !== "x1-air-white") return [];
  const base = "/assets/catalog/x1-air-white/vk-20261014/";
  return details.map(([id, title, titleEn, style, width, height]) => ({
    id, title, titleEn, style,
    ...(X1_PRODUCT_DETAIL_COPY[id] ? { detail: { ...X1_PRODUCT_DETAIL_COPY[id] } } : {}),
    url: `${base}${id}-1080.webp`, mobileUrl: `${base}${id}-750.webp`,
    width, height, mobileWidth: 750, mobileHeight: Math.floor(height * 750 / width),
  }));
}

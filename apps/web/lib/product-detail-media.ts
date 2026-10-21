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
  ["waist-embossing", "腰头压纹工艺", "Embossed waistband", "all", 1080, 1350],
  ["contoured-front", "立体前片结构", "Contoured front", "all", 1080, 1350],
  ["mesh-panel", "侧边网孔拼接", "Mesh side panels", "all", 1080, 1350],
  ["leg-binding", "裤脚包边细节", "Leg binding", "all", 1080, 1350],
  ["stitching", "走线与车缝工艺", "Stitching and seams", "all", 1080, 1350],
  ["breathability", "吸汗透气", "Breathable construction", "all", 1080, 1440],
  ["body-fabric", "主面料特写", "Main body fabric", "all", 1080, 1440],
  ["fabric-contrast", "双面料对比", "Body fabric and mesh", "all", 1080, 1440],
  ["fabric-texture", "材质质感近景", "Fabric texture", "all", 1080, 1440],
  ["moisture", "吸水性展示", "Moisture absorption illustration", "all", 1080, 1440],
  ["upgraded-gusset-material", "升级款裆部材质", "Upgraded gusset material", "upgraded", 1080, 1440],
  ["upgraded-gusset-treatment", "升级款裆部抗菌处理", "Upgraded gusset treatment", "upgraded", 1080, 1440],
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

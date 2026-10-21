export const X1_AIR_WHITE_PRIMARY_IMAGE = "/assets/catalog/x1-air-white/vk-20260911/flatlay.jpg";
export const PUBLIC_PRODUCT_PLACEHOLDER_IMAGE = "/assets/brand/product-placeholder.webp";

const X1_AIR_WHITE_ADDITIONAL_GALLERY_IMAGES = [
  "/assets/catalog/x1-air-white/vk-20261014/product-front-1080.webp",
  "/assets/catalog/x1-air-white/vk-20261014/product-angle-a-1080.webp",
  "/assets/catalog/x1-air-white/vk-20261014/product-angle-b-1080.webp",
  "/assets/catalog/x1-air-white/vk-20261014/product-closeup-1080.webp",
] as const;

export const X1_AIR_WHITE_GALLERY_IMAGES = [
  X1_AIR_WHITE_PRIMARY_IMAGE,
  ...X1_AIR_WHITE_ADDITIONAL_GALLERY_IMAGES,
  "/assets/catalog/x1-air-white/vk-20260911/wearing-front.jpg",
  "/assets/catalog/x1-air-white/vk-20260911/mesh-detail.jpg",
  "/assets/catalog/x1-air-white/vk-20260911/waistband-detail.jpg",
] as const;

export const X1_AIR_WHITE_HERO_POSTER_IMAGES = [
  "/assets/catalog/x1-air-white/vk-20260911/campaign-back.jpg",
  "/assets/catalog/x1-air-white/vk-20260911/campaign-side.jpg",
] as const;

export function resolvePublicProductImages(slug: string, images: string[], fallbackImage = "") {
  if (slug === "x1-air-white" && images.every((image) => image.includes("/vk-20260818/") || isRetiredProductImage(image))) return [...X1_AIR_WHITE_GALLERY_IMAGES];
  const managedImages = uniqueImages(images).filter((image) => !isRetiredProductImage(image) && (slug !== "x1-air-white" || !/\/(?:gray|black|mixed)-/i.test(image)));
  if (managedImages.length) {
    if (slug !== "x1-air-white") return managedImages;
    // Preserve the CMS-selected main image and add the supplied product angles.
    return uniqueImages([managedImages[0], ...X1_AIR_WHITE_ADDITIONAL_GALLERY_IMAGES, ...managedImages.slice(1)]);
  }
  if (slug === "x1-air-white") return [...X1_AIR_WHITE_GALLERY_IMAGES];
  if (fallbackImage && !isRetiredProductImage(fallbackImage)) return [fallbackImage];
  return [PUBLIC_PRODUCT_PLACEHOLDER_IMAGE];
}

export function resolveProductHeroPosterImages(images: readonly string[], limit = 8) {
  const managedImages = uniqueImages(images);
  const galleryImages = managedImages.length > 1 ? managedImages.slice(1) : managedImages;
  return galleryImages.slice(0, Math.max(1, limit));
}

function uniqueImages(images: readonly string[]) {
  return Array.from(new Set(images.map((image) => image.trim()).filter(Boolean)));
}

function isRetiredProductImage(image: string) {
  const normalized = image.toLowerCase();
  return normalized.includes("/on-body/")
    || normalized.endsWith("/primary.webp")
    || normalized.endsWith("/primary-v2.webp")
    || normalized.endsWith("/model.webp")
    || normalized.includes("/posters/");
}

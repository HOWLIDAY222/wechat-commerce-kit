// Neutral identity for the community distribution. Brand assets are excluded.
export const BRAND_NAME = "MerchantKit";
export const BRAND_ADMIN_NAME = BRAND_NAME + " 后台";
export const BRAND_SHARE_IMAGE = "/assets/demo/product.png";
export const BRAND_DOMAIN = "example.invalid";
export const BRAND_SITE_URL = process.env.APP_BASE_URL || "http://127.0.0.1:3000";
export function applyCurrentBrandName(value: string) { return value; }
export function applyCurrentBrandAssetUrl(value: string | null | undefined) { return value || null; }
export function applyCurrentBrandToValue<T>(value: T): T { return value; }

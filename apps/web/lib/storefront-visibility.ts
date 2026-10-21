import type { StorefrontProduct } from "@/lib/storefront-product";

export function isPubliclyOfferedProduct(product: Pick<StorefrontProduct, "release">) {
  return product.release.status === "PREORDER" || product.release.status === "IN_STOCK";
}

export function isActiveSaleProduct(product: { saleMode?: string | null; status: string }) {
  return product.status === "ACTIVE" && (product.saleMode === "PREORDER" || product.saleMode === "IN_STOCK");
}

export function isUnreleasedProduct(product: Pick<StorefrontProduct, "release">) {
  return !isPubliclyOfferedProduct(product);
}

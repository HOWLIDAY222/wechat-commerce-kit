import { getX1AirWhiteOfferImage } from "./x1-air-white-offers";
import { isSupportedProductSpecification } from "./x1-specifications";

type OrderItemWithProductImage = {
  color: string;
  size: string;
  quantity: number;
  productImage?: string | null;
  image?: string | null;
  product?: {
    slug: string;
    image: string | null;
    images: ReadonlyArray<{ imageUrl: string }>;
  } | null;
};

function imageValue(value: string | null | undefined) {
  return value?.trim() || "";
}

/** Enrich a read response only; order names, prices and specifications stay as purchased. */
export function withOrderItemProductImage<T extends OrderItemWithProductImage>(item: T) {
  const { product, ...snapshot } = item;
  const productImage = imageValue(item.productImage) || imageValue(item.image)
    || (product?.slug === "x1-air-white" && isSupportedProductSpecification(product.slug, item.color, item.size)
      ? getX1AirWhiteOfferImage(item.color, item.quantity) : null)
    || imageValue(product?.image) || imageValue(product?.images[0]?.imageUrl);
  return { ...snapshot, productImage };
}

import { X1_COLORS } from "./x1-specifications";
export const X1_AIR_WHITE_COLORS = X1_COLORS;
export const X1_AIR_WHITE_PACK_QUANTITIES = [1, 2, 3, 4] as const;

export type X1AirWhiteColor = (typeof X1_AIR_WHITE_COLORS)[number];
export type X1AirWhiteOfferColor = X1AirWhiteColor;
export type X1AirWhitePackQuantity = (typeof X1_AIR_WHITE_PACK_QUANTITIES)[number];

export const X1_AIR_WHITE_OFFER_IMAGES = {
  白色: {
    1: "/assets/catalog/x1-air-white/vk-20261014-packs/pack-1-750.webp",
    2: "/assets/catalog/x1-air-white/vk-20261014-packs/pack-2-750.webp",
    3: "/assets/catalog/x1-air-white/vk-20261014-packs/pack-3-750.webp",
    4: "/assets/catalog/x1-air-white/vk-20261014-packs/pack-4-750.webp",
  },
} satisfies Record<X1AirWhiteColor, Record<X1AirWhitePackQuantity, string>>;


export function getX1AirWhiteOfferImage(color: string, quantity: number) {
  if (!isX1AirWhiteColor(color) || !isX1AirWhitePackQuantity(quantity)) return null;
  return X1_AIR_WHITE_OFFER_IMAGES[color][quantity];
}

export function isX1AirWhiteColor(color: string): color is X1AirWhiteColor {
  return (X1_AIR_WHITE_COLORS as readonly string[]).includes(color);
}

export function isX1AirWhitePackQuantity(quantity: number): quantity is X1AirWhitePackQuantity {
  return (X1_AIR_WHITE_PACK_QUANTITIES as readonly number[]).includes(quantity);
}

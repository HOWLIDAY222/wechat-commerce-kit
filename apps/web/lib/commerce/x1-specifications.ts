export const X1_COLORS = ["白色"] as const;
export const X1_SIZES = ["S", "M", "L"] as const;

export function isSupportedProductSpecification(slug: string, color: string, size: string) {
  return slug !== "x1-air-white" || (color === "白色" && (X1_SIZES as readonly string[]).includes(size));
}

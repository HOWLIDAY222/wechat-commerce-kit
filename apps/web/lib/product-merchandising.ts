export type ProductMerchandising = {
  silhouette: string;
  rise: string;
  coverage: string;
  supportLevel: string;
  fabricComposition: string;
  features: string[];
  fitNote: string;
  careInstructions: string;
  packSize: number | null;
};

export function normalizeProductFeatures(values: readonly string[] | null | undefined) {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).slice(0, 8);
}

export function parseProductFeatures(value: string) {
  return normalizeProductFeatures(value.split(/[，,、；;\n]/));
}

export function getProductColorSwatch(color: string) {
  const normalized = color.trim().toLowerCase().replace(/\s+/g, "");
  const colors: Record<string, string> = {
    白: "#f7f7f5",
    白色: "#f7f7f5",
    米白: "#eeeae1",
    黑: "#111111",
    黑色: "#111111",
    灰: "#8b8f97",
    灰色: "#8b8f97",
    深灰: "#42464d",
    蓝: "#244e82",
    蓝色: "#244e82",
    藏青: "#172a46",
    红: "#a9252a",
    红色: "#a9252a",
    绿色: "#526c50",
    绿: "#526c50",
    肤色: "#c7a58b",
    桃珊瑚: "#e87761",
    酒红: "#5d172b",
    酒红色: "#5d172b",
  };
  return colors[normalized] ?? "#d5d7da";
}

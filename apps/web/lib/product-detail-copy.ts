export type ProductDetailCopy = {
  number: string;
  title: string;
  body: string;
  titleEn: string;
  bodyEn: string;
};

// The community catalog contains fictional geometric artwork, not physical product claims.
export const X1_PRODUCT_DETAIL_COPY: Partial<Record<string, ProductDetailCopy>> = {
  "waist-embossing": { number: "01", title: "商品主图示例", body: "展示商品主图与说明的排版。", titleEn: "Product artwork example", bodyEn: "Example layout for a product image and caption." },
  "contoured-front": { number: "02", title: "细节展示示例", body: "展示细节图片与说明的排版。", titleEn: "Detail artwork example", bodyEn: "Example layout for a detail image and caption." },
  "mesh-panel": { number: "03", title: "款式展示示例", body: "展示不同款式的图片与说明。", titleEn: "Style artwork example", bodyEn: "Example layout for style images and captions." },
};

import type { Metadata } from "next";
export { default } from "@/app/en/shop/page";

export const metadata: Metadata = {
  title: "X-Series Products",
  description: "Explore current MerchantKit X-Series products in English.",
  alternates: { canonical: "/en/products", languages: { "zh-CN": "/products", en: "/en/products", "x-default": "/products" } },
};

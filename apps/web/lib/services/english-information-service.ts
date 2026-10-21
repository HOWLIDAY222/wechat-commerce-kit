import type { EnglishInfoPage } from "@/lib/english-storefront-content";
import { getProductBySlug } from "@/lib/services/catalog-service";
import { getShippingRateConfig } from "@/lib/commerce/shipping";

export async function currentEnglishInformation(pageKey: string, page: EnglishInfoPage): Promise<EnglishInfoPage> {
  if (!["shopping-guide", "faq", "shipping-policy"].includes(pageKey)) return page;
  const product = await getProductBySlug("x1-air-white");
  if (!product) return page;
  if (pageKey === "shopping-guide") return { ...page, sections: [
    { title: "Current product range", items: [
      `White only. Sizes: ${[...product.sizes].sort().join(" / ")}.`,
      `Single pieces with selectable quantities and combination options from two pieces. Same-style items in different sizes can be combined; different styles are priced separately in Mainland China.`,
      ...(product.quantityPricing?.styles || []).map(style => style.key === "regular" ? "Regular: standard gusset fabric." : style.key === "upgraded" ? "Upgraded: modal and Xinjiang cotton in the gusset only; the main body remains unchanged. Fibre percentages follow the care label." : `${style.label}: ${style.summary}`),
    ] },
    { title: "Mainland China", paragraphs: ["Order through the WeChat mini-program linked from example.invalid.cn. Current prices, preorder dispatch dates and region-based shipping fees are shown before payment. Product browsing does not require login; orders and membership require WeChat login."] },
    { title: "International markets", paragraphs: ["International prices and pack availability are to be announced. International checkout, payment and shipping remain closed. Mainland China prices and benefits are not an international offer."] },
  ] };
  if (pageKey === "faq") return { ...page, sections: [
    { title: "What colours, sizes and packs are available?", paragraphs: [`The current product is white, in ${[...product.sizes].sort().join(" / ")}, with selectable quantities from one piece.`] },
    { title: "What is different about the upgraded style?", paragraphs: ["The upgrade applies only to the gusset, using modal and Xinjiang cotton. It does not mean that the whole garment uses those materials. Follow the care label for fibre percentages."] },
    { title: "Can I order outside Mainland China?", paragraphs: ["Not yet. International prices, payment, shipping, taxes and returns will be announced before ordering opens."] },
    { title: "How do I buy in Mainland China?", paragraphs: ["Use example.invalid.cn to open the WeChat mini-program. Confirm the style, size, quantity, address, shipping fee and dispatch estimate before paying with WeChat Pay."] },
    { title: "Are Mainland China membership benefits available internationally?", paragraphs: ["Mainland China coupon and points activities apply only under their published terms. No international membership offer has been announced. Coupon or points campaigns that are not open do not create automatic entitlements."] },
  ] };
  const rate = await getShippingRateConfig();
  return { ...page, sections: [
    { title: "Mainland China", paragraphs: [rate ? `Standard delivery: CNY ${(rate.baseFeeCents / 100).toFixed(2)} per order. Inner Mongolia, Gansu, Qinghai, Ningxia and Hainan: CNY ${(rate.remoteFeeCents / 100).toFixed(2)}. Xinjiang and Tibet: CNY ${(rate.farRemoteFeeCents / 100).toFixed(2)}. Delivery is currently limited to Mainland China. The final fee is shown before payment.` : "Mainland China shipping fees are calculated by the delivery province and shown before payment.", "Preorder dispatch dates apply to Mainland China orders and are shown on the product and checkout pages. They are not international delivery promises."] },
    ...page.sections.filter(section => section.title !== "Mainland China"),
  ] };
}

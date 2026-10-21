import { brandStoryEn, brandStoryTagline } from "@/lib/brand-story";
export type EnglishInfoPage = {
  eyebrow: string;
  title: string;
  description: string;
  notice?: string;
  sections: Array<{ title: string; paragraphs?: string[]; items?: string[] }>;
};

export const englishInfoPages: Record<string, EnglishInfoPage> = {
  "size-guide": {
    eyebrow: "Fit assistance",
    title: "Size guide",
    description: "Available in S, M and L. Choose primarily by body waist measurement; weight is only a secondary guide.",
    sections: [
      { title: "Available sizes", items: ["S — body waist 64–72 cm; approximately 45–60 kg, for a slimmer build.", "M — body waist 72–80 cm; approximately 55–65 kg.", "L — body waist 80–88 cm; approximately 65–75 kg."] },
      { title: "How to choose", paragraphs: ["Use the size information as a general reference. Body shape and fit preference can change the result.", "If you are between sizes, choose the larger size for a more relaxed fit."] },
    ],
  },
  "shopping-guide": {
    eyebrow: "Shopping",
    title: "Shopping guide",
    description: "A clear overview of the X1 Air White offer and the current service boundary.",
    sections: [
      { title: "Choose your pack", items: ["White only, in regular and upgraded-gusset styles.", "Current pack details are loaded from the product catalogue.", "International pricing and pack availability are to be announced."] },
      { title: "Current availability", paragraphs: ["The product is currently available for preorder through the Mainland China storefront.", "International checkout and shipping are not open yet. No international payment will be collected until the service is ready."] },
    ],
  },
  "shipping-policy": {
    eyebrow: "Delivery",
    title: "Shipping",
    description: "Mainland China delivery is active. International delivery is being prepared.",
    notice: "International shipping is not available at this time.",
    sections: [
      { title: "Mainland China", paragraphs: ["Shipping fees vary by delivery province and are shown before payment. The estimated dispatch date is shown on the Chinese product and checkout pages."] },
      { title: "International markets", paragraphs: ["Countries, carriers, duties, taxes, delivery times and return routes will be published before international orders open.", "We will not accept an international order until its full delivery cost and service terms can be shown before payment."] },
    ],
  },
  "payment-methods": {
    eyebrow: "Payment",
    title: "Payment methods",
    description: "Payment options are separated by market so customers never enter an unsupported checkout.",
    notice: "International payment is not enabled. This English site does not collect payment.",
    sections: [
      { title: "Mainland China", paragraphs: ["Use example.invalid.cn to open the WeChat mini-program and pay with WeChat Pay. Do not send payment to a personal account."] },
      { title: "International checkout", paragraphs: ["A compliant international payment provider and eligible merchant account will be connected before overseas sales open.", "Supported cards, wallets, currencies and refund rules will be confirmed on this page before launch."] },
    ],
  },
  "return-policy": {
    eyebrow: "Customer care",
    title: "Returns",
    description: "Return eligibility depends on the product condition, hygiene requirements and the applicable market terms.",
    sections: [
      { title: "Intimate apparel", paragraphs: ["For hygiene reasons, intimate apparel may have restricted return eligibility once packaging or hygiene seals are opened, except where mandatory law or a verified product issue applies."] },
      { title: "International orders", paragraphs: ["International return destinations, time limits and costs will be published before international checkout opens."] },
    ],
  },
  "after-sales-process": {
    eyebrow: "Customer care",
    title: "After-sales process",
    description: "Contact us with the order number, issue description and clear supporting images.",
    sections: [
      { title: "Request review", items: ["Provide your order number and contact details.", "Describe the issue and attach clear photos when relevant.", "Wait for eligibility and handling instructions before sending an item."] },
      { title: "International service", paragraphs: ["International after-sales service will launch together with international checkout. There are currently no overseas orders to service."] },
    ],
  },
  "after-sales-policy": {
    eyebrow: "Customer care",
    title: "After-sales policy",
    description: "The applicable policy is shown before purchase and depends on the market in which the order is accepted.",
    sections: [
      { title: "Current service", paragraphs: ["The published Chinese policy governs the current Mainland China service. Product quality issues are reviewed using order records and supporting evidence."] },
      { title: "International service", paragraphs: ["International warranty, returns, exchanges and refund timing will be published before overseas orders are accepted."] },
    ],
  },
  faq: {
    eyebrow: "Help",
    title: "Frequently asked questions",
    description: "Answers about sizing, packs, availability and the international launch.",
    sections: [
      { title: "What colours are available?", paragraphs: ["White only. Current styles, sizes and pack details are loaded from the product catalogue."] },
      { title: "Can I order outside Mainland China?", paragraphs: ["Not yet. The English product pages are available for product information, but international checkout and shipping remain closed."] },
      { title: "Can I pay with Alipay overseas?", paragraphs: ["The available method depends on the payment product and customer location. We will only display Alipay or any other wallet after the international merchant capability is approved and tested for the target market."] },
    ],
  },
  contact: {
    eyebrow: "Contact",
    title: "Contact us",
    description: "Questions about products, sizing, partnerships or the international launch are welcome.",
    sections: [
      { title: "Before contacting us", paragraphs: ["For an existing Mainland China order, include the order number. Please do not send card, wallet password or verification-code information."] },
    ],
  },
  about: {
    eyebrow: "MerchantKit",
    title: "Our story",
    description: brandStoryTagline,
    sections: brandStoryEn,
  },
  "official-channels": {
    eyebrow: "Follow",
    title: "Official channels",
    description: "Use the verified links published on this website to find MerchantKit online.",
    sections: [{ title: "X", paragraphs: ["Our verified X profile link appears here as soon as the account address is configured."] }],
  },
  "privacy-policy": {
    eyebrow: "Legal information",
    title: "Privacy information",
    description: "A plain-English summary for visitors to the international information site.",
    notice: "This page is an information summary, not a certified translation of the Chinese privacy policy.",
    sections: [
      { title: "Information we may receive", paragraphs: ["We may receive information you submit through newsletter or contact forms, together with ordinary technical request data needed to operate and secure the website."] },
      { title: "How it is used", paragraphs: ["Information is used to respond to requests, provide requested updates, secure the service and comply with applicable obligations. We do not open international checkout on this site at present."] },
      { title: "Your request", paragraphs: ["For privacy questions or requests, email support@example.invalid. The current published Chinese privacy policy governs the active Mainland China service."] },
    ],
  },
  terms: {
    eyebrow: "Legal information",
    title: "Service information",
    description: "A plain-English summary of the current service boundary.",
    notice: "This page is an information summary, not a certified translation of the Chinese service terms.",
    sections: [
      { title: "Operator", paragraphs: ["The website and MerchantKit storefront are operated by Demo Merchant"] },
      { title: "Current transaction scope", paragraphs: ["The active transaction service is the Mainland China storefront. International checkout, payment, shipping and accounts are not currently offered through the English site."] },
      { title: "Before international launch", paragraphs: ["Market-specific prices, payment methods, taxes, delivery, returns, privacy notices and binding terms will be displayed before international orders are accepted."] },
    ],
  },
  availability: {
    eyebrow: "International market",
    title: "International checkout is coming soon",
    description: "You can explore the product in English today. Overseas ordering will open only after payment, shipping and after-sales service are ready for the selected market.",
    notice: "No international payment is being collected.",
    sections: [
      { title: "What is available now", items: ["English product information", "Size and pack details", "Brand and launch updates"] },
      { title: "What opens later", items: ["Market eligibility and local currency", "Approved payment methods", "International shipping, duties and taxes", "Market-specific returns and customer care"] },
    ],
  },
};

export const englishInfoPageKeys = Object.keys(englishInfoPages);

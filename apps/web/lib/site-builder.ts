import { brandStoryTagline, brandStoryZh } from "@/lib/brand-story";
import { z } from "zod";
import { buildPrivacyPolicySections } from "@/lib/privacy-policy";
import { buildTermsSections } from "@/lib/terms-of-service";
import { correctServiceContent } from "@/lib/service-content-corrections";
import { miniProgramPrivacyDocument } from "@/lib/miniprogram-privacy-content";

export type SitePageDefinition = {
  key: string;
  name: string;
  path: string | null;
  kind: "HOME" | "CONTENT" | "HEADER" | "FOOTER";
  template: "HOME" | "CONTENT" | "CATALOG" | "HEADER" | "FOOTER";
  sortOrder: number;
  seoTitle?: string;
  seoDescription?: string;
  sections?: SiteSection[];
};

export type PageLink = {
  label: string;
  pageKey: string;
  query?: string;
};

export type HeroSection = {
  id: string;
  type: "hero";
  visible: boolean;
  sortOrder: number;
  eyebrow: string;
  title: string;
  body: string;
  action: PageLink;
  mediaAssetId?: string;
  features: string[];
};

export type CategoryGridSection = {
  id: string;
  type: "categoryGrid";
  visible: boolean;
  sortOrder: number;
  title: string;
  items: Array<{
    id: string;
    title: string;
    body: string;
    link: PageLink;
    mediaAssetId?: string;
  }>;
};

export type ProductGridSection = {
  layout?: "grid" | "spotlight";
  mediaAssetId?: string;
  body?: string;
  id: string;
  type: "productGrid";
  visible: boolean;
  sortOrder: number;
  title: string;
  action: PageLink;
  productIds: string[];
};

export type CardGridSection = {
  layout?: "grid" | "fitPair" | "detailPair";
  body?: string;
  action?: PageLink;
  id: string;
  type: "cardGrid" | "contentGrid";
  visible: boolean;
  sortOrder: number;
  title: string;
  columns: 1 | 2 | 3;
  items: Array<{
    id: string;
    title: string;
    body: string;
    link?: PageLink;
    mediaAssetId?: string;
    table?: {
      headers: string[];
      rows: string[][];
    };
  }>;
};

export type SiteSection = HeroSection | CategoryGridSection | ProductGridSection | CardGridSection;

export type PageDocument = {
  schemaVersion: 1;
  documentType: "page";
  sections: SiteSection[];
};

export type HeaderDocument = {
  schemaVersion: 1;
  documentType: "header";
  items: PageLink[];
};

export type FooterDocument = {
  schemaVersion: 1;
  documentType: "footer";
  brandText: string;
  columns: Array<{
    id: string;
    title: string;
    links: PageLink[];
  }>;
  socialChannels: Array<{
    id: string;
    label: string;
    account: string;
    url: string;
    visible: boolean;
  }>;
  legalLinks: PageLink[];
};

export type SiteDocument = PageDocument | HeaderDocument | FooterDocument;

const text = (max: number) => z.string().trim().max(max);
const requiredText = (max: number) => z.string().trim().min(1).max(max);

const pageLinkSchema = z.object({
  label: requiredText(40),
  pageKey: requiredText(80),
  query: text(160).optional(),
});

const sectionBase = {
  id: requiredText(80),
  visible: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
};

const heroSchema = z.object({
  ...sectionBase,
  type: z.literal("hero"),
  eyebrow: text(80),
  title: requiredText(120),
  body: requiredText(600),
  action: pageLinkSchema,
  mediaAssetId: text(120).optional(),
  features: z.array(requiredText(24)).max(6),
});

const categoryGridSchema = z.object({
  ...sectionBase,
  type: z.literal("categoryGrid"),
  title: requiredText(80),
  items: z.array(z.object({
    id: requiredText(80),
    title: requiredText(60),
    body: requiredText(160),
    link: pageLinkSchema,
    mediaAssetId: text(120).optional(),
  })).min(1).max(8),
});

const productGridSchema = z.object({
  layout:z.enum(["grid","spotlight"]).optional(),
  mediaAssetId:text(120).optional(),
  body:text(600).optional(),
  ...sectionBase,
  type: z.literal("productGrid"),
  title: requiredText(80),
  action: pageLinkSchema,
  productIds: z.array(requiredText(120)).max(12),
});

const cardGridSchema = z.object({
  layout:z.enum(["grid","fitPair","detailPair"]).optional(),
  body:text(600).optional(),
  action:pageLinkSchema.optional(),
  ...sectionBase,
  type: z.enum(["cardGrid", "contentGrid"]),
  title: text(80),
  columns: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  items: z.array(z.object({
    id: requiredText(80),
    title: text(100),
    body: text(2000),
    link: pageLinkSchema.optional(),
    mediaAssetId: text(120).optional(),
    table: z.object({
      headers: z.array(requiredText(120)).min(1).max(8),
      rows: z.array(z.array(requiredText(1000)).min(1).max(8)).min(1).max(100),
    }).optional(),
  })).min(1).max(24),
});

const pageDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  documentType: z.literal("page"),
  sections: z.array(z.discriminatedUnion("type", [heroSchema, categoryGridSchema, productGridSchema, cardGridSchema])).max(48),
});

const headerDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  documentType: z.literal("header"),
  items: z.array(pageLinkSchema).min(1).max(12),
});

const footerDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  documentType: z.literal("footer"),
  brandText: requiredText(500),
  columns: z.array(z.object({
    id: requiredText(80),
    title: requiredText(40),
    links: z.array(pageLinkSchema).min(1).max(10),
  })).min(1).max(6),
  socialChannels: z.array(z.object({
    id: requiredText(80),
    label: requiredText(40),
    account: text(160),
    url: text(320),
    visible: z.boolean(),
  })).max(12),
  legalLinks: z.array(pageLinkSchema).min(1).max(6),
});

export const siteDocumentSchema = z.discriminatedUnion("documentType", [pageDocumentSchema, headerDocumentSchema, footerDocumentSchema]);

export function parseSiteDocument(value: unknown): SiteDocument {
  return siteDocumentSchema.parse(value) as SiteDocument;
}

const content = (id: string, title: string, body: string, link?: PageLink) => ({ id, title, body, link });

export const sitePageDefinitions: SitePageDefinition[] = [
  {
    key: "home",
    name: "首页",
    path: "/",
    kind: "HOME",
    template: "HOME",
    sortOrder: 0,
    seoTitle: "MerchantKit | 示例商城",
    seoDescription: "使用虚构商品体验选购、会员与订单流程。",
  },
  { key: "shop", name: "男士内裤", path: "/shop", kind: "CONTENT", template: "CATALOG", sortOrder: 10, seoTitle: "男士内裤系列", seoDescription: "浏览 MerchantKit X-Series 男士内裤与发售信息。" },
  {
    key: "shopping-guide", name: "选购帮助", path: "/shopping-guide", kind: "CONTENT", template: "CONTENT", sortOrder: 20,
    seoTitle: "选购帮助", seoDescription: "了解 MerchantKit 商品选择、尺码确认、下单和售后入口。",
    sections: [
      { id: "shopping-guide-hero", type: "hero", visible: true, sortOrder: 0, eyebrow: "购物指南", title: "选购帮助", body: "了解商品、确认尺码，并在购买入口开放后完成下单。", action: { label: "浏览商品", pageKey: "shop" }, features: [] },
      { id: "shopping-guide-content", type: "contentGrid", visible: true, sortOrder: 10, title: "下单前确认", columns: 2, items: [
        content("guide-product", "选择商品", "商品页会显示当前发售状态、可选规格与必要的购买信息。"),
        content("guide-size", "确认尺码", "结合尺码指南、商品版型和个人穿着偏好选择。", { label: "查看尺码指南", pageKey: "size-guide" }),
        content("guide-order", "提交订单", "登录账户后核对收货地址、商品规格、数量和应付金额。"),
        content("guide-service", "订单与售后", "订单状态、支付、物流和售后进度都可在个人中心查看。"),
      ] },
    ],
  },
  {
    key: "size-guide", name: "尺码指南", path: "/size-guide", kind: "CONTENT", template: "CONTENT", sortOrder: 30,
    seoTitle: "尺码指南", seoDescription: "查看 MerchantKit 男士内裤的测量方法和尺码选择建议。",
    sections: [
      { id: "size-hero", type: "hero", visible: true, sortOrder: 0, eyebrow: "购物指南", title: "尺码指南", body: "先测量身体数据，再结合商品详情中的版型和面料弹性选择。", action: { label: "浏览商品", pageKey: "shop" }, features: [] },
      { id: "size-content", type: "contentGrid", visible: true, sortOrder: 10, title: "测量与选择", columns: 3, items: [
        content("size-waist", "腰围", "在内裤腰头通常停留的位置水平测量，软尺贴合身体但不要勒紧。"),
        content("size-hip", "臀围", "双脚自然并拢，水平绕过臀部最丰满处测量。"),
        content("size-fit", "穿着偏好", "偏好更宽松的穿着感受，或测量结果处于两码之间时，建议选择较大尺码。"),
      ] },
    ],
  },
  {
    key: "shipping-policy", name: "配送方式", path: "/shipping-policy", kind: "CONTENT", template: "CONTENT", sortOrder: 40,
    seoTitle: "配送方式", seoDescription: "了解 MerchantKit 订单确认、发货、物流跟踪和配送异常处理。",
    sections: policySections("shipping", "配送政策", "运费会根据结账页选择的中国大陆收货省区自动计算，并在提交订单前显示。", [
      ["包邮范围", "当前仅支持中国大陆地区配送；除下列特殊及偏远地区外，订单免收标准配送费。"],
      ["特殊地区", "内蒙古、甘肃、青海、宁夏、海南每单收取 10 元配送费。"],
      ["偏远地区", "新疆、西藏每单收取 20 元配送费。"],
      ["订单处理", "已支付订单经确认后进入备货，实际发货时间受库存和仓库处理进度影响。"],
      ["物流信息", "发货后订单详情会显示物流公司和运单号。"],
      ["地址确认", "下单前请确认收件人、手机号和详细地址；发货后修改地址可能受限。"],
      ["配送异常", "物流停滞、破损或丢件请从订单详情联系售后，并保留外包装和相关凭证。"],
    ]),
  },
  {
    key: "payment-methods", name: "支付方式", path: "/payment-methods", kind: "CONTENT", template: "CONTENT", sortOrder: 50,
    seoTitle: "支付方式", seoDescription: "了解 MerchantKit 当前可用支付方式、支付状态与安全提醒。",
    sections: policySections("payment", "支付方式", "实际可用支付方式以结账页为准，支付结果以订单状态为准。", [
      ["支付宝", "当前结账页支持支付宝。支付成功后订单状态会由支付服务通知或主动查单结果更新。"],
      ["微信支付", "支付方式暂时不可用。当前结账页不会开放微信支付入口。"],
      ["银行卡", "支付方式暂时不可用。当前结账页不会开放银行卡支付入口。"],
      ["安全提醒", "请只通过本站订单页或官方支付页付款，不要向非官方账号转账。"],
    ]),
  },
  {
    key: "return-policy", name: "退换货政策", path: "/return-policy", kind: "CONTENT", template: "CONTENT", sortOrder: 60,
    seoTitle: "退换货政策", seoDescription: "查看 MerchantKit 退货、换货、仅退款和质量问题处理规则。",
    sections: policySections("return", "退换货政策", "退换货需要关联真实订单和商品规格，并根据商品状态与审核结果处理。", [
      ["申请入口", "登录后从订单详情选择对应商品发起售后，填写原因并上传必要凭证。"],
      ["商品状态", "商品应保持完好且不影响二次销售；质量问题不受此条件限制，但需提供有效凭证。"],
      ["寄回与验收", "审核通过后按页面提供的地址寄回，并在售后详情填写物流信息。"],
      ["退款与换货", "仓库验收后按审核结论进入退款、换货或补发流程。"],
    ]),
  },
  {
    key: "after-sales-process", name: "售后流程", path: "/after-sales-process", kind: "CONTENT", template: "CONTENT", sortOrder: 70,
    seoTitle: "售后流程", seoDescription: "了解 MerchantKit 售后申请、审核、寄回、验收、退款、换货和补发流程。",
    sections: policySections("after-sales", "售后流程", "申请提交后可在个人中心查看当前进度。", [
      ["1. 提交申请", "从已支付订单中选择商品、售后类型和数量，填写原因并上传凭证。"],
      ["2. 平台审核", "运营人员核对订单、商品、凭证和申请类型，给出通过、驳回或补充材料结果。"],
      ["3. 寄回与验收", "需要退回商品时，按审核指引寄出并填写物流；仓库收货后完成检验。"],
      ["4. 完成处理", "系统按审核结果执行退款、换货或补发，并记录完整处理状态。"],
    ]),
  },
  {
    key: "after-sales-policy", name: "售后政策", path: "/after-sales-policy", kind: "CONTENT", template: "CONTENT", sortOrder: 75,
    seoTitle: "售后政策", seoDescription: "查看 MerchantKit 售后申请范围、审核依据、凭证和处理结果说明。",
    sections: policySections("after-sales-policy", "售后政策", "售后申请需要关联真实订单商品，并按申请类型、凭证和商品状态审核。", [
      ["适用范围", "已支付订单可按商品实际情况申请退货退款、换货、仅退款、补发或质量问题处理。"],
      ["申请材料", "请提供清楚的问题描述和必要图片，平台可能要求补充包装、吊牌或物流凭证。"],
      ["审核结果", "审核结果会记录通过、驳回、补充材料、寄回、验收和后续处理要求。"],
      ["进度查询", "用户可在个人中心查看售后状态、平台消息、寄回信息和退款或补发结果。"],
    ]),
  },
  {
    key: "faq", name: "常见问题", path: "/faq", kind: "CONTENT", template: "CONTENT", sortOrder: 80,
    seoTitle: "常见问题", seoDescription: "MerchantKit 账户、商品、支付、配送和售后常见问题。",
    sections: policySections("faq", "常见问题", "快速查看购买与售后中的常见问题。", [
      ["为什么结账前需要登录？", "订单、地址、支付状态和售后记录需要绑定账户，登录后才能保证信息可追溯。"],
      ["价格和发售状态以哪里为准？", "以商品页与提交订单时显示的信息为准。"],
      ["支付后页面没有更新怎么办？", "可进入我的订单查看状态；系统也会通过支付服务主动查单同步。"],
      ["如何申请售后？", "从个人中心的订单详情选择商品发起售后，并按提示补充原因和图片。"],
    ]),
  },
  {
    key: "contact", name: "联系我们", path: "/contact", kind: "CONTENT", template: "CONTENT", sortOrder: 90,
    seoTitle: "联系我们", seoDescription: "联系 MerchantKit 客服，提交普通咨询或从订单详情发起售后。",
    sections: policySections("contact", "联系我们", "普通咨询可在本页提交；订单相关问题建议从订单详情进入。", [
      ["客服邮箱", "适合订单咨询、售后补充材料和商务沟通。"],
      ["服务时间", "工作日 10:00-18:00；节假日、活动期和物流高峰期回复可能顺延。"],
      ["订单售后", "优先从订单详情申请售后，以便自动关联订单、商品、SKU 和凭证。"],
    ]),
  },
  {
    key: "about", name: "品牌故事", path: "/about", kind: "CONTENT", template: "CONTENT", sortOrder: 100,
    seoTitle: "品牌故事", seoDescription: "了解 MerchantKit 对男士贴身穿着、版型与结构细节的产品理念。",
    sections: policySections("about", "品牌故事", brandStoryTagline,
      brandStoryZh.map(section => [section.title, section.paragraphs.join("\n\n")])) ,
  },
  {
    key: "official-channels", name: "官方渠道", path: "/official-channels", kind: "CONTENT", template: "CONTENT", sortOrder: 110,
    seoTitle: "官方渠道", seoDescription: "查看 MerchantKit 官方社交媒体和防假冒提醒。",
    sections: policySections("channels", "官方渠道", "请以本页展示的账号和链接为准，谨防假冒账号。", [
      ["防假冒提醒", "请勿向非官方账号转账，不要把验证码、密码或支付凭证发送给陌生账号。"],
      ["订单与售后", "订单、支付、退款和售后进度以本站系统记录为准。"],
    ]),
  },
  {
    key: "miniprogram-privacy", name: "小程序隐私说明", path: "/miniprogram-privacy", kind: "CONTENT", template: "CONTENT", sortOrder: 119,
    seoTitle: "小程序隐私说明", seoDescription: "MerchantKit 小程序登录、手机号关联、订单、支付和售后的信息处理说明。", sections: miniProgramPrivacyDocument.sections,
  },
  {
    key: "privacy-policy", name: "隐私政策", path: "/privacy-policy", kind: "CONTENT", template: "CONTENT", sortOrder: 120,
    seoTitle: "隐私政策 | MerchantKit", seoDescription: "了解 MerchantKit 如何处理账户、订单、支付、配送、售后、访问分析、设备识别和 Cookie 信息。",
    sections: buildPrivacyPolicySections(),
  },
  {
    key: "terms", name: "服务条款", path: "/terms", kind: "CONTENT", template: "CONTENT", sortOrder: 130,
    seoTitle: "服务条款 | MerchantKit", seoDescription: "MerchantKit 中国大陆版网站使用规则与商品交易合同，涵盖账户、商品、订单、支付、配送、退换货、售后、隐私和争议解决。",
    sections: buildTermsSections(),
  },
  { key: "header", name: "顶部导航", path: null, kind: "HEADER", template: "HEADER", sortOrder: 900 },
  { key: "footer", name: "页脚", path: null, kind: "FOOTER", template: "FOOTER", sortOrder: 910 },
];

function policySections(prefix: string, title: string, description: string, items: Array<[string, string]>): SiteSection[] {
  return [
    {
      id: `${prefix}-hero`, type: "hero", visible: true, sortOrder: 0, eyebrow: "MerchantKit 服务", title, body: description,
      action: { label: "浏览商品", pageKey: "shop" }, features: [],
    },
    {
      id: `${prefix}-content`, type: "contentGrid", visible: true, sortOrder: 10, title: "", columns: 2,
      items: items.map(([itemTitle, body], index) => content(`${prefix}-${index + 1}`, itemTitle, body)),
    },
  ];
}

export function defaultHomeDocument(productIds: string[] = []): PageDocument {
  return {
    schemaVersion: 1,
    documentType: "page",
    sections: [
      {
        id: "home-hero", type: "hero", visible: true, sortOrder: 0, eyebrow: "MerchantKit Demo", title: "Essential Brief Demo", body: "使用虚构商品体验选购、会员与订单流程。",
        action: { label: "浏览当前商品", pageKey: "shop" }, mediaAssetId: "media-system-logo", features: [],
      },
      {
        id: "shop-by-fit", type: "categoryGrid", visible: true, sortOrder: 10, title: "按版型选购", items: [
          { id: "fit-brief", title: "三角内裤", body: "示例商品版型", link: { label: "浏览示例商品", pageKey: "shop", query: "silhouette=三角" }, mediaAssetId: "media-system-logo" },
        ],
      },
      {
        id: "x-series", type: "productGrid", visible: true, sortOrder: 20, title: "示例商品",
        action: { label: "查看全部", pageKey: "shop" }, productIds: productIds.slice(0, 12),
      },
      {
        id: "home-principles", type: "contentGrid", visible: true, sortOrder: 30, title: "选择适合你的结构", columns: 3, items: [
          { id: "principle-fit", title: "版型", body: "当前提供低腰三角版型，强调贴合与活动空间。" },
          { id: "principle-rise", title: "腰位", body: "低腰与中低腰决定腰头落点，以及与外裤腰线的关系。" },
          { id: "principle-detail", title: "结构", body: "网眼、侧带、前片分割和包边共同构成每款的穿着差异。", link: { label: "查看尺码指南", pageKey: "size-guide" } },
        ],
      },
    ],
  };
}

export function buildDefaultSiteDocument(pageKey: string, productIds: string[] = []): SiteDocument {
  if (pageKey === "miniprogram-privacy") return structuredClone(miniProgramPrivacyDocument);
  if (pageKey === "home") return defaultHomeDocument(productIds);
  if (pageKey === "header") return defaultHeaderDocument();
  if (pageKey === "footer") return defaultFooterDocument();
  const definition = sitePageDefinitions.find((page) => page.key === pageKey);
  return correctServiceContent(pageKey, { schemaVersion: 1, documentType: "page", sections: definition?.sections ?? [] });
}

export function defaultHeaderDocument(): HeaderDocument {
  return {
    schemaVersion: 1,
    documentType: "header",
    items: [
      { label: "首页", pageKey: "home" },
      { label: "男士内裤", pageKey: "shop" },
      { label: "X-Series", pageKey: "home", query: "#x-series" },
      { label: "尺码指南", pageKey: "size-guide" },
      { label: "品牌故事", pageKey: "about" },
    ],
  };
}

export function defaultFooterDocument(): FooterDocument {
  return {
    schemaVersion: 1,
    documentType: "footer",
    brandText: "MerchantKit 专注男士内裤与贴身穿着，以简洁版型、结构细节与材料表达构成 X-Series。",
    columns: [
      { id: "footer-shopping", title: "购物指南", links: [
        { label: "选购帮助", pageKey: "shopping-guide" }, { label: "尺码指南", pageKey: "size-guide" },
        { label: "配送方式", pageKey: "shipping-policy" }, { label: "支付方式", pageKey: "payment-methods" },
      ] },
      { id: "footer-service", title: "售后服务", links: [
        { label: "退换货政策", pageKey: "return-policy" }, { label: "售后流程", pageKey: "after-sales-process" },
        { label: "常见问题", pageKey: "faq" }, { label: "联系我们", pageKey: "contact" },
      ] },
      { id: "footer-about", title: "关于我们", links: [
        { label: "品牌故事", pageKey: "about" }, { label: "官方渠道", pageKey: "official-channels" },
        { label: "隐私政策", pageKey: "privacy-policy" }, { label: "服务条款", pageKey: "terms" },
      ] },
    ],
    socialChannels: [
      { id: "wechat", label: "微信", account: "", url: "", visible: true },
      { id: "xiaohongshu", label: "小红书", account: "", url: "", visible: true },
      { id: "douyin", label: "抖音", account: "", url: "", visible: true },
    ],
    legalLinks: [
      { label: "隐私政策", pageKey: "privacy-policy" },
      { label: "服务条款", pageKey: "terms" },
      { label: "联系方式", pageKey: "contact" },
    ],
  };
}

export function resolvePageHref(link: Pick<PageLink, "pageKey" | "query">, pages: Array<{ key: string; path: string | null }>) {
  const path = pages.find((page) => page.key === link.pageKey)?.path ?? "/";
  if (!link.query) return path;
  if (link.query.startsWith("#")) return `${path}${link.query}`;
  return `${path}?${link.query.replace(/^\?/, "")}`;
}

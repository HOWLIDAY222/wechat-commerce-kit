import {
  footerNavigationSettingKey,
  socialChannelsSettingKey,
  stringifyFooterNavigation,
  stringifySocialChannels,
} from "@/lib/site-management";
import { BRAND_NAME, BRAND_SHARE_IMAGE } from "@/lib/brand";

export const contentSettingDefinitions = [
  {
    key: "content.home.seoTitle",
    label: "首页 SEO 标题",
    area: "SEO",
    defaultValue: `${BRAND_NAME} X-Series 男士内裤`,
  },
  {
    key: "content.home.seoDescription",
    label: "首页 SEO 描述",
    area: "SEO",
    defaultValue: `${BRAND_NAME} X-Series 男士内裤，探索贴合、支撑与轻盈触感。`,
  },
  {
    key: "content.home.heroTitle",
    label: "首页主标题",
    area: "首页",
    defaultValue: "X-Series",
  },
  {
    key: "content.home.heroBody",
    label: "首页主文案",
    area: "首页",
    defaultValue: "从贴合、支撑与轻盈触感出发，重新理解日常贴身穿着。",
  },
  {
    key: "content.policy.shippingSummary",
    label: "配送政策摘要",
    area: "政策",
    defaultValue: "订单确认后进入配送流程，发货时间与物流信息以订单详情为准。",
  },
  {
    key: "content.policy.returnSummary",
    label: "退换货政策摘要",
    area: "政策",
    defaultValue: "退换货以商品未影响二次销售和页面政策为准；质量问题可提交售后申请并补充凭证。",
  },
  {
    key: "content.policy.afterSalesSummary",
    label: "售后政策摘要",
    area: "政策",
    defaultValue:
      "售后申请需关联已支付订单和对应商品，处理进度可在个人中心查看。",
  },
  {
    key: "content.og.image",
    label: "OG 分享图",
    area: "SEO",
    defaultValue: BRAND_SHARE_IMAGE,
  },
  {
    key: footerNavigationSettingKey,
    label: "底部导航配置",
    area: "页脚",
    defaultValue: stringifyFooterNavigation(),
  },
  {
    key: socialChannelsSettingKey,
    label: "社媒渠道配置",
    area: "页脚",
    defaultValue: stringifySocialChannels(),
  },
] as const;

export type ContentSettingKey = (typeof contentSettingDefinitions)[number]["key"];

export const contentSettingKeys = contentSettingDefinitions.map((item) => item.key) as [
  ContentSettingKey,
  ...ContentSettingKey[],
];

export type PublicContentSettings = Record<ContentSettingKey, string>;

export function getDefaultContentSettings(): PublicContentSettings {
  return Object.fromEntries(contentSettingDefinitions.map((item) => [item.key, item.defaultValue])) as PublicContentSettings;
}

export function getDefaultContentSetting(key: ContentSettingKey) {
  return getDefaultContentSettings()[key];
}

export function isContentSettingKey(value: string): value is ContentSettingKey {
  return (contentSettingKeys as readonly string[]).includes(value);
}

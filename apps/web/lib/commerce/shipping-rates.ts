export const MAINLAND_PROVINCES = [
  "北京市", "天津市", "河北省", "山西省", "内蒙古自治区", "辽宁省", "吉林省", "黑龙江省",
  "上海市", "江苏省", "浙江省", "安徽省", "福建省", "江西省", "山东省", "河南省", "湖北省",
  "湖南省", "广东省", "广西壮族自治区", "海南省", "重庆市", "四川省", "贵州省", "云南省",
  "西藏自治区", "陕西省", "甘肃省", "青海省", "宁夏回族自治区", "新疆维吾尔自治区",
] as const;

const REMOTE_PROVINCES = new Set(["内蒙古自治区", "甘肃省", "青海省", "宁夏回族自治区", "海南省"]);
const FAR_REMOTE_PROVINCES = new Set(["新疆维吾尔自治区", "西藏自治区"]);

const PROVINCE_ALIASES: Record<string, (typeof MAINLAND_PROVINCES)[number]> = {
  北京: "北京市",
  天津: "天津市",
  河北: "河北省",
  山西: "山西省",
  内蒙古: "内蒙古自治区",
  辽宁: "辽宁省",
  吉林: "吉林省",
  黑龙江: "黑龙江省",
  上海: "上海市",
  江苏: "江苏省",
  浙江: "浙江省",
  安徽: "安徽省",
  福建: "福建省",
  江西: "江西省",
  山东: "山东省",
  河南: "河南省",
  湖北: "湖北省",
  湖南: "湖南省",
  广东: "广东省",
  广西: "广西壮族自治区",
  海南: "海南省",
  重庆: "重庆市",
  四川: "四川省",
  贵州: "贵州省",
  云南: "云南省",
  西藏: "西藏自治区",
  陕西: "陕西省",
  甘肃: "甘肃省",
  青海: "青海省",
  宁夏: "宁夏回族自治区",
  新疆: "新疆维吾尔自治区",
};

export type ShippingRateConfig = {
  baseFeeCents: number;
  farRemoteFeeCents: number;
  remoteFeeCents: number;
};

export type ShippingQuote = {
  feeCents: number;
  label: string;
  province: (typeof MAINLAND_PROVINCES)[number];
  tier: "STANDARD" | "REMOTE" | "FAR_REMOTE";
};

export function calculateShippingQuote(provinceInput: string, config: ShippingRateConfig): ShippingQuote {
  const province = normalizeMainlandProvince(provinceInput);
  if (!province) throw new Error("SHIPPING_PROVINCE_UNSUPPORTED");

  if (FAR_REMOTE_PROVINCES.has(province)) {
    return { feeCents: config.farRemoteFeeCents, label: "偏远地区配送", province, tier: "FAR_REMOTE" };
  }
  if (REMOTE_PROVINCES.has(province)) {
    return { feeCents: config.remoteFeeCents, label: "特殊地区配送", province, tier: "REMOTE" };
  }
  return { feeCents: config.baseFeeCents, label: config.baseFeeCents === 0 ? "中国大陆包邮" : "标准配送", province, tier: "STANDARD" };
}

export function normalizeMainlandProvince(value: string) {
  const normalized = value.replace(/\s+/g, "").trim();
  if (!normalized) return null;
  const exact = MAINLAND_PROVINCES.find((province) => province === normalized);
  if (exact) return exact;
  const alias = Object.entries(PROVINCE_ALIASES).find(([name]) => normalized === name || normalized.startsWith(name));
  return alias?.[1] ?? null;
}

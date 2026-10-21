import { getProductBySlug } from "@/lib/services/catalog-service";
import { getMemberBenefits } from "@/lib/services/membership-service";
import { getPointsRule } from "@/lib/services/member-points-service";
import { getShippingRateConfig } from "@/lib/commerce/shipping";
import { prisma } from "@/lib/db/prisma";
import { X1_BODY_SIZES } from "@/components/product/x1-size-table";
import { getPublicSiteSettings } from "@/lib/services/public-site-settings-service";
import { getPublicSiteManagementSettings } from "@/lib/services/site-management-service";
import { OFFICIAL_EMAILS } from "@/lib/official-emails";
import type { CardGridSection, PageDocument } from "@/lib/site-builder";
import type { StorefrontProduct } from "@/lib/storefront-product";

export function dispatchDate(product: StorefrontProduct) {
  const value = product.release.estimatedShipAt;
  return value ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "long", day: "numeric" }).format(new Date(value)) : "";
}

export function productPriceRows(product: StorefrontProduct) {
  if (!product.release.showPrice) return [];
  const pricing = product.quantityPricing;
  const styles = pricing?.styles || [{ key: "default", label: product.name, summary: product.summary, unitPriceCents: product.minPriceCents, tiers: pricing?.tiers || [] }];
  return styles.map(style => ({ ...style, prices: [{quantity:1,cents:style.unitPriceCents},...style.tiers.slice().sort((a,b)=>a.quantity-b.quantity).map(t=>({quantity:t.quantity,cents:t.totalPriceCents}))] }));
}

export async function getPublicMemberProgramme() {
  const now = new Date();
  const [benefits, rule, offers] = await Promise.all([
    getMemberBenefits(), getPointsRule(),
    prisma.couponTemplate.findMany({ where: { active: true, startsAt: { lte: now }, endsAt: { gt: now } }, select: { deliveryMode: true, issuedCount: true, totalLimit: true } }),
  ]);
  const available = offers.filter(t => t.issuedCount < t.totalLimit);
  return { benefits, rule, publicCoupons: available.some(t => t.deliveryMode === "PUBLIC"), rewards: available.some(t => t.deliveryMode === "POINTS") };
}

const pricingRepeatText = (product:StorefrontProduct) => product.quantityPricing?.repeatBundles ? "一条起售，两条起享组合价；数量可增减，超过四条自动拆分为最省的组合。" : "";
const money = (cents: number) => `¥${(cents / 100).toFixed(2).replace(/\.00$/, "")}`;
type Item = CardGridSection["items"][number];
function section(id: string, title: string, items: Item[]): CardGridSection {
  return { id, type: "contentGrid", visible: true, sortOrder: 900, title, columns: 2, items };
}

// These operational facts come from the same records used by checkout. The CMS
// document remains editable; only this clearly separate current-information block is generated.
export async function withStorefrontInformation(pageKey: string, document: PageDocument, miniProgram = false): Promise<PageDocument> {
  const additions: CardGridSection[] = [];
  if (["shopping-guide", "faq", "shipping-policy"].includes(pageKey)) {
    const product = await getProductBySlug("x1-air-white");
    if (product) {
      const rows = productPriceRows(product);
      const date = dispatchDate(product);
      const items: Item[] = [];
      if (pageKey !== "shipping-policy") {
        items.push({ id: "live-product-specs", title: "当前商品与款式", body: product.description || product.summary });
        for (const row of rows) items.push({ id: `live-price-${row.key}`, title: row.label, body: `${row.summary}\n${row.prices.map(p => `${p.quantity} 条 ${money(p.cents)}`).join(" · ")}` });
        items.push({ id: "live-product-size", title: "颜色、尺码与组合", body: `${product.colors.join(" / ")} · ${[...product.sizes].sort().join(" / ")}。${pricingRepeatText(product)}同款不同尺码可合并计算组合价，不同款式分别计价。具体价格以提交订单时核算结果为准。` });
      }
      items.push({ id: "live-dispatch", title: "当前发售与发货", body: `${product.release.statusLabel}${date ? `，预计 ${date}前发货。` : "，具体发货安排以商品页和订单记录为准。"}请在付款前核对商品、规格、地址、运费及预计发货时间。` });
      additions.push(section("live-product-information", "当前商品信息", items));
    }
  }
  if (["shopping-guide", "faq"].includes(pageKey)) {
    const programme = await getPublicMemberProgramme();
    additions.push(section("live-member-information", "会员、优惠券与积分", [
      { id: "live-member-entry", title: "如何加入及查看权益？", body: "小程序进入“我的 → 会员中心”，登录并绑定手机号后可免费入会。优惠券、积分余额和兑换记录均在会员中心查看。入会不等于已获得优惠券，具体以当前开放的活动为准。" },
      { id: "live-member-coupons", title: "现在可以领券吗？", body: programme.publicCoupons ? "当前有领取活动，登录后在会员中心查看领取条件、有效期与适用商品。自动发券仅在对应活动开放且满足触发条件时生效。" : "当前暂无开放的公开领券活动。正式活动未开放时不会承诺入会送券；账户内已发放的有效券按券面规则使用。" },
      { id: "live-member-pricing", title: "券与组合价怎样使用？", body: "结算自动比较可用优惠券与组合优惠，择优使用，不叠加；同额时优先保留优惠券。券不抵扣运费。未支付订单取消后返券，有效期不延长；已支付订单退款后不返券。" },
      { id: "live-member-points", title: "购物会获得积分吗？", body: programme.rule.enabled ? `新订单按创建时有效规则，在确认收货后按商品实付金额每 ${(programme.rule.centsPerPoint / 100).toFixed(2)} 元累计 1 积分，不含运费，不足 1 积分舍去。退款按规则扣回对应积分。` : "当前购物积分累计活动未启用，购买不会因本说明自动获得积分。已有积分保留，可在兑换活动开放时使用。" },
      { id: "live-member-rewards", title: "积分如何兑换？", body: `${programme.rewards ? "当前有积分兑换活动，可在会员中心选择开放的权益并确认兑换。" : "当前暂无开放的积分兑换活动，请在会员中心查看后续开放权益。"}兑换成功即扣积分，优惠券存入卡包；券过期不退积分。积分不能充值、提现或直接抵扣货款。商城暂不提供储值。` },
    ]));
  }
  if (pageKey === "shipping-policy") {
    const rate = await getShippingRateConfig();
    if (rate) {
      const next = structuredClone(document);
      for (const s of next.sections) if (s.type === "contentGrid" || s.type === "cardGrid") for (const item of s.items) {
        if (item.title === "包邮范围") item.body = `当前仅支持中国大陆地区配送。除下列特殊及偏远地区外，标准配送费为 ${money(rate.baseFeeCents)}。`;
        if (item.title === "特殊地区") item.body = `内蒙古、甘肃、青海、宁夏、海南每单收取 ${money(rate.remoteFeeCents)} 配送费。`;
        if (item.title === "偏远地区") item.body = `新疆、西藏每单收取 ${money(rate.farRemoteFeeCents)} 配送费。`;
      }
      return { ...next, sections: [...next.sections, ...additions] };
    }
  }
  if (pageKey === "size-guide" && miniProgram) additions.push(section("live-size-reference", "X1 Air 人体尺寸参考", [
    ...X1_BODY_SIZES.map(row => ({ id: `live-size-${row.size}`, title: row.size, body: `人体腰围 ${row.waist} cm；参考体重 ${row.weight} kg。` })),
    { id: "live-size-note", title: "选择建议", body: "以上为适合的人体腰围，并非内裤平铺尺寸。以腰围为主要依据，体重仅供参考；S 码适合偏瘦体型。处于两码之间时结合穿着偏好选择较大尺码。" },
  ]));
  if (pageKey === "contact" && miniProgram) {
    const settings = await getPublicSiteSettings();
    additions.push(section("live-contact-information", "联系渠道", [
      { id: "live-support-email", title: "客服与售后", body: settings.supportEmail || OFFICIAL_EMAILS.support },
      { id: "live-info-email", title: "一般咨询", body: OFFICIAL_EMAILS.info },
      ...(settings.supportPhone && settings.supportPhone !== "13900000004" ? [{ id: "live-support-phone", title: "联系电话", body: settings.supportPhone }] : []),
    ]));
  }
  if (pageKey === "official-channels" && miniProgram) {
    const settings = await getPublicSiteManagementSettings();
    const channels = settings.socialChannels.filter(channel => channel.visible && channel.url);
    if (channels.length) additions.push(section("live-official-channels", "官方账号", channels.map((channel, index) => ({ id: `live-channel-${index}`, title: channel.label, body: [channel.account, channel.url].filter(Boolean).join("\n") }))));
  }
  return additions.length ? { ...document, sections: [...document.sections, ...additions] } : document;
}

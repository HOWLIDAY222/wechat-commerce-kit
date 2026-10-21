import type { PageDocument } from "@/lib/site-builder";

// A small migration of obsolete service wording, shared with bootstrap content.
// Preserve all sections and editor changes outside the named items.
export function correctServiceContent(key: string, input: PageDocument): PageDocument {
  const document = structuredClone(input);
  for (const section of document.sections) {
    if (section.type === "hero") {
      if (key === "payment-methods") section.body = "国内站 example.invalid.cn 的选购与支付在微信小程序中完成；全球站 example.invalid 的海外交易尚未开放。支付结果以订单状态为准。";
      if (key === "shopping-guide") section.body = "先确认款式、尺码和数量，再在微信小程序核对地址、运费及预计发货时间后下单。海外交易尚未开放。";
      if (key === "contact") section.body = "普通咨询可联系官方客服；订单相关问题建议从订单详情进入，以便关联订单与处理记录。";
    }
    if (section.type !== "contentGrid" && section.type !== "cardGrid") continue;
    for (const item of section.items) {
      if (key === "payment-methods") {
        if (item.id === "payment-1") { item.title = "国内购买入口"; item.body = "国内官网用于浏览品牌与商品信息，选购时打开微信小程序；国内网页不提供直接付款入口。"; }
        if (item.id === "payment-2") { item.title = "微信支付"; item.body = "在微信小程序结算页确认商品、地址、运费及应付金额后使用微信支付。付款后可在“我的 → 订单”查看支付和物流状态。"; }
        if (item.id === "payment-3") { item.title = "海外支付"; item.body = "海外售价、支付方式、配送及税费规则待公布，海外交易尚未开放。请勿把国内价格或优惠视为海外报价。"; }
        if (item.id === "payment-4") item.body = "只通过官方小程序订单页及微信支付确认页面付款，不向个人或非官方账号转账。支付后未更新时，先刷新订单核对状态，再联系客服，避免重复付款。";
      }
      if (key === "shopping-guide") {
        if (item.id === "guide-order") item.body = "在小程序登录后，核对款式、尺码、数量、收货地址、运费、优惠与应付金额，再提交订单并付款。";
        if (item.id === "guide-service") item.body = "在小程序“我的 → 订单”查看订单、支付及物流；从订单详情申请售后。会员中心用于领券、查看卡包和积分兑换。";
      }
      if (key === "official-channels" && item.id === "channels-2") item.body = "国内购买请使用官方微信小程序，订单、支付、物流和售后进度以对应账户订单详情为准。海外交易尚未开放。";
    }
  }
  return document;
}

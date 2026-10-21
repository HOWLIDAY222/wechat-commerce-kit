import type { PageDocument } from "@/lib/site-builder";

// A small migration of obsolete service wording, shared with bootstrap content.
// Preserve all sections and editor changes outside the named items.
export function correctServiceContent(key: string, input: PageDocument): PageDocument {
  const document = structuredClone(input);
  for (const section of document.sections) {
    if (section.type === "hero") {
      if (key === "payment-methods") section.body = "社区演示默认使用模拟支付，不会扣款。部署后的实际支付方式以结算页配置为准，支付结果以订单记录为准。";
      if (key === "shopping-guide") section.body = "先确认商品、尺码和数量，再核对收货地址、运费与应付金额。社区演示使用虚构商品和模拟支付。";
      if (key === "contact") section.body = "普通咨询可联系官方客服；订单相关问题建议从订单详情进入，以便关联订单与处理记录。";
    }
    if (section.type !== "contentGrid" && section.type !== "cardGrid") continue;
    for (const item of section.items) {
      if (key === "payment-methods") {
        if (item.id === "payment-1") { item.title = "模拟支付"; item.body = "本地默认模拟支付成功、待支付与取消流程，不发生真实扣款。演示订单不能作为实际交易凭据。"; }
        if (item.id === "payment-2") { item.title = "微信支付接入"; item.body = "原生小程序提供微信支付适配。部署者需自行配置商户账户、平台权限和回调，并完成真实交易验收后开放。"; }
        if (item.id === "payment-3") { item.title = "其他支付方式"; item.body = "可用方式取决于部署环境和已接通的支付服务。页面浏览与模拟付款不代表真实支付服务已开通。"; }
        if (item.id === "payment-4") item.body = "付款后先核对订单状态，避免重复付款。请勿向示例邮箱、个人或未经确认的账户转账。";
      }
      if (key === "shopping-guide") {
        if (item.id === "guide-order") item.body = "登录后核对商品、尺码、数量、收货地址、运费、优惠与应付金额，再提交演示订单。";
        if (item.id === "guide-service") item.body = "从账户的订单列表查看订单与支付状态，从订单详情发起售后；会员功能以当前配置为准。";
      }
      if (key === "official-channels" && item.id === "channels-2") item.body = "社区示例不提供真实交易或官方社媒账号。部署后请配置自己的购买入口和联系渠道，订单与售后进度以账户中的记录为准。";
    }
  }
  return document;
}

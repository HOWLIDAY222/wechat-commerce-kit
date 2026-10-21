import { weChatShippingRequest } from "@/lib/providers/wechat-shipping";
import { parseTemplate, type SubscriptionTemplate } from "@/lib/commerce/wechat-subscriptions";
let cache: { templates: SubscriptionTemplate[]; until: number } | undefined;
export async function getWeChatSubscriptionTemplates(force = false) {
  if (!force && cache && cache.until > Date.now()) return cache.templates;
  const result = await weChatShippingRequest("/wxaapi/newtmpl/gettemplate", {}, "GET");
  if (!Array.isArray(result.data)) throw Error("SUBSCRIPTION_CATALOG_INVALID");
  const templates = result.data.map(parseTemplate).filter((row): row is SubscriptionTemplate => !!row);
  cache = { templates, until: Date.now() + 5 * 60 * 1000 }; return templates;
}
export async function sendWeChatSubscription(input: { openId: string; templateId: string; page: string; data: Record<string, { value: string }> }) {
  // A failed/uncertain send is never silently repeated. Caller journals the
  // independent delivery before this request and quarantines unknown outcomes.
  let result: Record<string, unknown>;
  try {
    result = await weChatShippingRequest("/cgi-bin/message/subscribe/send", { touser: input.openId, template_id: input.templateId, page: input.page, data: input.data, miniprogram_state: "formal", lang: "zh_CN" });
  } catch (error) {
    // The shared transport coerces a string "0" to this error. It is not an
    // authoritative numeric failure code and must remain an uncertain outcome.
    if (error instanceof Error && error.message === "WECHAT_SHIPPING_API_0") throw Error("SUBSCRIPTION_ACCEPTANCE_UNKNOWN");
    throw error;
  }
  if (result.errcode !== 0) throw Error("SUBSCRIPTION_ACCEPTANCE_UNKNOWN");
  return result;
}

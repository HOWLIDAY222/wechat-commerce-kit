import { appConfig } from "@/lib/config";

let cachedToken: { value: string; expiresAt: number } | undefined;
let tokenRequest: Promise<string> | undefined;

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
  if (tokenRequest) return tokenRequest;
  tokenRequest = (async () => {
    if (!appConfig.WECHAT_MINIPROGRAM_APP_ID || !appConfig.WECHAT_MINIPROGRAM_APP_SECRET) throw new Error("WECHAT_MINIPROGRAM_NOT_CONFIGURED");
    const response = await fetch(new URL("/cgi-bin/stable_token", appConfig.WECHAT_API_BASE_URL), {
      method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ grant_type: "client_credential", appid: appConfig.WECHAT_MINIPROGRAM_APP_ID, secret: appConfig.WECHAT_MINIPROGRAM_APP_SECRET, force_refresh: false }),
    });
    const data = await response.json();
    if (!response.ok || typeof data.access_token !== "string" || !Number.isFinite(data.expires_in)) throw new Error("WECHAT_ACCESS_TOKEN_UNAVAILABLE");
    cachedToken = { value: data.access_token, expiresAt: Date.now() + Math.max(0, data.expires_in - 120) * 1000 };
    return cachedToken.value;
  })().finally(() => { tokenRequest = undefined; });
  return tokenRequest;
}

export async function weChatShippingRequest(path: string, body: unknown, method = "POST"): Promise<Record<string, unknown>> {
  const endpoint = new URL(path, appConfig.WECHAT_API_BASE_URL);
  endpoint.searchParams.set("access_token", await accessToken());
  let response: Response;
  try {
    response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify(body) : undefined, cache: "no-store", signal: AbortSignal.timeout(12000) });
  } catch { throw new Error("WECHAT_SHIPPING_NETWORK_UNAVAILABLE"); }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || typeof data !== "object") throw new Error("WECHAT_SHIPPING_INVALID_RESPONSE");
  if (data.errcode && data.errcode !== 0) {
    if ([40001, 40014, 42001].includes(data.errcode)) cachedToken = undefined;
    throw new Error(`WECHAT_SHIPPING_API_${Number(data.errcode)}`);
  }
  return data;
}

export type ShippingOrder = {
  transaction_id: string; merchant_id: string; merchant_trade_no: string; openid: string; order_state: number;
  logistics_type?: number;
  shipping?: { logistics_type?: number; finish_shipping?: boolean; shipping_list?: Array<{ tracking_no: string; express_company: string }> };
};

export async function getWeChatShippingOrder(transactionId: string) {
  const data = await weChatShippingRequest("/wxa/sec/order/get_order", { transaction_id: transactionId });
  const order = data.order as ShippingOrder | undefined;
  if (!order || order.transaction_id !== transactionId || order.merchant_id !== appConfig.WECHAT_PAY_MCH_ID || !Number.isInteger(order.order_state)) throw new Error("WECHAT_SHIPPING_ORDER_MISMATCH");
  return order;
}

export async function resolveWeChatCarrier(company: string) {
  const data = await weChatShippingRequest("/cgi-bin/express/delivery/open_msg/get_delivery_list", {});
  const list = data.delivery_list as Array<{ delivery_id: string; delivery_name: string }> | undefined;
  if (!Array.isArray(list)) throw new Error("WECHAT_DELIVERY_LIST_INVALID");
  const normalized = (s: string) => s.toUpperCase().replace(/快递|速递|速运|快运|物流|\s/g, "");
  const candidates = list.filter(item => item.delivery_id === company.toUpperCase() || normalized(item.delivery_name) === normalized(company));
  if (candidates.length !== 1) throw new Error("WECHAT_DELIVERY_COMPANY_UNKNOWN");
  return candidates[0].delivery_id;
}

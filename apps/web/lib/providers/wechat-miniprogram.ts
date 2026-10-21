import { z } from "zod";
import { appConfig } from "@/lib/config";

const code2SessionSchema = z.object({
  errcode: z.number().optional(),
  errmsg: z.string().optional(),
  openid: z.string().min(1).optional(),
  session_key: z.string().min(1).optional(),
  unionid: z.string().min(1).optional(),
});

type WeChatCodeExchangeOptions = {
  apiBaseUrl?: string;
  appId?: string;
  appSecret?: string;
  fetcher?: typeof fetch;
};

export async function exchangeWeChatLoginCode(code: string, options: WeChatCodeExchangeOptions = {}) {
  const appId = options.appId ?? appConfig.WECHAT_MINIPROGRAM_APP_ID;
  const appSecret = options.appSecret ?? appConfig.WECHAT_MINIPROGRAM_APP_SECRET;
  const apiBaseUrl = options.apiBaseUrl ?? appConfig.WECHAT_API_BASE_URL;
  const fetcher = options.fetcher ?? fetch;

  if (!appId || !appSecret) throw new Error("WECHAT_MINIPROGRAM_NOT_CONFIGURED");

  const endpoint = new URL("/sns/jscode2session", apiBaseUrl);
  endpoint.searchParams.set("appid", appId);
  endpoint.searchParams.set("secret", appSecret);
  endpoint.searchParams.set("js_code", code);
  endpoint.searchParams.set("grant_type", "authorization_code");

  let response: Response;
  try {
    response = await fetcher(endpoint, {
      cache: "no-store",
      method: "GET",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new Error("WECHAT_CODE_EXCHANGE_UNAVAILABLE");
  }
  if (!response.ok) throw new Error("WECHAT_CODE_EXCHANGE_UNAVAILABLE");

  const parsed = code2SessionSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error("WECHAT_CODE_EXCHANGE_INVALID_RESPONSE");
  if (parsed.data.errcode && parsed.data.errcode !== 0) {
    if (parsed.data.errcode === 40029) throw new Error("WECHAT_LOGIN_CODE_INVALID");
    if (parsed.data.errcode === 45011) throw new Error("WECHAT_LOGIN_FREQUENCY_LIMITED");
    throw new Error("WECHAT_CODE_EXCHANGE_FAILED");
  }
  if (!parsed.data.openid || !parsed.data.session_key) {
    throw new Error("WECHAT_CODE_EXCHANGE_INVALID_RESPONSE");
  }

  return {
    appId,
    openId: parsed.data.openid,
    unionId: parsed.data.unionid,
  };
}

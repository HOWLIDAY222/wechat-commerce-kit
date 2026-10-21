import { appConfig } from "@/lib/config";

type Options = { appId?: string; appSecret?: string; apiBaseUrl?: string; fetcher?: typeof fetch; now?: () => number };

// A factory keeps credentials/token caches isolated between applications and tests.
export function createWeChatPhoneProvider(options: Options = {}) {
  const appId = options.appId ?? appConfig.WECHAT_MINIPROGRAM_APP_ID;
  const secret = options.appSecret ?? appConfig.WECHAT_MINIPROGRAM_APP_SECRET;
  const base = options.apiBaseUrl ?? appConfig.WECHAT_API_BASE_URL;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let cached: { value: string; until: number } | undefined;
  let pending: Promise<string> | undefined;

  async function json(path: string, body: unknown, token?: string) {
    const url = new URL(path, base);
    if (token) url.searchParams.set("access_token", token);
    let response: Response;
    try {
      response = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(8000) });
    } catch { throw new Error("WECHAT_PHONE_NETWORK_UNAVAILABLE"); }
    if (!response.ok) throw new Error("WECHAT_PHONE_NETWORK_UNAVAILABLE");
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object") throw new Error("WECHAT_PHONE_INVALID_RESPONSE");
    if (data.errcode && data.errcode !== 0) {
      if ([40001, 40014, 42001].includes(data.errcode)) cached = undefined;
      if (data.errcode === 40029) throw new Error("WECHAT_PHONE_CODE_INVALID");
      if (data.errcode === 45011) throw new Error("WECHAT_PHONE_RATE_LIMITED");
      // Never propagate provider text: it may contain a token, code or phone number.
      throw new Error("WECHAT_PHONE_AUTHORIZATION_FAILED");
    }
    return data;
  }

  async function accessToken() {
    if (cached && cached.until > now()) return cached.value;
    if (pending) return pending;
    pending = (async () => {
      const data = await json("/cgi-bin/stable_token", { grant_type: "client_credential", appid: appId, secret, force_refresh: false });
      if (typeof data.access_token !== "string" || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
        throw new Error("WECHAT_PHONE_INVALID_RESPONSE");
      }
      cached = { value: data.access_token, until: now() + Math.max(0, data.expires_in - 120) * 1000 };
      return cached.value;
    })().finally(() => { pending = undefined; });
    return pending;
  }

  return async function exchangePhoneCode(code: string, openId: string) {
    if (!appId || !secret) throw new Error("WECHAT_MINIPROGRAM_NOT_CONFIGURED");
    if (!code || code.length > 256 || !openId) throw new Error("WECHAT_PHONE_CODE_INVALID");
    // Both quick and realtime codes use this endpoint. Do not retry single-use codes.
    const data = await json("/wxa/business/getuserphonenumber", { code, openid: openId }, await accessToken());
    const info = data.phone_info;
    if (!info || info.watermark?.appid !== appId || !Number.isInteger(info.watermark?.timestamp)) {
      throw new Error("WECHAT_PHONE_INVALID_RESPONSE");
    }
    const age = now() / 1000 - info.watermark.timestamp;
    if (age < -60 || age > 360) throw new Error("WECHAT_PHONE_CODE_INVALID");
    if (info.countryCode !== "86" || typeof info.purePhoneNumber !== "string" || !/^1[3-9]\d{9}$/.test(info.purePhoneNumber)) {
      throw new Error("WECHAT_PHONE_REGION_UNSUPPORTED");
    }
    return info.purePhoneNumber as string;
  };
}

export const exchangeWeChatPhoneCode = createWeChatPhoneProvider();

import { appConfig } from "@/lib/config";

type Options = { appId?: string; appSecret?: string; fetcher?: typeof fetch; now?: () => number };
export function miniProgramDestination(slug?: string) {
  if (slug && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(slug)) throw new Error("INVALID_PRODUCT_SLUG");
  return slug ? { path: "pages/product-detail/index", query: `slug=${encodeURIComponent(slug)}` } : { path: "pages/home/home", query: "" };
}

export function createWeChatLaunchProvider(options: Options = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let token: { value: string; expires: number } | undefined;
  let pendingToken: Promise<string> | undefined;
  const codes = new Map<string, { bytes: Uint8Array; contentType: string; expires: number }>();

  async function post(path: string, body: unknown, accessToken?: string) {
    const url = new URL(path, appConfig.WECHAT_API_BASE_URL);
    if (accessToken) url.searchParams.set("access_token", accessToken);
    try {
      const response = await fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error("WECHAT_LAUNCH_UNAVAILABLE");
      return response;
    } catch { throw new Error("WECHAT_LAUNCH_UNAVAILABLE"); }
  }
  async function json(response: Response) {
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object") throw new Error("WECHAT_LAUNCH_INVALID_RESPONSE");
    if (data.errcode) {
      if ([40001, 40014, 42001].includes(data.errcode)) token = undefined;
      // Provider text and credential-bearing URLs must never reach logs or clients.
      throw new Error("WECHAT_LAUNCH_UNAVAILABLE");
    }
    return data;
  }
  async function getToken() {
    if (token && token.expires > now()) return token.value;
    if (pendingToken) return pendingToken;
    pendingToken = (async () => {
      const appid = options.appId ?? appConfig.WECHAT_MINIPROGRAM_APP_ID;
      const secret = options.appSecret ?? appConfig.WECHAT_MINIPROGRAM_APP_SECRET;
      if (!appid || !secret) throw new Error("WECHAT_MINIPROGRAM_NOT_CONFIGURED");
      const data = await json(await post("/cgi-bin/stable_token", { grant_type: "client_credential", appid, secret, force_refresh: false }));
      if (typeof data.access_token !== "string" || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error("WECHAT_LAUNCH_INVALID_RESPONSE");
      token = { value: data.access_token, expires: now() + Math.max(0, data.expires_in - 120) * 1000 };
      return token.value;
    })().finally(() => { pendingToken = undefined; });
    return pendingToken;
  }
  return {
    async link(slug?: string) {
      const destination = miniProgramDestination(slug);
      const data = await json(await post("/wxa/generate_urllink", { ...destination, env_version: "release", is_expire: true, expire_type: 1, expire_interval: 1 }, await getToken()));
      const link = new URL(typeof data.url_link === "string" ? data.url_link : "invalid", "https://invalid.local");
      if (link.protocol !== "https:" || !["wxaurl.cn", "wxmpurl.cn"].includes(link.hostname) || link.username || link.password || link.port) throw new Error("WECHAT_LAUNCH_INVALID_RESPONSE");
      // Never share a URL Link across visitors; obtain it on an actual visit, not a Next prefetch.
      return link.href;
    },
    async code(slug?: string) {
      const destination = miniProgramDestination(slug);
      const key = slug ?? "home";
      const existing = codes.get(key);
      if (existing && existing.expires > now()) return existing;
      const response = await post("/wxa/getwxacode", { path: destination.path + (destination.query ? `?${destination.query}` : ""), width: 430, env_version: "release" }, await getToken());
      const bytes = new Uint8Array(await response.arrayBuffer());
      // WeChat errors are JSON even when the endpoint normally returns an image.
      const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
      const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
      if ((!png && !jpeg) || bytes.length > 2_000_000) throw new Error("WECHAT_LAUNCH_UNAVAILABLE");
      if (codes.size >= 100) codes.delete(codes.keys().next().value!);
      const code = { bytes, contentType: png ? "image/png" : "image/jpeg", expires: now() + 24 * 60 * 60 * 1000 };
      codes.set(key, code);
      return code;
    },
  };
}
export const weChatLaunch = createWeChatLaunchProvider();

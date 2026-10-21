import { z } from "zod";
import { appConfig } from "@/lib/config";

type Options = { appId?: string; appSecret?: string; apiBaseUrl?: string; fetcher?: typeof fetch; now?: () => number };
const resultSchema = z.object({ errcode: z.literal(0), bind_status: z.union([z.literal(1), z.literal(2), z.literal(3)]), is_student: z.boolean() });
export type WeChatStudentResult = { bindStatus: 1 | 2 | 3; isStudent: boolean };

export function createWeChatStudentProvider(options: Options = {}) {
  const appId = options.appId ?? appConfig.WECHAT_MINIPROGRAM_APP_ID;
  const secret = options.appSecret ?? appConfig.WECHAT_MINIPROGRAM_APP_SECRET;
  const base = options.apiBaseUrl ?? appConfig.WECHAT_API_BASE_URL;
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  let cached: { value: string; until: number } | undefined;
  let pending: Promise<string> | undefined;
  async function post(path: string, body: unknown, token?: string): Promise<Record<string, unknown>> {
    const url = new URL(path, base);
    if (token) url.searchParams.set("access_token", token);
    let response: Response;
    try { response = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(8000) }); }
    catch { throw Error("WECHAT_STUDENT_NETWORK_UNAVAILABLE"); }
    if (!response.ok) throw Error("WECHAT_STUDENT_NETWORK_UNAVAILABLE");
    const value: unknown = await response.json().catch(() => null);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("WECHAT_STUDENT_INVALID_RESPONSE");
    const data = value as Record<string, unknown>;
    if (data.errcode !== undefined && data.errcode !== 0) {
      if ([40001, 40014, 42001].includes(Number(data.errcode))) { cached = undefined; throw Error("WECHAT_STUDENT_TOKEN_EXPIRED"); }
      if ([48001, 61007].includes(Number(data.errcode))) throw Error("WECHAT_STUDENT_PERMISSION_REQUIRED");
      if ([40097, 83400, 83402].includes(Number(data.errcode))) throw Error("WECHAT_STUDENT_CODE_INVALID");
      if (Number(data.errcode) === 83401) throw Error("WECHAT_STUDENT_RATE_LIMITED");
      throw Error("WECHAT_STUDENT_CHECK_FAILED");
    }
    return data;
  }
  async function accessToken() {
    if (cached && cached.until > now()) return cached.value;
    if (pending) return pending;
    pending = (async () => {
      const data = await post("/cgi-bin/stable_token", { grant_type: "client_credential", appid: appId, secret, force_refresh: false });
      if (typeof data.access_token !== "string" || !data.access_token || typeof data.expires_in !== "number" || !Number.isSafeInteger(data.expires_in) || data.expires_in <= 0) throw Error("WECHAT_STUDENT_INVALID_RESPONSE");
      cached = { value: data.access_token, until: now() + Math.max(0, data.expires_in - 120) * 1000 };
      return cached.value;
    })().finally(() => { pending = undefined; });
    return pending;
  }
  return async function checkStudent(code: string, openId: string): Promise<WeChatStudentResult> {
    if (!appId || !secret) throw Error("WECHAT_MINIPROGRAM_NOT_CONFIGURED");
    if (!code || code.length > 1024 || /[\s\u0000-\u001f\u007f]/.test(code) || !openId) throw Error("WECHAT_STUDENT_CODE_INVALID");
    const parsed = resultSchema.safeParse(await post("/intp/quickcheckstudentidentity", { openid: openId, wx_studentcheck_code: code }, await accessToken()));
    if (!parsed.success) throw Error("WECHAT_STUDENT_INVALID_RESPONSE");
    return { bindStatus: parsed.data.bind_status, isStudent: parsed.data.bind_status === 3 && parsed.data.is_student };
  };
}
export const quickCheckWeChatStudent = createWeChatStudentProvider();

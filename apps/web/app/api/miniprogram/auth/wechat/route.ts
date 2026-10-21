import { NextResponse } from "next/server";
import { z } from "zod";
import { createSessionToken, persistSessionToken } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import { hasCurrentPrivacyConsent, PRIVACY_POLICY_CONSENT_VERSION } from "@/lib/privacy-policy";
import { exchangeWeChatLoginCode } from "@/lib/providers/wechat-miniprogram";
import { recordAuthLoginSuccess } from "@/lib/services/auth-audit-service";
import {
  assertWeChatLoginAllowed,
  getClientIp,
  recordWeChatLoginFailure,
} from "@/lib/services/login-attempt-service";
import { resolveWeChatUser } from "@/lib/services/wechat-auth-service";

const inputSchema = z.object({
  code: z.string().trim().min(1).max(256),
  crossBorderConsent: z.literal(true),
  privacyConsentVersion: z.literal(PRIVACY_POLICY_CONSENT_VERSION),
  miniProgramPrivacyVersion: z.enum(["miniapp-privacy-20260916", "miniapp-privacy-20260916-phone", "miniapp-privacy-20261013-contact", "community-miniapp-privacy-v1"]),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!hasCurrentPrivacyConsent(body)) {
    return noStoreJson({ ok: false, error: "PRIVACY_CONSENT_REQUIRED" }, 400);
  }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return noStoreJson({ ok: false, error: "INVALID_WECHAT_LOGIN_REQUEST" }, 400);
  }
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return noStoreJson({ ok: false, error: "MINIPROGRAM_AUTH_REQUIRES_PRISMA" }, 503);
  }

  const attemptMeta = {
    ip: getClientIp(request.headers),
    userAgent: request.headers.get("user-agent") ?? undefined,
  };

  try {
    await assertWeChatLoginAllowed(attemptMeta);
    const identity = await exchangeWeChatLoginCode(parsed.data.code);
    const user = await resolveWeChatUser(identity);
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await persistSessionToken(token, expiresAt, {
      userId: user.id,
      role: user.role,
      ...(user.phone ? { phone: user.phone } : {}),
    }, attemptMeta);
    await recordAuthLoginSuccess({
      crossBorderConsent: parsed.data.crossBorderConsent,
      ip: attemptMeta.ip,
      method: "wechat",
      phone: user.phone ?? undefined,
      privacyConsentVersion: parsed.data.privacyConsentVersion,
      miniProgramPrivacyVersion: parsed.data.miniProgramPrivacyVersion,
      role: user.role,
      userAgent: attemptMeta.userAgent,
      userId: user.id,
    });

    return noStoreJson({
      ok: true,
      session: {
        accessToken: token,
        expiresAt: expiresAt.toISOString(),
        tokenType: "Bearer",
      },
      user,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WECHAT_LOGIN_FAILED";
    if (message !== "WECHAT_LOGIN_RATE_LIMITED") {
      await recordWeChatLoginFailure({ ...attemptMeta, reason: message }).catch(() => null);
    }
    if (message === "WECHAT_LOGIN_RATE_LIMITED" || message === "WECHAT_LOGIN_FREQUENCY_LIMITED") {
      return noStoreJson({ ok: false, error: message, retryAfterSeconds: 15 * 60 }, 429);
    }
    if (message === "USER_DISABLED") return noStoreJson({ ok: false, error: message }, 403);
    if (message === "WECHAT_MINIPROGRAM_NOT_CONFIGURED") {
      return noStoreJson({ ok: false, error: message }, 503);
    }
    if (message === "WECHAT_CODE_EXCHANGE_UNAVAILABLE") {
      return noStoreJson({ ok: false, error: message }, 502);
    }
    return noStoreJson({ ok: false, error: safeLoginError(message) }, 400);
  }
}

function safeLoginError(message: string) {
  const allowed = new Set([
    "WECHAT_CODE_EXCHANGE_FAILED",
    "WECHAT_CODE_EXCHANGE_INVALID_RESPONSE",
    "WECHAT_LOGIN_CODE_INVALID",
  ]);
  return allowed.has(message) ? message : "WECHAT_LOGIN_FAILED";
}

function noStoreJson(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

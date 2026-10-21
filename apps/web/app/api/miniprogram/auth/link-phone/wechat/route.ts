import { NextResponse } from "next/server";
import { z } from "zod";
import { createSessionToken, deleteSessionToken, persistSessionToken, readBearerToken, readBearerUserSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { hasCurrentPrivacyConsent, PRIVACY_POLICY_CONSENT_VERSION } from "@/lib/privacy-policy";
import { exchangeWeChatPhoneCode } from "@/lib/providers/wechat-phone";
import { getWeChatOpenIdForUser, linkWeChatUserToPhone } from "@/lib/services/wechat-auth-service";
import { assertWeChatLoginAllowed, getClientIp, recordWeChatLoginFailure } from "@/lib/services/login-attempt-service";

const schema = z.object({ code: z.string().trim().min(1).max(256), crossBorderConsent: z.literal(true),
  privacyConsentVersion: z.literal(PRIVACY_POLICY_CONSENT_VERSION),
  miniProgramPrivacyVersion: z.enum(["miniapp-privacy-20260916-phone", "miniapp-privacy-20261013-contact", "community-miniapp-privacy-v1"]) });
const safeErrors = new Set(["WECHAT_PHONE_NETWORK_UNAVAILABLE", "WECHAT_PHONE_INVALID_RESPONSE", "WECHAT_PHONE_CODE_INVALID",
  "WECHAT_PHONE_RATE_LIMITED", "WECHAT_PHONE_AUTHORIZATION_FAILED", "WECHAT_PHONE_REGION_UNSUPPORTED", "WECHAT_LOGIN_RATE_LIMITED",
  "WECHAT_IDENTITY_NOT_FOUND", "WECHAT_APP_IDENTITY_CONFLICT", "WECHAT_ACCOUNT_LINK_ROLE_FORBIDDEN", "ACCOUNT_MERGE_CART_LIMIT_EXCEEDED",
  "WECHAT_MINIPROGRAM_NOT_CONFIGURED", "WECHAT_PHONE_ALREADY_LINKED", "USER_DISABLED"]);
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const session = await readBearerUserSession(request);
  if (!session || session.role !== "customer") return reply({ ok: false, error: "AUTH_REQUIRED" }, 401);
  const body = await request.json().catch(() => null);
  if (!hasCurrentPrivacyConsent(body)) return reply({ ok: false, error: "PRIVACY_CONSENT_REQUIRED" }, 400);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return reply({ ok: false, error: "INVALID_WECHAT_PHONE_REQUEST" }, 400);
  const meta = { ip: getClientIp(request.headers), userAgent: request.headers.get("user-agent") ?? undefined };
  try {
    await assertWeChatLoginAllowed(meta);
    const existing = await prisma.user.findUnique({ where: { id: session.userId }, select: { phone: true } });
    if (existing?.phone) return reply({ ok: false, error: "WECHAT_PHONE_ALREADY_LINKED" }, 409);
    const appId = appConfig.WECHAT_MINIPROGRAM_APP_ID;
    if (!appId) throw new Error("WECHAT_MINIPROGRAM_NOT_CONFIGURED");
    const openId = await getWeChatOpenIdForUser(session.userId, appId);
    if (!openId) throw new Error("WECHAT_IDENTITY_NOT_FOUND");
    const phone = await exchangeWeChatPhoneCode(parsed.data.code, openId);
    const user = await linkWeChatUserToPhone(session.userId, phone, { requireUnbound: true });
    const accessToken = createSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await persistSessionToken(accessToken, expiresAt, { userId: user.id, phone: user.phone ?? undefined, role: "customer" }, meta);
    await deleteSessionToken(readBearerToken(request));
    await prisma.auditLog.create({ data: { actorId: user.id, actorType: "user", action: "wechat_identity.phone_authorized",
      targetType: "user", targetId: user.id, detail: { miniProgramPrivacyVersion: parsed.data.miniProgramPrivacyVersion,
        privacyConsentVersion: parsed.data.privacyConsentVersion, crossBorderConsent: true } } });
    return reply({ ok: true, session: { accessToken, expiresAt: expiresAt.toISOString() }, user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    await recordWeChatLoginFailure({ ...meta, reason: safeErrors.has(message) ? message : "WECHAT_PHONE_LINK_FAILED" }).catch(() => null);
    const status = message.includes("RATE_LIMITED") ? 429 : message === "WECHAT_PHONE_NETWORK_UNAVAILABLE" ? 502 : 400;
    return reply({ ok: false, error: safeErrors.has(message) ? message : "WECHAT_PHONE_LINK_FAILED" }, status);
  }
}

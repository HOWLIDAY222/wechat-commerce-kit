import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { appConfig } from "@/lib/config";
import { createSessionToken, hashToken, sessionCookieName, setSessionCookie } from "@/lib/auth/session";
import { verifyCustomerPasswordLogin } from "@/lib/services/password-auth-service";
import { cartCookieName, resolveCartKey } from "@/lib/services/cart-service";
import { recordAuthLoginSuccess } from "@/lib/services/auth-audit-service";
import { verifyHumanChallenge } from "@/lib/services/human-verification-service";
import {
  assertPasswordLoginAllowed,
  clearPasswordLoginFailures,
  getClientIp,
  recordPasswordLoginFailure,
} from "@/lib/services/login-attempt-service";
import { hasCurrentPrivacyConsent, PRIVACY_POLICY_CONSENT_VERSION } from "@/lib/privacy-policy";

const inputSchema = z.object({
  crossBorderConsent: z.literal(true),
  humanAnswer: z.string().max(16).optional(),
  humanChallengeId: z.string().optional(),
  phone: z.string(),
  password: z.string().min(8).max(72),
  privacyConsentVersion: z.literal(PRIVACY_POLICY_CONSENT_VERSION),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!hasCurrentPrivacyConsent(body)) {
    return NextResponse.json({ ok: false, error: "PRIVACY_CONSENT_REQUIRED" }, { status: 400 });
  }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_PASSWORD_LOGIN_REQUEST" }, { status: 400 });
  }

  const attemptMeta = {
    ip: getClientIp(request.headers),
    phone: parsed.data.phone,
    scope: "customer_password" as const,
    userAgent: request.headers.get("user-agent") ?? undefined,
  };

  try {
    verifyHumanChallenge({
      action: "customer_password",
      answer: parsed.data.humanAnswer,
      challengeId: parsed.data.humanChallengeId,
    });
    await assertPasswordLoginAllowed(attemptMeta);

    const user = await verifyCustomerPasswordLogin(parsed.data.phone, parsed.data.password);
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const sessionPayload = {
      userId: user.userId,
      phone: user.phone,
      role: user.role,
    };

    await setSessionCookie(token, expiresAt, sessionPayload);
    await recordAuthLoginSuccess({
      method: "password",
      phone: sessionPayload.phone,
      role: sessionPayload.role,
      userId: sessionPayload.userId,
      crossBorderConsent: parsed.data.crossBorderConsent,
      privacyConsentVersion: parsed.data.privacyConsentVersion,
    });
    await clearPasswordLoginFailures(attemptMeta);

    const store = await cookies();
    const userCartKey = await resolveCartKey(store.get(cartCookieName)?.value, sessionPayload.userId);
    store.set(cartCookieName, userCartKey, {
      httpOnly: true,
      sameSite: "lax",
      secure: appConfig.APP_BASE_URL.startsWith("https://"),
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    const response = NextResponse.json({
      ok: true,
      user: {
        id: sessionPayload.userId,
        phone: sessionPayload.phone,
        role: sessionPayload.role,
      },
      session: {
        tokenHashPreview: hashToken(token).slice(0, 10),
        expiresAt: expiresAt.toISOString(),
      },
    });
    response.cookies.set(sessionCookieName, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: appConfig.APP_BASE_URL.startsWith("https://"),
      path: "/",
      expires: expiresAt,
    });
    response.cookies.set(cartCookieName, userCartKey, {
      httpOnly: true,
      sameSite: "lax",
      secure: appConfig.APP_BASE_URL.startsWith("https://"),
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "PASSWORD_LOGIN_FAILED";
    if (message === "PASSWORD_LOGIN_RATE_LIMITED") {
      return NextResponse.json(
        { ok: false, error: message, retryAfterSeconds: 15 * 60 },
        { status: 429 },
      );
    }
    if (!message.startsWith("HUMAN_VERIFICATION_")) {
      await recordPasswordLoginFailure({ ...attemptMeta, reason: message });
    }
    return NextResponse.json(
      { ok: false, error: message.startsWith("HUMAN_VERIFICATION_") ? message : "PASSWORD_LOGIN_FAILED" },
      { status: 400 },
    );
  }
}

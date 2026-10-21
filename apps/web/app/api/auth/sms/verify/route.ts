import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { appConfig } from "@/lib/config";
import { createSessionToken, hashToken, sessionCookieName, setSessionCookie } from "@/lib/auth/session";
import { verifySmsCode } from "@/lib/providers/sms";
import { cartCookieName, resolveCartKey } from "@/lib/services/cart-service";
import { recordAuthLoginSuccess } from "@/lib/services/auth-audit-service";
import { hasCurrentPrivacyConsent, PRIVACY_POLICY_CONSENT_VERSION } from "@/lib/privacy-policy";

const inputSchema = z.object({
  crossBorderConsent: z.literal(true),
  phone: z.string(),
  code: z.string().regex(/^\d{6}$/),
  privacyConsentVersion: z.literal(PRIVACY_POLICY_CONSENT_VERSION),
  scene: z.enum(["login", "register", "checkout"]).default("login"),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!hasCurrentPrivacyConsent(body)) {
    return NextResponse.json({ ok: false, error: "PRIVACY_CONSENT_REQUIRED" }, { status: 400 });
  }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_SMS_VERIFY_REQUEST" }, { status: 400 });
  }

  const result = await verifySmsCode(parsed.data.phone, parsed.data.scene, parsed.data.code);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  try {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const sessionPayload = {
    userId: `mock-user-${result.phone}`,
    phone: result.phone,
    role: "customer" as const,
  };

  if (appConfig.COMMERCE_STORAGE === "prisma") {
    const { resolvePrismaSessionUser } = await import("@/lib/services/prisma-session-store");
    const resolvedUser = await resolvePrismaSessionUser(sessionPayload);
    sessionPayload.userId = resolvedUser.userId;
  }

  await setSessionCookie(token, expiresAt, sessionPayload);
  await recordAuthLoginSuccess({
    method: "sms",
    phone: result.phone,
    role: sessionPayload.role,
    userId: sessionPayload.userId,
    crossBorderConsent: parsed.data.crossBorderConsent,
    privacyConsentVersion: parsed.data.privacyConsentVersion,
  });

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
      phone: result.phone,
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
    if (error instanceof Error && error.message === "ACCOUNT_DISABLED") {
      return NextResponse.json({ ok: false, error: "ACCOUNT_DISABLED" }, { status: 403 });
    }
    throw error;
  }
}

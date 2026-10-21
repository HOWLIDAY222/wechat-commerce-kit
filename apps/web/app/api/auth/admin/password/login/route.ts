import { NextResponse } from "next/server";
import { z } from "zod";
import { appConfig } from "@/lib/config";
import { adminSessionCookieName, createSessionToken, hashToken, setAdminSessionCookie } from "@/lib/auth/session";
import { resolveAdminAuthTarget } from "@/lib/services/admin-auth-service";
import { recordAuthLoginSuccess } from "@/lib/services/auth-audit-service";
import { verifyHumanChallenge } from "@/lib/services/human-verification-service";
import {
  assertPasswordLoginAllowed,
  clearPasswordLoginFailures,
  getClientIp,
  recordPasswordLoginFailure,
} from "@/lib/services/login-attempt-service";
import { verifyPasswordForUser } from "@/lib/services/password-auth-service";

const inputSchema = z.object({
  humanAnswer: z.string().max(16).optional(),
  humanChallengeId: z.string().optional(),
  phone: z.string(),
  password: z.string().min(8).max(72),
});

export async function POST(request: Request) {
  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_ADMIN_PASSWORD_LOGIN_REQUEST" }, { status: 400 });
  }

  const attemptMeta = {
    ip: getClientIp(request.headers),
    phone: parsed.data.phone,
    scope: "admin_password" as const,
    userAgent: request.headers.get("user-agent") ?? undefined,
  };

  try {
    verifyHumanChallenge({
      action: "admin_password",
      answer: parsed.data.humanAnswer,
      challengeId: parsed.data.humanChallengeId,
    });
    await assertPasswordLoginAllowed(attemptMeta);

    const admin = await resolveAdminAuthTarget(parsed.data.phone);
    if (!admin) {
      await recordPasswordLoginFailure({ ...attemptMeta, reason: "ADMIN_PASSWORD_LOGIN_FAILED" });
      return NextResponse.json({ ok: false, error: "ADMIN_PASSWORD_LOGIN_FAILED" }, { status: 400 });
    }

    await verifyPasswordForUser(admin.userId, parsed.data.password);

    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
    await setAdminSessionCookie(token, expiresAt, {
      userId: admin.userId,
      phone: admin.phone,
      role: admin.role,
    });
    await recordAuthLoginSuccess({
      method: "password",
      phone: admin.phone,
      role: admin.role,
      userId: admin.userId,
    });
    await clearPasswordLoginFailures(attemptMeta);

    const response = NextResponse.json({
      ok: true,
      admin: {
        id: admin.userId,
        phone: admin.phone,
        role: admin.role,
      },
      session: {
        tokenHashPreview: hashToken(token).slice(0, 10),
        expiresAt: expiresAt.toISOString(),
      },
    });
    response.cookies.set(adminSessionCookieName, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: appConfig.APP_BASE_URL.startsWith("https://"),
      path: "/",
      expires: expiresAt,
    });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "ADMIN_PASSWORD_LOGIN_FAILED";
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
      { ok: false, error: message.startsWith("HUMAN_VERIFICATION_") ? message : "ADMIN_PASSWORD_LOGIN_FAILED" },
      { status: 400 },
    );
  }
}

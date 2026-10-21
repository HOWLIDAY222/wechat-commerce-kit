import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createSessionToken,
  deleteSessionToken,
  persistSessionToken,
  readBearerToken,
  readBearerUserSession,
} from "@/lib/auth/session";
import { hasCurrentPrivacyConsent, PRIVACY_POLICY_CONSENT_VERSION } from "@/lib/privacy-policy";
import { verifySmsCode } from "@/lib/providers/sms";
import { getClientIp } from "@/lib/services/login-attempt-service";
import { linkWeChatUserToPhone } from "@/lib/services/wechat-auth-service";

const schema = z.object({
  code: z.string().regex(/^\d{6}$/),
  crossBorderConsent: z.literal(true),
  phone: z.string(),
  privacyConsentVersion: z.literal(PRIVACY_POLICY_CONSENT_VERSION),
});

export async function POST(request: Request) {
  const session = await readBearerUserSession(request);
  if (!session || session.role !== "customer") return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  if (!hasCurrentPrivacyConsent(body)) return NextResponse.json({ ok: false, error: "PRIVACY_CONSENT_REQUIRED" }, { status: 400 });
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_PHONE_LINK_VERIFY_REQUEST" }, { status: 400 });

  const verified = await verifySmsCode(parsed.data.phone, "login", parsed.data.code);
  if (!verified.ok) return NextResponse.json({ ok: false, error: verified.error }, { status: 400 });

  try {
    const user = await linkWeChatUserToPhone(session.userId, verified.phone);
    const accessToken = createSessionToken();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await persistSessionToken(accessToken, expiresAt, {
      userId: user.id,
      phone: user.phone ?? undefined,
      role: "customer",
    }, {
      ip: getClientIp(request.headers),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    await deleteSessionToken(readBearerToken(request));
    return NextResponse.json({
      ok: true,
      session: { accessToken, expiresAt: expiresAt.toISOString() },
      user,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "WECHAT_ACCOUNT_LINK_FAILED" },
      { status: 400 },
    );
  }
}

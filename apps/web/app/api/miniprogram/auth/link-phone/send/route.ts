import { NextResponse } from "next/server";
import { z } from "zod";
import { readBearerUserSession } from "@/lib/auth/session";
import { hasCurrentPrivacyConsent, PRIVACY_POLICY_CONSENT_VERSION } from "@/lib/privacy-policy";
import { issueSmsCode } from "@/lib/providers/sms";
import { getClientIp } from "@/lib/services/login-attempt-service";

const schema = z.object({
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
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_PHONE_LINK_REQUEST" }, { status: 400 });
  try {
    const result = await issueSmsCode(parsed.data.phone, "login", {
      ip: getClientIp(request.headers),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({
      ok: true,
      phone: result.phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2"),
      expiresAt: result.expiresAt.toISOString(),
      devCode: result.devCode,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "SMS_SEND_FAILED" },
      { status: 400 },
    );
  }
}

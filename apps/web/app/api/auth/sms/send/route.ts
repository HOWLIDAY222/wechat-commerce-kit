import { NextResponse } from "next/server";
import { z } from "zod";
import { appConfig } from "@/lib/config";
import { issueSmsCode } from "@/lib/providers/sms";
import { getClientIp } from "@/lib/services/login-attempt-service";
import { verifyHumanChallenge } from "@/lib/services/human-verification-service";
import { hasCurrentPrivacyConsent, PRIVACY_POLICY_CONSENT_VERSION } from "@/lib/privacy-policy";

const inputSchema = z.object({
  crossBorderConsent: z.literal(true),
  humanAnswer: z.string().max(16).optional(),
  humanChallengeId: z.string().optional(),
  phone: z.string(),
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
    return NextResponse.json({ ok: false, error: "INVALID_SMS_REQUEST" }, { status: 400 });
  }

  try {
    verifyHumanChallenge({
      action: "customer_sms",
      answer: parsed.data.humanAnswer,
      challengeId: parsed.data.humanChallengeId,
    });

    const result = await issueSmsCode(parsed.data.phone, parsed.data.scene, {
      ip: getClientIp(request.headers),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json({
      ok: true,
      provider: result.provider,
      phone: result.phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2"),
      expiresAt: result.expiresAt.toISOString(),
      devCode: result.devCode,
      codeHashPreview: result.codeHash.slice(0, 8),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMS_SEND_FAILED";
    if (!message.startsWith("HUMAN_VERIFICATION_")) {
      console.error("auth.sms.send.failed", {
        error: message,
        phone: maskPhone(parsed.data.phone),
        scene: parsed.data.scene,
        provider: appConfig.SMS_PROVIDER,
      });
    }

    return NextResponse.json(
      { ok: false, error: message, retryAfterSeconds: getRetryAfterSeconds(error) },
      { status: 400 },
    );
  }
}

function maskPhone(phone: string) {
  return phone.replace(/\D/g, "").replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}

function getRetryAfterSeconds(error: unknown) {
  const retryAfterSeconds = (error as { retryAfterSeconds?: unknown })?.retryAfterSeconds;
  return typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds)
    ? Math.max(1, Math.ceil(retryAfterSeconds))
    : undefined;
}

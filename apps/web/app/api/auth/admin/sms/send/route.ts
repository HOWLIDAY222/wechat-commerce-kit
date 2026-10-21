import { NextResponse } from "next/server";
import { z } from "zod";
import { appConfig } from "@/lib/config";
import { issueSmsCode } from "@/lib/providers/sms";
import { maskPhone, resolveAdminAuthTarget } from "@/lib/services/admin-auth-service";
import { verifyHumanChallenge } from "@/lib/services/human-verification-service";
import { getClientIp } from "@/lib/services/login-attempt-service";

const inputSchema = z.object({
  humanAnswer: z.string().max(16).optional(),
  humanChallengeId: z.string().optional(),
  phone: z.string(),
});

export async function POST(request: Request) {
  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_ADMIN_SMS_REQUEST" }, { status: 400 });
  }

  try {
    verifyHumanChallenge({
      action: "admin_sms",
      answer: parsed.data.humanAnswer,
      challengeId: parsed.data.humanChallengeId,
    });

    const admin = await resolveAdminAuthTarget(parsed.data.phone);
    if (!admin) {
      console.warn("auth.admin.sms.send.unauthorized_phone_suppressed", {
        phone: maskPhone(parsed.data.phone),
      });
      return NextResponse.json({
        ok: true,
        provider: appConfig.SMS_PROVIDER,
        phone: maskPhone(parsed.data.phone),
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
    }

    const result = await issueSmsCode(admin.phone, "login", {
      ip: getClientIp(request.headers),
      userAgent: request.headers.get("user-agent") ?? undefined,
    });

    return NextResponse.json({
      ok: true,
      provider: result.provider,
      phone: maskPhone(admin.phone),
      expiresAt: result.expiresAt.toISOString(),
      devCode: result.devCode,
      codeHashPreview: result.codeHash.slice(0, 8),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ADMIN_SMS_SEND_FAILED";
    if (!message.startsWith("HUMAN_VERIFICATION_")) {
      console.error("auth.admin.sms.send.failed", {
        error: message,
        phone: maskPhone(parsed.data.phone),
        provider: appConfig.SMS_PROVIDER,
      });
    }

    return NextResponse.json(
      { ok: false, error: message, retryAfterSeconds: getRetryAfterSeconds(error) },
      { status: 400 },
    );
  }
}

function getRetryAfterSeconds(error: unknown) {
  const retryAfterSeconds = (error as { retryAfterSeconds?: unknown })?.retryAfterSeconds;
  return typeof retryAfterSeconds === "number" && Number.isFinite(retryAfterSeconds)
    ? Math.max(1, Math.ceil(retryAfterSeconds))
    : undefined;
}

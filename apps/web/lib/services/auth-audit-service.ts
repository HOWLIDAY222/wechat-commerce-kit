import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { writeRuntimeAudit } from "@/lib/services/admin-ops-service";
import type { SessionRole } from "@/lib/auth/session";

type AuthActorType = "user" | "admin";

type AuthAuditInput = {
  crossBorderConsent?: boolean;
  ip?: string;
  method: "sms" | "password" | "wechat";
  phone?: string;
  privacyConsentVersion?: string;
  miniProgramPrivacyVersion?: string;
  role: SessionRole;
  userAgent?: string;
  userId: string;
};

export async function recordAuthLoginSuccess({ crossBorderConsent, ip, method, phone, privacyConsentVersion, miniProgramPrivacyVersion, role, userAgent, userId }: AuthAuditInput) {
  const actorType = toActorType(role);
  const action = actorType === "admin" ? "auth.admin.login" : "auth.user.login";
  const phoneMasked = maskPhone(phone);
  const detail = {
    method,
    role,
    ...(phoneMasked ? { phoneMasked } : {}),
    ...(privacyConsentVersion ? { privacyConsentVersion } : {}),
    ...(miniProgramPrivacyVersion ? { miniProgramPrivacyVersion } : {}),
    ...(crossBorderConsent === true ? { crossBorderConsent: true } : {}),
  };

  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    writeRuntimeAudit({
      actorId: userId,
      actorType,
      action,
      targetType: "user",
      targetId: userId,
      detail,
    });
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.loginLog.create({
      data: {
        userId,
        phone,
        ip,
        userAgent,
        success: true,
        failureReason: null,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorType,
        action,
        targetType: "user",
        targetId: userId,
        detail,
      },
    });
  });
}

export function toActorType(role: SessionRole): AuthActorType {
  return role === "customer" ? "user" : "admin";
}

export function maskPhone(phone: string | null | undefined) {
  if (!phone) return undefined;
  const normalized = phone.replace(/\D/g, "");
  if (normalized.length < 7) return "***";
  return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
}

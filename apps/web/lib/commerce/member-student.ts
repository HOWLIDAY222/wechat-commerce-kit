import { z } from "zod";
export const studentValidityDays = 180;
export const studentConsentVersion = "wechat-student-20261019";
export const studentTestIdentitiesKey = "wechatStudentTestIdentities";
export const studentVerification = { provider: "WECHAT", status: "READY", available: true } as const;
export const studentVerificationUnavailable = () => Error("MEMBER_STUDENT_VERIFICATION_UNAVAILABLE");
export const studentVerificationInputSchema = z.object({ code: z.string().min(1).max(1024).refine(value => !/[\s\u0000-\u001f\u007f]/.test(value)), requestId: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/), consentVersion: z.literal(studentConsentVersion) }).strict();
export function isTrustedStudentCertification(payload: Record<string, unknown>) {
  return payload.verificationProvider === "WECHAT" && payload.proofVersion === "wechat-student-v1" && payload.bindStatus === 3 && payload.isStudent === true
    && payload.testIdentity === false && typeof payload.identityHash === "string" && /^[a-f0-9]{64}$/.test(payload.identityHash)
    && typeof payload.cycleId === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(payload.cycleId);
}
export function studentCertification(payload: Record<string, unknown>, fallback: Date, now = new Date()) {
  const approvedAt = typeof payload.approvedAt === "string" ? new Date(payload.approvedAt) : fallback;
  const validUntil = typeof payload.validUntil === "string" ? new Date(payload.validUntil) : new Date(approvedAt.getTime() + studentValidityDays * 86_400_000);
  const valid = isTrustedStudentCertification(payload) && Number.isFinite(approvedAt.getTime()) && Number.isFinite(validUntil.getTime()) && approvedAt <= now && validUntil > now
    && validUntil.getTime() <= approvedAt.getTime() + studentValidityDays * 86_400_000;
  return { approvedAt: Number.isFinite(approvedAt.getTime()) ? approvedAt.toISOString() : "", validUntil: Number.isFinite(validUntil.getTime()) ? validUntil.toISOString() : "", valid, cycleId: typeof payload.cycleId === "string" ? payload.cycleId : "" };
}

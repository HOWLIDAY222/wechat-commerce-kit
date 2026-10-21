import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";
import { FIT_CONSENT_VERSION, type FitProfile, type FitValues } from "@/lib/fit-guide";

type FitRow = { height_cm: unknown; weight_kg: unknown; waist_cm: unknown; preference: "regular" | "relaxed"; consent_at: Date; revision: number; updated_at: Date };
function mapRow(row: FitRow): FitProfile {
  return { heightCm: row.height_cm === null ? null : Number(row.height_cm), weightKg: row.weight_kg === null ? null : Number(row.weight_kg), waistCm: row.waist_cm === null ? null : Number(row.waist_cm), preference: row.preference, revision: row.revision, updatedAt: row.updated_at.toISOString(), consentAt: row.consent_at.toISOString() };
}
export async function getFitProfile(userId: string) {
  const rows = await prisma.$queryRaw<FitRow[]>`SELECT height_cm,weight_kg,waist_cm,preference,consent_at,revision,updated_at FROM customer_fit_profiles WHERE user_id=${userId}`;
  return rows[0] ? mapRow(rows[0]) : null;
}
export async function saveFitProfile(userId: string, values: FitValues, revision: number) {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<FitRow[]>`
      WITH updated AS (
        UPDATE customer_fit_profiles SET height_cm=${values.heightCm}::numeric,weight_kg=${values.weightKg}::numeric,waist_cm=${values.waistCm}::numeric,
          preference=${values.preference},consent_at=now(),consent_version=${FIT_CONSENT_VERSION},revision=revision+1,updated_at=now()
        WHERE user_id=${userId} AND revision=${revision} RETURNING *
      ), inserted AS (
        INSERT INTO customer_fit_profiles(user_id,height_cm,weight_kg,waist_cm,preference,consent_at,consent_version)
        SELECT ${userId},${values.heightCm}::numeric,${values.weightKg}::numeric,${values.waistCm}::numeric,${values.preference},now(),${FIT_CONSENT_VERSION}
        WHERE ${revision}=0 ON CONFLICT(user_id) DO NOTHING RETURNING *
      ) SELECT * FROM updated UNION ALL SELECT * FROM inserted`;
    if (!rows[0]) throw Error("FIT_PROFILE_CONFLICT");
    await tx.privacyConsent.create({ data: { userId, category: "PERSONALIZATION", granted: true, policyVersion: FIT_CONSENT_VERSION, source: "fit-profile" } });
    await tx.auditLog.create({ data: { actorId: userId, actorType: "user", action: "account.fit-profile.saved", targetType: "user", targetId: userId, detail: { revision: rows[0].revision } } });
    return mapRow(rows[0]);
  });
}
export async function deleteFitProfile(userId: string, revision: number) {
  await prisma.$transaction(async tx => {
    const rows=await tx.$queryRaw<Array<{user_id:string}>>`DELETE FROM customer_fit_profiles WHERE user_id=${userId} AND revision=${revision} RETURNING user_id`;
    if (!rows.length) {
      const current=await tx.$queryRaw<Array<{revision:number}>>`SELECT revision FROM customer_fit_profiles WHERE user_id=${userId}`;
      if(current.length)throw Error("FIT_PROFILE_CONFLICT");
    }
    await tx.privacyConsent.create({ data: { userId, category: "PERSONALIZATION", granted: false, withdrawnAt: new Date(), policyVersion: FIT_CONSENT_VERSION, source: "fit-profile" } });
    await tx.auditLog.create({ data: { actorId: userId, actorType: "user", action: "account.fit-profile.deleted", targetType: "user", targetId: userId, detail: { deleted: rows.length > 0 } } });
  });
}

// The verified existing brand account remains canonical when accounts are linked.
export async function mergeFitProfiles(tx: Prisma.TransactionClient, sourceUserId: string, targetUserId: string) {
  await tx.$executeRaw`INSERT INTO customer_fit_profiles(user_id,height_cm,weight_kg,waist_cm,preference,consent_at,consent_version,revision,updated_at)
    SELECT ${targetUserId},height_cm,weight_kg,waist_cm,preference,consent_at,consent_version,revision,updated_at
    FROM customer_fit_profiles WHERE user_id=${sourceUserId} ON CONFLICT(user_id) DO NOTHING`;
  await tx.$executeRaw`DELETE FROM customer_fit_profiles WHERE user_id=${sourceUserId}`;
}

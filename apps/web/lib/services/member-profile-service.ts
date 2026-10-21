import type { Prisma } from "@prisma/client";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { isMainlandPhone, normalizeMainlandPhone } from "@/lib/providers/sms";
import { memberProfileDto, parseMemberProfileInput, type MemberProfileInput, type MemberProfileRecord } from "@/lib/commerce/member-profile";

type Reader = Pick<Prisma.TransactionClient, "$queryRaw">;
async function assertStorageReady() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") throw Error("MEMBER_PROFILE_UNAVAILABLE");
  const rows = await prisma.$queryRaw<Array<{ name: string | null }>>`SELECT to_regclass('public.member_account_profiles')::text AS name`;
  if (!rows[0]?.name) throw Error("MEMBER_PROFILE_UNAVAILABLE");
}
async function readProfile(userId: string, reader: Reader = prisma) {
  const rows = await reader.$queryRaw<MemberProfileRecord[]>`SELECT surname, given_name AS "givenName", display_name AS "displayName", gender, region,
    to_char(birthday, 'YYYY-MM-DD') AS birthday, registered_at AT TIME ZONE 'UTC' AS "registeredAt", updated_at AT TIME ZONE 'UTC' AS "updatedAt", revision
    FROM member_account_profiles WHERE user_id = ${userId}`;
  return rows[0] ?? null;
}
function accountPhone(phone: string | null) {
  const normalized = phone ? normalizeMainlandPhone(phone) : "";
  return isMainlandPhone(normalized) ? normalized : null;
}
function response(profile: MemberProfileRecord | null, phone: string | null) {
  const bound = accountPhone(phone);
  return { profile: memberProfileDto(profile), accountPhone: bound, canCompleteRegistration: !!bound, canEdit: !!bound };
}
export async function getMemberAccountProfile(userId: string) {
  await assertStorageReady();
  const user = await prisma.user.findFirst({ where: { id: userId, status: "ACTIVE" }, select: { phone: true } });
  if (!user) throw Error("ACCOUNT_NOT_FOUND");
  // A GET never creates a metadata row or borrows legacy profile values.
  return response(await readProfile(userId), user.phone);
}
export async function getAdminMemberAccountProfile(userId: string, actorId: string) {
  await assertStorageReady();
  const actor = await prisma.user.findFirst({ where: { id: actorId, status: "ACTIVE", role: { in: ["ADMIN", "OWNER"] } }, select: { id: true } });
  if (!actor) throw Error("ADMIN_REQUIRED");
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
  if (!user) throw Error("ACCOUNT_NOT_FOUND");
  return { ...response(await readProfile(userId), user.phone), canEdit: false };
}
export async function saveMemberAccountProfile(userId: string, value: MemberProfileInput) {
  const input = parseMemberProfileInput(value);
  if (!input) throw Error("INVALID_MEMBER_PROFILE");
  await assertStorageReady();
  return prisma.$transaction(async tx => {
    const user = await tx.user.findFirst({ where: { id: userId, status: "ACTIVE" }, select: { phone: true } });
    if (!user) throw Error("ACCOUNT_NOT_FOUND");
    // Require the existing bound account before storing metadata: the existing
    // phone-link merge moves commerce data and must not be changed for this UI.
    if (!accountPhone(user.phone)) throw Error("MEMBER_PROFILE_PHONE_REQUIRED");
    const before = await readProfile(userId, tx);
    if ((before?.revision ?? 0) !== input.expectedRevision) throw Error("MEMBER_PROFILE_REVISION_CONFLICT");
    const registeredAt = before?.registeredAt?.toISOString() ?? (input.completeRegistration ? new Date().toISOString() : null);
    const regionJson = JSON.stringify(input.region);
    let rows: MemberProfileRecord[];
    if (input.expectedRevision === 0) {
      rows = await tx.$queryRaw<MemberProfileRecord[]>`INSERT INTO member_account_profiles
        (user_id, surname, given_name, display_name, gender, region, birthday, registered_at, revision)
        VALUES (${userId}, ${input.surname}, ${input.givenName}, ${input.displayName}, ${input.gender}, ${regionJson}::jsonb, ${input.birthday}::date, ${registeredAt}::timestamptz, 1)
        ON CONFLICT (user_id) DO NOTHING
        RETURNING surname, given_name AS "givenName", display_name AS "displayName", gender, region, to_char(birthday, 'YYYY-MM-DD') AS birthday,
          registered_at AT TIME ZONE 'UTC' AS "registeredAt", updated_at AT TIME ZONE 'UTC' AS "updatedAt", revision`;
    } else {
      rows = await tx.$queryRaw<MemberProfileRecord[]>`UPDATE member_account_profiles SET surname = ${input.surname}, given_name = ${input.givenName}, display_name = ${input.displayName},
        gender = ${input.gender}, region = ${regionJson}::jsonb, birthday = ${input.birthday}::date, registered_at = ${registeredAt}::timestamptz, revision = revision + 1, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ${userId} AND revision = ${input.expectedRevision}
        RETURNING surname, given_name AS "givenName", display_name AS "displayName", gender, region, to_char(birthday, 'YYYY-MM-DD') AS birthday,
          registered_at AT TIME ZONE 'UTC' AS "registeredAt", updated_at AT TIME ZONE 'UTC' AS "updatedAt", revision`;
    }
    const after = rows[0];
    if (!after) throw Error("MEMBER_PROFILE_REVISION_CONFLICT");
    // Audit only changed field names; never copy birthday, phone or profile text.
    await tx.auditLog.create({ data: { actorId: userId, actorType: "user", action: "member.profile.updated", targetType: "user", targetId: userId,
      detail: { beforeRevision: before?.revision ?? 0, revision: after.revision, completedRegistration: !before?.registeredAt && !!after.registeredAt,
        fields: ["surname", "givenName", "displayName", "gender", "region", "birthday"] } } });
    return response(after, user.phone);
  }, { maxWait: 5_000, timeout: 10_000 });
}

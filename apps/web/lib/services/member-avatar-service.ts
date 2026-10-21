import type { Prisma } from "@prisma/client";
import { join, relative, resolve, sep } from "node:path";
import { prisma } from "@/lib/db/prisma";
import { appConfig } from "@/lib/config";
import { isMainlandPhone, normalizeMainlandPhone } from "@/lib/providers/sms";
import { createMemberAvatarStore, type AvatarWriter } from "@/lib/commerce/member-avatar-store";
import type { MemberAvatarRecord } from "@/lib/commerce/member-avatar";

type Reader = Pick<Prisma.TransactionClient, "$queryRaw" | "user">;
async function ready() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") throw Error("MEMBER_AVATAR_UNAVAILABLE");
  const rows = await prisma.$queryRaw<Array<{ name: string | null }>>`SELECT to_regclass('public.member_account_avatars')::text AS name`;
  if (!rows[0]?.name) throw Error("MEMBER_AVATAR_UNAVAILABLE");
}
async function assertAccount(userId: string, editing: boolean, reader: Reader = prisma) {
  const user = await reader.user.findFirst({ where: { id: userId, status: "ACTIVE" }, select: { phone: true } });
  if (!user) throw Error("ACCOUNT_NOT_FOUND");
  if (editing && (!user.phone || !isMainlandPhone(normalizeMainlandPhone(user.phone)))) throw Error("MEMBER_PROFILE_PHONE_REQUIRED");
}
async function read(userId: string, reader: Reader = prisma) {
  const rows = await reader.$queryRaw<MemberAvatarRecord[]>`SELECT filename, revision, updated_at AT TIME ZONE 'UTC' AS "updatedAt" FROM member_account_avatars WHERE user_id = ${userId}`;
  return rows[0] ?? null;
}
const publicRoot = resolve(process.cwd(), "public");
const candidateRoot = appConfig.MEMBER_PRIVATE_STORAGE_DIR ? resolve(appConfig.MEMBER_PRIVATE_STORAGE_DIR, "private-member-avatars") : resolve(appConfig.UPLOAD_DIR || join(publicRoot, "uploads"), "..", "private-member-avatars");
const publicRelative = relative(publicRoot, candidateRoot);
const privateRoot = publicRelative === "" || (!publicRelative.startsWith(".." + sep) && publicRelative !== "..") ? resolve(process.cwd(), ".private-member-avatars") : candidateRoot;
const store = createMemberAvatarStore({
  assertAccount, read,
  transaction: fn => prisma.$transaction(async tx => {
    const writer: AvatarWriter = {
      assertAccount: (userId, editing) => assertAccount(userId, editing, tx), read: userId => read(userId, tx),
      async compareAndSet(userId, revision, filename) {
        const rows = revision === 0 ? await tx.$queryRaw<MemberAvatarRecord[]>`INSERT INTO member_account_avatars(user_id,filename,revision) VALUES(${userId},${filename},1)
          ON CONFLICT(user_id) DO NOTHING RETURNING filename,revision,updated_at AT TIME ZONE 'UTC' AS "updatedAt"` :
          await tx.$queryRaw<MemberAvatarRecord[]>`UPDATE member_account_avatars SET filename=${filename},revision=revision+1,updated_at=CURRENT_TIMESTAMP
          WHERE user_id=${userId} AND revision=${revision} RETURNING filename,revision,updated_at AT TIME ZONE 'UTC' AS "updatedAt"`;
        return rows[0] ?? null;
      },
      async audit(userId, revision, removed) { await tx.auditLog.create({ data: { actorId: userId, actorType: "user", action: "member.avatar.updated", targetType: "user", targetId: userId, detail: { revision, removed } } }); },
    };
    return fn(writer);
  }, { maxWait: 5_000, timeout: 10_000 }),
}, privateRoot);

export async function getMemberAvatar(userId: string) { await ready(); return store.metadata(userId); }
export async function readMemberAvatar(userId: string) { await ready(); return store.read(userId); }
export async function uploadMemberAvatar(userId: string, revision: number, file: File) { await ready(); return store.upload(userId, revision, file); }
export async function removeMemberAvatar(userId: string, revision: number) { await ready(); return store.remove(userId, revision); }

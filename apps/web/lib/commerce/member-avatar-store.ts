import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalizeUploadedImage } from "@/lib/uploads/image";
import { memberAvatarDto, parseAvatarRevision, safeAvatarFilename, type MemberAvatarRecord } from "@/lib/commerce/member-avatar";

export type AvatarWriter = {
  assertAccount: (userId: string, editing: boolean) => Promise<void>;
  read: (userId: string) => Promise<MemberAvatarRecord | null>;
  compareAndSet: (userId: string, expectedRevision: number, filename: string | null) => Promise<MemberAvatarRecord | null>;
  audit: (userId: string, revision: number, removed: boolean) => Promise<void>;
};
export type AvatarRepository = Pick<AvatarWriter, "assertAccount" | "read"> & { transaction: <T>(fn: (writer: AvatarWriter) => Promise<T>) => Promise<T> };

// The private root is outside the public upload directory; filenames are never
// returned to the client. The bearer-authenticated endpoint always reads self.
export function createMemberAvatarStore(repository: AvatarRepository, root: string) {
  const deleteFile = async (filename: string | null) => { if (filename && safeAvatarFilename(filename)) await rm(join(root, filename), { force: true }).catch(() => undefined); };
  async function replace(userId: string, expectedRevision: number, filename: string | null) {
    if (parseAvatarRevision(expectedRevision) === null) throw Error("INVALID_MEMBER_AVATAR_REVISION");
    return repository.transaction(async writer => {
      await writer.assertAccount(userId, true);
      const before = await writer.read(userId);
      if ((before?.revision ?? 0) !== expectedRevision) throw Error("MEMBER_AVATAR_REVISION_CONFLICT");
      const after = await writer.compareAndSet(userId, expectedRevision, filename);
      if (!after) throw Error("MEMBER_AVATAR_REVISION_CONFLICT");
      await writer.audit(userId, after.revision, !filename);
      return { before, after };
    });
  }
  return {
    async metadata(userId: string) { await repository.assertAccount(userId, false); return memberAvatarDto(await repository.read(userId)); },
    async read(userId: string) {
      await repository.assertAccount(userId, false);
      const row = await repository.read(userId);
      if (!row?.filename || !safeAvatarFilename(row.filename)) throw Error("MEMBER_AVATAR_NOT_FOUND");
      try { return await readFile(join(root, row.filename)); } catch { throw Error("MEMBER_AVATAR_NOT_FOUND"); }
    },
    async upload(userId: string, expectedRevision: number, file: File) {
      if (parseAvatarRevision(expectedRevision) === null) throw Error("INVALID_MEMBER_AVATAR_REVISION");
      await repository.assertAccount(userId, true);
      const normalized = await normalizeUploadedImage(file, { maxBytes: 3 * 1024 * 1024, maxDimension: 512, maxPixels: 16_000_000 });
      const filename = randomUUID() + ".webp";
      await mkdir(root, { recursive: true });
      await writeFile(join(root, filename), normalized.buffer, { flag: "wx", mode: 0o600 });
      let changed;
      try { changed = await replace(userId, expectedRevision, filename); }
      catch (error) { await deleteFile(filename); throw error; }
      await deleteFile(changed.before?.filename ?? null);
      return memberAvatarDto(changed.after);
    },
    async remove(userId: string, expectedRevision: number) {
      const changed = await replace(userId, expectedRevision, null);
      await deleteFile(changed.before?.filename ?? null);
      return memberAvatarDto(changed.after);
    },
  };
}

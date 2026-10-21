import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { appConfig } from "@/lib/config";
import { normalizeUploadedImage } from "@/lib/uploads/image";
import { normalizeMainlandPhone, isMainlandPhone } from "@/lib/providers/sms";
import { memberOperationsConfigSchema, defaultMemberOperationsConfig } from "@/lib/commerce/member-operations";
import { socialProofUrl } from "@/lib/commerce/member-social";
import { studentVerificationUnavailable } from "@/lib/commerce/member-student";

type Reader = Pick<Prisma.TransactionClient, "$queryRaw">;
type Proof = { id: string; userId: string; filename: string; checksum: string; applicationId: string | null };
export type MemberProofPurpose = "SOCIAL" | "STUDENT" | "ENTERPRISE";
const validId = (value: string) => /^msu_[a-f0-9]{32}$/.test(value);
const validFilename = (value: string) => /^[a-f0-9-]{36}\.webp$/.test(value);
const publicRoot = resolve(process.cwd(), "public");
const candidateRoot = appConfig.MEMBER_PRIVATE_STORAGE_DIR ? resolve(appConfig.MEMBER_PRIVATE_STORAGE_DIR, "private-member-social") : resolve(appConfig.UPLOAD_DIR || join(publicRoot, "uploads"), "..", "private-member-social");
const inPublic = relative(publicRoot, candidateRoot);
const root = inPublic === "" || (!inPublic.startsWith(".." + sep) && inPublic !== "..") ? resolve(process.cwd(), ".private-member-social") : candidateRoot;
const removeFile = async (filename: string) => { if (validFilename(filename)) await rm(join(root, filename), { force: true }).catch(() => undefined); };

export async function assertSocialProofStorage(reader: Reader = prisma) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") throw Error("MEMBER_OPERATIONS_PROOF_UNAVAILABLE");
  const rows = await reader.$queryRaw<Array<{ name: string | null }>>`SELECT to_regclass('public.member_social_uploads')::text AS name`;
  if (!rows[0]?.name) throw Error("MEMBER_OPERATIONS_PROOF_UNAVAILABLE");
}
async function assertUploadAccount(userId: string, tx: Prisma.TransactionClient, purpose: MemberProofPurpose) {
  const user = await tx.user.findFirst({ where: { id: userId, status: "ACTIVE", role: "CUSTOMER" }, select: { phone: true } });
  if (!user) throw Error("MEMBER_CUSTOMER_REQUIRED");
  if (!user.phone || !isMainlandPhone(normalizeMainlandPhone(user.phone))) throw Error("MEMBER_PHONE_REQUIRED");
  if (!await tx.memberProfile.findUnique({ where: { userId }, select: { id: true } })) throw Error("MEMBERSHIP_REQUIRED");
  const rows = await tx.$queryRaw<Array<{ config: unknown }>>`SELECT config FROM member_operation_settings WHERE id='member-operations'`;
  const config = rows[0] ? memberOperationsConfigSchema.safeParse(rows[0].config) : { success: true as const, data: defaultMemberOperationsConfig() };
  if (!config.success) throw Error("MEMBER_OPERATIONS_UNAVAILABLE");
  if (purpose === "STUDENT") { if (!config.data.tasks.STUDENT.enabled) throw Error("MEMBER_OPERATIONS_DISABLED"); }
  else if (purpose === "ENTERPRISE") { if (!config.data.tasks.ENTERPRISE.enabled || !config.data.enterpriseContact.enabled) throw Error("MEMBER_OPERATIONS_DISABLED"); }
  else if (!config.data.social.enabled && !(config.data.xiaohongshuAccount.enabled && config.data.tasks.XIAOHONGSHU_FOLLOW.enabled)) throw Error("MEMBER_OPERATIONS_DISABLED");
}
export async function uploadSocialProof(userId: string, requestId: string, file: File, purpose: MemberProofPurpose = "SOCIAL") {
  if (purpose === "STUDENT") throw studentVerificationUnavailable();
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(requestId)) throw Error("INVALID_MEMBER_OPERATION");
  if (!["SOCIAL", "STUDENT", "ENTERPRISE"].includes(purpose)) throw Error("INVALID_MEMBER_OPERATION");
  await assertSocialProofStorage();
  // Normalize from actual bytes; reject disguised SVG/HTML and excessive pixels.
  const normalized = await normalizeUploadedImage(file, { maxBytes: 3 * 1024 * 1024, maxDimension: 1600, maxPixels: 16_000_000 });
  const filename = randomUUID() + ".webp", id = "msu_" + randomBytes(16).toString("hex");
  await mkdir(root, { recursive: true, mode: 0o700 }); await writeFile(join(root, filename), normalized.buffer, { flag: "wx", mode: 0o600 });
  let outcome: { proof: { id: string; url: string }; unused: string[] };
  try {
    outcome = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"member-operations:" + userId}))`;
      await assertUploadAccount(userId, tx, purpose);
      const existing = await tx.$queryRaw<Array<Proof & { purpose: string }>>`SELECT id,user_id AS "userId",filename,checksum,application_id AS "applicationId",purpose FROM member_social_uploads WHERE user_id=${userId} AND request_id=${requestId}`;
      if (existing[0]) {
        if (existing[0].checksum !== normalized.checksum || existing[0].purpose !== purpose) throw Error("MEMBER_OPERATIONS_REQUEST_CHANGED");
        return { proof: { id: existing[0].id, url: socialProofUrl(existing[0].id) }, unused: [filename] };
      }
      const counts = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM audit_logs WHERE actor_id=${userId} AND action='member.social.proof.uploaded' AND created_at > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - INTERVAL '1 minute'`;
      if (Number(counts[0]?.count ?? 0) >= 15) throw Error("MEMBER_OPERATIONS_RATE_LIMITED");
      const expired = await tx.$queryRaw<Array<{ filename: string }>>`DELETE FROM member_social_uploads WHERE user_id=${userId} AND application_id IS NULL AND created_at < CURRENT_TIMESTAMP - INTERVAL '7 days' RETURNING filename`;
      const pending = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM member_social_uploads WHERE user_id=${userId} AND application_id IS NULL`;
      if (Number(pending[0]?.count ?? 0) >= 12) throw Error("MEMBER_OPERATIONS_PROOF_LIMIT");
      await tx.$executeRaw`INSERT INTO member_social_uploads(id,user_id,request_id,filename,checksum,size_bytes,purpose) VALUES(${id},${userId},${requestId},${filename},${normalized.checksum},${normalized.sizeBytes},${purpose})`;
      await tx.auditLog.create({ data: { actorId: userId, actorType: "user", action: "member.social.proof.uploaded", targetType: "member-social-proof", targetId: id, detail: { sizeBytes: normalized.sizeBytes } } });
      return { proof: { id, url: socialProofUrl(id) }, unused: expired.map(row => row.filename) };
    }, { maxWait: 5_000, timeout: 15_000 });
  } catch (error) { await removeFile(filename); throw error; }
  await Promise.all(outcome.unused.map(removeFile)); return outcome.proof;
}
export async function readSocialProof(actorId: string, id: string) {
  if (!validId(id)) throw Error("MEMBER_OPERATIONS_PROOF_NOT_FOUND");
  await assertSocialProofStorage();
  const actor = await prisma.user.findFirst({ where: { id: actorId, status: "ACTIVE" }, select: { role: true } });
  if (!actor) throw Error("MEMBER_OPERATIONS_PROOF_NOT_FOUND");
  const rows = await prisma.$queryRaw<Proof[]>`SELECT id,user_id AS "userId",filename,checksum,application_id AS "applicationId" FROM member_social_uploads WHERE id=${id}`;
  const proof = rows[0];
  if (!proof || !validFilename(proof.filename) || proof.userId !== actorId && !["ADMIN", "OWNER"].includes(actor.role)) throw Error("MEMBER_OPERATIONS_PROOF_NOT_FOUND");
  try { return await readFile(join(root, proof.filename)); } catch { throw Error("MEMBER_OPERATIONS_PROOF_NOT_FOUND"); }
}
export async function deleteSocialProof(userId: string, id: string) {
  if (!validId(id)) throw Error("MEMBER_OPERATIONS_PROOF_NOT_FOUND");
  await assertSocialProofStorage();
  const removed = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"member-operations:" + userId}))`;
    const user = await tx.user.findFirst({ where: { id: userId, status: "ACTIVE" }, select: { id: true } });
    if (!user) throw Error("MEMBER_OPERATIONS_PROOF_NOT_FOUND");
    const rows = await tx.$queryRaw<Array<{ filename: string }>>`DELETE FROM member_social_uploads WHERE id=${id} AND user_id=${userId} AND application_id IS NULL RETURNING filename`;
    if (!rows[0]) throw Error("MEMBER_OPERATIONS_PROOF_NOT_FOUND"); return rows[0].filename;
  });
  await removeFile(removed); return { removed: true };
}
export async function bindSocialProofs(tx: Prisma.TransactionClient, userId: string, applicationId: string, ids: string[], purpose: MemberProofPurpose = "SOCIAL") {
  if (!ids.length) return;
  await assertSocialProofStorage(tx);
  const rows = await tx.$queryRaw<Array<{ id: string; applicationId: string | null; checksum: string }>>`SELECT id,application_id AS "applicationId",checksum FROM member_social_uploads WHERE id=ANY(${ids}::text[]) AND user_id=${userId} AND purpose=${purpose} FOR UPDATE`;
  if (rows.length !== ids.length || rows.some(row => row.applicationId && row.applicationId !== applicationId)) throw Error("MEMBER_OPERATIONS_PROOF_NOT_FOUND");
  if (new Set(rows.map(row => row.checksum)).size !== rows.length) throw Error("MEMBER_OPERATIONS_DUPLICATE_CONTENT");
  const duplicates = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM member_social_uploads WHERE user_id=${userId} AND purpose=${purpose} AND checksum=ANY(${rows.map(row => row.checksum)}::text[]) AND application_id IS NOT NULL AND application_id<>${applicationId} LIMIT 1`;
  if (duplicates.length) throw Error("MEMBER_OPERATIONS_DUPLICATE_CONTENT");
  await tx.$executeRaw`UPDATE member_social_uploads SET application_id=${applicationId} WHERE user_id=${userId} AND id=ANY(${ids}::text[])`;
}

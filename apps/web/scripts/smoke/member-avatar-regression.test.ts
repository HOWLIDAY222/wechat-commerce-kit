import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import sharp from "sharp";

async function main() {
  const database = new URL(process.env.DATABASE_URL || ""); assert.equal(database.pathname, "/vk_member_subscriptions_smoke_20261018"); assert(["127.0.0.1", "localhost"].includes(database.hostname)); assert.equal(process.env.COMMERCE_STORAGE, "prisma");
  const uploadDir = resolve(process.env.UPLOAD_DIR || ""); assert(uploadDir.replaceAll("\\", "/").includes("/community-fixtures/qa-uploads/"));
  const root = join(dirname(uploadDir), "private-member-avatars"), files = async () => readdir(root).catch(() => [] as string[]), beforeFiles = await files();
  const originalFetch = globalThis.fetch; globalThis.fetch = async () => { throw Error("No avatar QA gateway calls are permitted"); };
  const { prisma } = await import("@/lib/db/prisma");
  const { getMemberAvatar: metadata, readMemberAvatar: read, uploadMemberAvatar: upload, removeMemberAvatar: remove } = await import("@/lib/services/member-avatar-service");
  const route = await import("@/app/api/account/member-profile/avatar/route");
  const { createSessionToken, hashToken } = await import("@/lib/auth/session");
  const ids: string[] = [], suffix = randomUUID();
  async function user(bound = true, active = true) { const value = await prisma.user.create({ data: { name: "avatar-isolated-" + suffix, status: active ? "ACTIVE" : "DISABLED", phone: bound ? "136" + String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0") : null } }); ids.push(value.id); return value; }
  async function image(seed: number) { return new File([new Uint8Array(await sharp({ create: { width: 1000, height: 750, channels: 3, background: { r: seed, g: 80, b: 140 } } }).png().withMetadata({ exif: { IFD0: { Copyright: "REMOVE PRIVATE METADATA" } } }).toBuffer())], "avatar.png", { type: "image/png" }); }
  async function token(userId: string) { const value = createSessionToken(); await prisma.session.create({ data: { userId, tokenHash: hashToken(value), expiresAt: new Date(Date.now() + 120_000) } }); return value; }
  async function protectedState() {
    const result: Record<string, string | null> = {};
    for (const table of ["users", "customer_profiles", "member_account_profiles", "member_operation_records", "point_entries", "orders", "order_items", "payment_intents", "shipments", "refunds", "products", "product_skus"]) { assert(/^[a-z_]+$/.test(table)); result[table] = (await prisma.$queryRawUnsafe<Array<{ hash: string | null }>>(`SELECT md5(string_agg(row_to_json(t)::text, ',' ORDER BY row_to_json(t)::text)) AS hash FROM ${table} t`))[0].hash; }
    return result;
  }
  try {
    const a = await user(), b = await user(), unbound = await user(false), inactive = await user(true, false), before = await protectedState();
    await test("real database avatar CAS accepts exactly one concurrent upload and preserves private one-file storage", async () => {
      const values = await Promise.allSettled([upload(a.id, 0, await image(10)), upload(a.id, 0, await image(20))]);
      assert.equal(values.filter(value => value.status === "fulfilled").length, 1); assert.match((values.find(value => value.status === "rejected") as PromiseRejectedResult).reason.message, /REVISION_CONFLICT/);
      assert.equal((await metadata(a.id)).revision, 1); assert.equal((await files()).length, beforeFiles.length + 1);
      const normalized = await sharp(await read(a.id)).metadata(); assert.equal(normalized.width, 512); assert.equal(normalized.format, "webp"); assert.equal(normalized.exif, undefined);
      if (process.platform !== "win32") { const filename = (await files()).find(value => !beforeFiles.includes(value))!; assert.equal((await stat(join(root, filename))).mode & 0o777, 0o600); }
    });
    await test("private avatar is account isolated and unbound/inactive accounts cannot persist pictures", async () => {
      await assert.rejects(read(b.id), /NOT_FOUND/); await assert.rejects(remove(b.id, 1), /REVISION_CONFLICT/);
      await assert.rejects(upload(unbound.id, 0, await image(30)), /PHONE_REQUIRED/); await assert.rejects(upload(inactive.id, 0, await image(40)), /ACCOUNT_NOT_FOUND/);
      assert.equal((await metadata(a.id)).revision, 1); assert.equal((await files()).length, beforeFiles.length + 1);
    });
    await test("replacement and removal use independent avatar revisions and remove obsolete files", async () => {
      const originalFiles = await files(); await upload(a.id, 1, await image(50)); const replacement = await files();
      assert.equal(replacement.length, originalFiles.length); assert.notDeepEqual(replacement, originalFiles); assert.equal((await metadata(a.id)).revision, 2);
      await assert.rejects(remove(a.id, 1), /REVISION_CONFLICT/); assert.deepEqual(await files(), replacement);
      const result = await remove(a.id, 2); assert.equal(result.hasAvatar, false); assert.equal(result.revision, 3); assert.deepEqual(await files(), beforeFiles);
      await upload(a.id, 3, await image(60)); assert.equal((await metadata(a.id)).revision, 4);
    });
    await test("actual avatar routes enforce auth, same-host writes, private read and revisioned deletion", async () => {
      const bearerA = await token(a.id), bearerB = await token(b.id), request = (bearer: string, method = "GET", body?: string, origin?: string) => new Request("https://qa.invalid/api/account/member-profile/avatar", { method, headers: { authorization: "Bearer " + bearer, host: "qa.invalid", ...(body ? { "Content-Type": "application/json" } : {}), ...(origin ? { origin } : {}) }, ...(body ? { body } : {}) });
      assert.equal((await route.GET(request("invalid"))).status, 401); assert.equal((await route.GET(request(bearerB))).status, 404);
      const imageResponse = await route.GET(request(bearerA)); assert.equal(imageResponse.status, 200); assert.equal(imageResponse.headers.get("content-type"), "image/webp"); assert.match(imageResponse.headers.get("cache-control") || "", /private.*no-store/);
      assert.equal((await route.DELETE(request(bearerA, "DELETE", '{"expectedRevision":4}', "https://evil.invalid"))).status, 403);
      assert.equal((await route.DELETE(request(bearerA, "DELETE", '{"expectedRevision":3}'))).status, 409);
      assert.equal((await route.DELETE(request(bearerA, "DELETE", '{"expectedRevision":4}'))).status, 200); assert.equal((await metadata(a.id)).revision, 5); assert.deepEqual(await files(), beforeFiles);
    });
    await test("avatar operations do not alter identity, profile data, points, orders, payment, shipping or stock", async () => { assert.deepEqual(await protectedState(), before); });
  } finally {
    const rows = await prisma.$queryRaw<Array<{ filename: string | null }>>`DELETE FROM member_account_avatars WHERE user_id=ANY(${ids}::text[]) RETURNING filename`;
    for (const row of rows) if (row.filename) { assert(/^[a-f0-9-]{36}\.webp$/.test(row.filename)); await rm(join(root, row.filename), { force: true }); }
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } }); await prisma.session.deleteMany({ where: { userId: { in: ids } } }); await prisma.user.deleteMany({ where: { id: { in: ids } } }); assert.deepEqual(await files(), beforeFiles);
    globalThis.fetch = originalFetch; await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.stack : "Avatar regression failed"); process.exitCode = 1; });

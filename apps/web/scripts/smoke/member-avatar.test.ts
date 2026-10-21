import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { createMemberAvatarStore, type AvatarRepository, type AvatarWriter } from "@/lib/commerce/member-avatar-store";
import { parseAvatarRevision, type MemberAvatarRecord } from "@/lib/commerce/member-avatar";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "vk-avatar-isolated-"));
  t.after(async () => { assert(resolve(root).startsWith(resolve(tmpdir()) + sep + "vk-avatar-isolated-")); await rm(root, { force: true, recursive: true }); });
  const users = new Map([['a', { active: true, phone: true }], ['b', { active: true, phone: true }], ['unbound', { active: true, phone: false }], ['disabled', { active: false, phone: true }]]);
  const rows = new Map<string, MemberAvatarRecord>();
  const audits: unknown[] = [];
  const assertAccount = async (id: string, editing: boolean) => { const user = users.get(id); if (!user?.active) throw Error("ACCOUNT_NOT_FOUND"); if (editing && !user.phone) throw Error("MEMBER_PROFILE_PHONE_REQUIRED"); };
  let tail: Promise<unknown> = Promise.resolve();
  const repository: AvatarRepository = { assertAccount, read: async id => rows.get(id) ?? null, transaction(fn) {
    const operation = tail.then(async () => {
      const staged = new Map(rows), stagedAudits: unknown[] = [];
      const writer: AvatarWriter = { assertAccount, read: async id => staged.get(id) ?? null,
        compareAndSet: async (id, revision, filename) => { const old = staged.get(id); if ((old?.revision ?? 0) !== revision) return null; const row = { filename, revision: revision + 1, updatedAt: new Date() }; staged.set(id, row); return row; },
        audit: async (...args) => { stagedAudits.push(args); },
      };
      const result = await fn(writer); rows.clear(); staged.forEach((value, key) => rows.set(key, value)); audits.push(...stagedAudits); return result;
    });
    tail = operation.catch(() => undefined); return operation;
  } };
  const store = createMemberAvatarStore(repository, root);
  const png = await sharp({ create: { width: 780, height: 600, channels: 3, background: "#555555" } }).png().withMetadata({ exif: { IFD0: { Copyright: "MUST BE REMOVED" } } }).toBuffer();
  const image = () => new File([new Uint8Array(png)], "not-trusted-name.png", { type: "image/png" });
  return { root, store, rows, users, audits, image };
}

test("avatar lifecycle persists normalized 512px WebP without metadata, replaces then removes only own file", async t => {
  const { store, root, image, audits } = await fixture(t);
  assert.deepEqual(await store.metadata("a"), { available: true, hasAvatar: false, revision: 0, updatedAt: null });
  const first = await store.upload("a", 0, image()); assert.equal(first.revision, 1); assert.equal(first.hasAvatar, true);
  const firstFiles = await readdir(root); assert.equal(firstFiles.length, 1);
  const metadata = await sharp(await store.read("a")).metadata();
  assert.equal(metadata.format, "webp"); assert.equal(metadata.width, 512); assert.equal(metadata.exif, undefined); assert.equal(metadata.icc, undefined);
  const next = await store.upload("a", 1, image()); assert.equal(next.revision, 2);
  assert.equal((await readdir(root)).length, 1); assert.notEqual((await readdir(root))[0], firstFiles[0]);
  const removed = await store.remove("a", 2); assert.equal(removed.revision, 3); assert.equal(removed.hasAvatar, false);
  assert.equal((await readdir(root)).length, 0); await assert.rejects(store.read("a"), /MEMBER_AVATAR_NOT_FOUND/); assert.equal(audits.length, 3);
});
test("another account cannot read, replace or delete another member avatar through self-scoped storage", async t => {
  const { store, image, root } = await fixture(t);
  await store.upload("a", 0, image()); await assert.rejects(store.read("b"), /NOT_FOUND/);
  await assert.rejects(store.remove("b", 1), /REVISION_CONFLICT/); assert.equal((await store.metadata("a")).hasAvatar, true);
  await store.upload("b", 0, image()); await store.remove("b", 1); assert.equal((await readdir(root)).length, 1); assert(await store.read("a"));
});
test("unbound and inactive accounts are denied before storage or avatar-row writes", async t => {
  const { store, root, image, rows } = await fixture(t);
  await assert.rejects(store.upload("unbound", 0, image()), /PHONE_REQUIRED/);
  await assert.rejects(store.upload("disabled", 0, image()), /ACCOUNT_NOT_FOUND/);
  await assert.rejects(store.remove("disabled", 0), /ACCOUNT_NOT_FOUND/);
  assert.equal(rows.size, 0); assert.deepEqual(await readdir(root), []);
});
test("concurrent uploads have one CAS winner and do not leave orphan images", async t => {
  const { store, root, image } = await fixture(t);
  const results = await Promise.allSettled([store.upload("a", 0, image()), store.upload("a", 0, image())]);
  assert.equal(results.filter(value => value.status === "fulfilled").length, 1);
  const failed = results.find(value => value.status === "rejected") as PromiseRejectedResult; assert.match(failed.reason.message, /REVISION_CONFLICT/);
  assert.equal((await readdir(root)).length, 1); assert.equal((await store.metadata("a")).revision, 1);
});
test("stale deletion cannot remove the latest avatar; stale upload cleans only its unused candidate", async t => {
  const { store, root, image } = await fixture(t); await store.upload("a", 0, image());
  const before = await readdir(root);
  await assert.rejects(store.remove("a", 0), /REVISION_CONFLICT/); await assert.rejects(store.upload("a", 0, image()), /REVISION_CONFLICT/);
  assert.deepEqual(await readdir(root), before); assert.equal((await store.metadata("a")).revision, 1);
});
test("binary signatures, actual decode and declared MIME all validate before persistence", async t => {
  const { store, root, image } = await fixture(t);
  const samples = [new File(["<svg onload='evil()'></svg>"], "avatar.png", { type: "image/png" }), new File([new Uint8Array(await image().arrayBuffer())], "fake.jpg", { type: "image/jpeg" }), new File([new Uint8Array([137,80,78,71,13,10,26,10,0])], "broken.png", { type: "image/png" })];
  for (const file of samples) await assert.rejects(store.upload("a", 0, file), /IMAGE_/);
  assert.deepEqual(await readdir(root), []);
});
test("empty, oversize and invalid revision uploads never persist", async t => {
  const { store, root, image } = await fixture(t);
  await assert.rejects(store.upload("a", 0, new File([], "empty.png", { type: "image/png" })), /IMAGE_FILE_SIZE/);
  await assert.rejects(store.upload("a", 0, new File([new Uint8Array(3 * 1024 * 1024 + 1)], "large.png", { type: "image/png" })), /IMAGE_FILE_SIZE/);
  for (const revision of [-1, 1.5, NaN, 2147483647]) { assert.equal(parseAvatarRevision(revision), null); await assert.rejects(store.upload("a", revision, image()), /INVALID_MEMBER_AVATAR_REVISION/); }
  assert.deepEqual(await readdir(root), []);
});
test("out-of-root filenames from corrupted metadata never read or remove unrelated paths", async t => {
  const { store, rows } = await fixture(t); rows.set("a", { filename: "../other.webp", revision: 1, updatedAt: new Date() });
  await assert.rejects(store.read("a"), /NOT_FOUND/); await store.remove("a", 1); assert.equal((await store.metadata("a")).hasAvatar, false);
});

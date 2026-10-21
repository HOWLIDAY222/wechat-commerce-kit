import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

async function main() {
  const database = new URL(process.env.DATABASE_URL || "");
  assert.equal(database.pathname, "/vk_member_subscriptions_smoke_20261018", "Only the dedicated disposable member QA database is permitted");
  assert(["localhost", "127.0.0.1"].includes(database.hostname));
  assert.equal(process.env.COMMERCE_STORAGE, "prisma");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Error("Member profile QA must never call any gateway"); };
  const { prisma } = await import("@/lib/db/prisma");
  const { getMemberAccountProfile: read, saveMemberAccountProfile: save, getAdminMemberAccountProfile: adminRead } = await import("@/lib/services/member-profile-service");
  const { GET, PUT } = await import("@/app/api/account/member-profile/route");
  const { createSessionToken, hashToken } = await import("@/lib/auth/session");
  const suffix = randomUUID(), ids: string[] = [];
  const input = { surname: "测", givenName: "试", displayName: "QA ONLY", gender: "UNSPECIFIED" as const, region: ["隔离测试省", "测试市", "测试区"], birthday: "2000-02-29", expectedRevision: 0, completeRegistration: false };
  let renamed = false;
  async function actor(role: "CUSTOMER" | "ADMIN" | "OWNER" = "CUSTOMER", phone: string | null = null, status: "ACTIVE" | "DISABLED" = "ACTIVE") {
    const user = await prisma.user.create({ data: { name: "member-qa-" + suffix, phone, role, status, customerProfile: { create: { birthYear: 1980, gender: "MALE", marketingGranted: true } } } });
    ids.push(user.id); return user;
  }
  const phone = () => "138" + String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0");
  const rows = async (userId: string) => Number((await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM member_account_profiles WHERE user_id = ${userId}`)[0].count);
  const audits = (userId: string) => prisma.auditLog.findMany({ where: { targetId: userId, action: "member.profile.updated" }, orderBy: { createdAt: "asc" } });
  async function protectedState() {
    // No test can silently mutate a pre-existing user/contact/order/stock row.
    const tables = ["users", "customer_profiles", "orders", "order_items", "payment_intents", "shipments", "refunds", "products", "product_skus", "privacy_consents"];
    const result: Record<string, string | null> = {};
    for (const table of tables) {
      const safe = table.replace(/[^a-z_]/g, ""); assert.equal(table, safe);
      const values = await prisma.$queryRawUnsafe<Array<{ hash: string | null }>>(`SELECT md5(string_agg(row_to_json(t)::text, ',' ORDER BY row_to_json(t)::text)) AS hash FROM ${safe} t`);
      result[table] = values[0].hash;
    }
    return result;
  }
  async function token(userId: string) {
    const value = createSessionToken();
    await prisma.session.create({ data: { tokenHash: hashToken(value), userId, expiresAt: new Date(Date.now() + 60_000) } });
    return value;
  }
  const request = (bearer: string, body?: unknown, origin?: string) => new Request("http://qa.invalid/api/account/member-profile", {
    method: body === undefined ? "GET" : "PUT", headers: { authorization: `Bearer ${bearer}`, host: "qa.invalid", ...(origin ? { origin } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  try {
    const owner = await actor("OWNER"), admin = await actor("ADMIN"), disabled = await actor("ADMIN", null, "DISABLED"), guest = await actor(), buyer = await actor("CUSTOMER", phone()), other = await actor("CUSTOMER", phone());
    const baseline = await protectedState();
    await test("GET is read-only, does not populate rows or copy legacy demographics", async () => {
      const result = await read(buyer.id);
      assert.deepEqual(result.profile, { surname: "", givenName: "", displayName: "", gender: null, region: [], birthday: null, registeredAt: null, updatedAt: null, revision: 0 });
      assert.equal(result.accountPhone, buyer.phone); assert.equal(result.canEdit, true); assert.equal(await rows(buyer.id), 0);
      assert.equal((await audits(buyer.id)).length, 0); assert.deepEqual(await protectedState(), baseline);
    });
    await test("unbound accounts receive an explicit phone step and cannot store profile metadata", async () => {
      const result = await read(guest.id); assert.equal(result.canEdit, false); assert.equal(result.canCompleteRegistration, false); assert.equal(result.accountPhone, null);
      await assert.rejects(save(guest.id, input), /MEMBER_PROFILE_PHONE_REQUIRED/);
      await assert.rejects(save(guest.id, { ...input, completeRegistration: true }), /MEMBER_PROFILE_PHONE_REQUIRED/);
      assert.equal(await rows(guest.id), 0); assert.deepEqual(await protectedState(), baseline);
    });
    await test("revisioned metadata save is separate from registration and original users/orders remain byte-equivalent", async () => {
      const result = await save(buyer.id, input);
      assert.equal(result.profile.revision, 1); assert.equal(result.profile.registeredAt, null); assert.equal(result.profile.displayName, input.displayName);
      assert.equal(result.accountPhone, buyer.phone); assert.equal(await rows(buyer.id), 1); assert.deepEqual(await protectedState(), baseline);
    });
    await test("explicit registration records the first timestamp once, later edits and clears retain it", async () => {
      const registered = await save(buyer.id, { ...input, expectedRevision: 1, completeRegistration: true });
      assert(registered.profile.registeredAt); assert.equal(registered.profile.revision, 2);
      const edited = await save(buyer.id, { ...input, expectedRevision: 2, completeRegistration: true, displayName: "Updated QA" });
      assert.equal(edited.profile.registeredAt, registered.profile.registeredAt);
      const cleared = await save(buyer.id, { ...input, surname: "", givenName: "", displayName: "", gender: null, region: [], birthday: null, expectedRevision: 3 });
      assert.equal(cleared.profile.registeredAt, registered.profile.registeredAt); assert.equal(cleared.profile.birthday, null); assert.deepEqual(cleared.profile.region, []);
      assert.equal(cleared.profile.revision, 4); assert.deepEqual(await protectedState(), baseline);
    });
    await test("stale revisions never overwrite metadata or create extra audit entries", async () => {
      const before = await read(buyer.id), count = (await audits(buyer.id)).length;
      await assert.rejects(save(buyer.id, { ...input, expectedRevision: 2 }), /MEMBER_PROFILE_REVISION_CONFLICT/);
      assert.deepEqual(await read(buyer.id), before); assert.equal((await audits(buyer.id)).length, count);
    });
    await test("independent timestamps retain their actual UTC epoch even with an Asia/Shanghai database session", async () => {
      const result = await read(buyer.id);
      const rows = await prisma.$queryRaw<Array<{ registeredEpoch: string; updatedEpoch: string }>>`SELECT (EXTRACT(epoch FROM registered_at)*1000)::text AS "registeredEpoch", (EXTRACT(epoch FROM updated_at)*1000)::text AS "updatedEpoch" FROM member_account_profiles WHERE user_id = ${buyer.id}`;
      assert.equal(Date.parse(result.profile.registeredAt!), Math.trunc(Number(rows[0].registeredEpoch)));
      assert.equal(Date.parse(result.profile.updatedAt!), Math.trunc(Number(rows[0].updatedEpoch)));
      assert(Math.abs(Date.now() - Number(rows[0].registeredEpoch)) < 10_000, "Registration must be stored at its real instant, without an eight-hour shift");
    });
    await test("concurrent first saves and concurrent updates each have exactly one winning revision", async () => {
      const initial = await Promise.allSettled([save(other.id, input), save(other.id, { ...input, displayName: "Concurrent QA" })]);
      assert.equal(initial.filter(result => result.status === "fulfilled").length, 1); assert.equal((await read(other.id)).profile.revision, 1);
      assert.equal((await audits(other.id)).length, 1);
      const changed = await Promise.allSettled([save(other.id, { ...input, expectedRevision: 1 }), save(other.id, { ...input, expectedRevision: 1, displayName: "Concurrent Update" })]);
      assert.equal(changed.filter(result => result.status === "fulfilled").length, 1); assert.equal((await read(other.id)).profile.revision, 2);
      assert.equal((await audits(other.id)).length, 2); assert.deepEqual(await protectedState(), baseline);
    });
    await test("invalid payloads, absent users and disabled actors do not write rows", async () => {
      const before = await read(buyer.id);
      for (const extra of [{ phone: "13900000003" }, { birthday: "2001-02-29" }, { region: ["省"] }]) await assert.rejects(save(buyer.id, { ...input, expectedRevision: 4, ...extra } as typeof input), /INVALID_MEMBER_PROFILE/);
      await assert.rejects(read("missing-member-qa"), /ACCOUNT_NOT_FOUND/);
      await assert.rejects(save(disabled.id, input), /ACCOUNT_NOT_FOUND/);
      assert.deepEqual(await read(buyer.id), before); assert.deepEqual(await protectedState(), baseline);
    });
    await test("only active OWNER or ADMIN can read another customer's independent member details", async () => {
      assert.equal((await adminRead(buyer.id, owner.id)).profile.revision, 4);
      assert.equal((await adminRead(buyer.id, admin.id)).canEdit, false);
      for (const actorId of [buyer.id, disabled.id, "missing-member-qa"]) await assert.rejects(adminRead(buyer.id, actorId), /ADMIN_REQUIRED/);
      await assert.rejects(adminRead("missing-member-qa", admin.id), /ACCOUNT_NOT_FOUND/);
    });
    await test("actual account route scopes reads to bearer identity and forbids arbitrary phones or cross-origin writes", async () => {
      const bearer = await token(buyer.id), otherBearer = await token(other.id);
      const result = await GET(request(bearer)); assert.equal(result.status, 200); assert.match(result.headers.get("cache-control") || "", /no-store/);
      assert.equal((await result.json()).profile.revision, 4);
      assert.equal((await (await GET(request(otherBearer))).json()).profile.revision, 2);
      const malformed = await PUT(request(bearer, { ...input, expectedRevision: 4, phone: "13900000003" })); assert.equal(malformed.status, 400);
      const evil = await PUT(request(bearer, { ...input, expectedRevision: 4 }, "https://evil.invalid")); assert.equal(evil.status, 403);
      const missing = await GET(new Request("http://qa.invalid", { headers: { authorization: "Bearer invalid" } })); assert.equal(missing.status, 401);
      assert.deepEqual(await protectedState(), baseline);
    });
    await test("missing storage fails closed as 503 instead of inventing empty profiles", async () => {
      const bearer = await token(buyer.id);
      await prisma.$executeRawUnsafe("ALTER TABLE member_account_profiles RENAME TO member_account_profiles_qa_hidden"); renamed = true;
      try { const result = await GET(request(bearer)); assert.equal(result.status, 503); assert.equal((await result.json()).error, "MEMBER_PROFILE_UNAVAILABLE"); }
      finally { await prisma.$executeRawUnsafe("ALTER TABLE member_account_profiles_qa_hidden RENAME TO member_account_profiles"); renamed = false; }
    });
    await test("database checks enforce bounded names, demographics and compare revision records", async () => {
      for (const statement of ["UPDATE member_account_profiles SET revision = 0", "UPDATE member_account_profiles SET gender = 'UNKNOWN'", "UPDATE member_account_profiles SET region = '[1]'::jsonb", "UPDATE member_account_profiles SET birthday = DATE '1899-01-01'", "UPDATE member_account_profiles SET surname = repeat('x',41)"]) await assert.rejects(prisma.$executeRawUnsafe(statement), /member_account_profile_/);
      assert.deepEqual(await protectedState(), baseline);
    });
    await test("audit contains changed field names and revisions without demographic or phone values", async () => {
      const events = await audits(buyer.id); assert.equal(events.length, 4);
      const details = JSON.stringify(events.map(event => event.detail));
      for (const value of [buyer.phone!, "2000-02-29", "QA ONLY", "隔离测试省"]) assert.equal(details.includes(value), false);
      assert.equal(events.filter(event => (event.detail as { completedRegistration: boolean }).completedRegistration).length, 1);
      assert.deepEqual(await protectedState(), baseline);
    });
  } finally {
    if (renamed) await prisma.$executeRawUnsafe("ALTER TABLE member_account_profiles_qa_hidden RENAME TO member_account_profiles");
    await prisma.$executeRaw`DELETE FROM member_account_profiles WHERE user_id = ANY(${ids}::text[])`;
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    globalThis.fetch = originalFetch;
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Member profile regression failed"); process.exitCode = 1; });

import assert from "node:assert/strict";
import { test } from "node:test";
import { hasSameHostMemberProfileOrigin, memberProfileDto, parseMemberProfileInput } from "@/lib/commerce/member-profile";

const now = new Date("2026-10-18T00:00:00Z");
const input = { surname: "张", givenName: "明", displayName: "会员", gender: "UNSPECIFIED", region: ["上海市", "上海市", "黄浦区"], birthday: "2000-02-29", expectedRevision: 0, completeRegistration: true };
test("complete profile validates and harmless surrounding whitespace is normalized", () => {
  assert.deepEqual(parseMemberProfileInput(input, now), input);
  assert.equal(parseMemberProfileInput({ ...input, surname: "  张 " }, now)?.surname, "张");
});
test("all demographics may be empty and registration is an explicit action", () => {
  const empty = { ...input, surname: "", givenName: "", displayName: "", gender: null, region: [], birthday: null };
  const { completeRegistration, ...withoutAction } = empty;
  assert.equal(completeRegistration, true);
  assert.deepEqual(parseMemberProfileInput(withoutAction, now), { ...empty, completeRegistration: false });
});
test("phone, owner, marketing and legacy profile fields cannot enter this write contract", () => {
  for (const field of ["phone", "userId", "marketingGranted", "name", "birthYear"]) assert.equal(parseMemberProfileInput({ ...input, [field]: "unsafe" }, now), null);
});
test("full metadata and a safe compare revision are required", () => {
  for (const field of ["surname", "givenName", "displayName", "gender", "region", "birthday", "expectedRevision"]) { const partial = { ...input } as Record<string, unknown>; delete partial[field]; assert.equal(parseMemberProfileInput(partial, now), null); }
  for (const expectedRevision of [-1, 0.1, "0", null, 2147483647, Number.NaN]) assert.equal(parseMemberProfileInput({ ...input, expectedRevision }, now), null);
  for (const completeRegistration of ["true", 1, null]) assert.equal(parseMemberProfileInput({ ...input, completeRegistration }, now), null);
});
test("names enforce agreed lengths and reject hidden control characters", () => {
  assert(parseMemberProfileInput({ ...input, surname: "张".repeat(40), givenName: "张".repeat(40), displayName: "A".repeat(80) }, now));
  for (const patch of [{ surname: "张".repeat(41) }, { givenName: "张".repeat(41) }, { displayName: "A".repeat(81) }, { displayName: "名\n称" }, { surname: "\0" }, { givenName: 5 }]) assert.equal(parseMemberProfileInput({ ...input, ...patch }, now), null);
});
test("gender is the finite supported set and never coerced from an object", () => {
  for (const gender of [null, "MALE", "FEMALE", "UNSPECIFIED"]) assert(parseMemberProfileInput({ ...input, gender }, now));
  for (const gender of ["OTHER", "UNKNOWN", "male", { toString: () => "MALE" }]) assert.equal(parseMemberProfileInput({ ...input, gender }, now), null);
});
test("region is empty or three actual nonempty bounded strings", () => {
  for (const region of [[], ["省", "市", "区"]]) assert(parseMemberProfileInput({ ...input, region }, now));
  for (const region of [null, "上海", ["省"], ["省", "市", ""], ["省", "市", null], ["省", "市", "区".repeat(81)], new Array(3)]) assert.equal(parseMemberProfileInput({ ...input, region }, now), null);
});
test("birthday is a real date from 1900 through Beijing today", () => {
  for (const birthday of [null, "1900-01-01", "2000-02-29", "2026-10-18"]) assert(parseMemberProfileInput({ ...input, birthday }, now));
  for (const birthday of ["1899-12-31", "1900-02-29", "2025-02-29", "2026-04-31", "2026-10-19", "2026-1-01", "2026-10-18T00:00:00Z"]) assert.equal(parseMemberProfileInput({ ...input, birthday }, now), null);
  assert(parseMemberProfileInput({ ...input, birthday: "2026-10-19" }, new Date("2026-10-18T16:00:00Z")));
});
test("empty DTO is explicit and carries no legacy account data", () => {
  assert.deepEqual(memberProfileDto(null), { surname: "", givenName: "", displayName: "", gender: null, region: [], birthday: null, registeredAt: null, updatedAt: null, revision: 0 });
});
test("origin check accepts native bearer and same actual host behind TLS proxy", () => {
  assert(hasSameHostMemberProfileOrigin(new Request("http://internal.test")));
  assert(hasSameHostMemberProfileOrigin(new Request("http://internal.test", { headers: { host: "example.invalid", origin: "https://example.invalid" } })));
  for (const origin of ["https://evil.test", "null", "https://example.invalid/extra", "https://example.invalid?x=1", "https://a:secret@example.invalid"]) assert.equal(hasSameHostMemberProfileOrigin(new Request("http://internal.test", { headers: { host: "example.invalid", origin, "x-forwarded-host": "evil.test" } })), false);
});

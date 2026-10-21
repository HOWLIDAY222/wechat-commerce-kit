import assert from "node:assert/strict";
import { test } from "node:test";

// Runtime sessions and unavailable storage intentionally avoid any database I/O.
process.env.COMMERCE_STORAGE = "runtime";
test("avatar routes reject missing/invalid bearer sessions before body parsing", async () => {
  const route = await import("@/app/api/account/member-profile/avatar/route");
  for (const method of ["GET", "POST", "DELETE"] as const) {
    const response = await route[method](new Request("https://qa.invalid/api/account/member-profile/avatar", { method, headers: { Authorization: "Bearer invalid" } }));
    assert.equal(response.status, 401); assert.match(response.headers.get("cache-control") || "", /no-store/);
  }
});
test("cross-origin avatar writes are denied while native bearer callers are allowed to reach a fail-closed storage gate", async () => {
  const { registerRuntimeSession } = await import("@/lib/auth/session");
  const route = await import("@/app/api/account/member-profile/avatar/route");
  const token = "a".repeat(64); registerRuntimeSession(token, { userId: "isolated-avatar-fixture", role: "customer", expiresAt: new Date(Date.now() + 60_000).toISOString() });
  for (const method of ["POST", "DELETE"] as const) {
    const response = await route[method](new Request("https://qa.invalid/api/account/member-profile/avatar", { method, headers: { Authorization: "Bearer " + token, host: "qa.invalid", origin: "https://evil.invalid" } }));
    assert.equal(response.status, 403);
  }
  const response = await route.GET(new Request("https://qa.invalid/api/account/member-profile/avatar", { headers: { Authorization: "Bearer " + token } }));
  assert.equal(response.status, 503); assert.equal((await response.json()).error, "MEMBER_AVATAR_UNAVAILABLE");
});

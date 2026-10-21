import { NextResponse } from "next/server";
import { createSessionToken, hashToken, setAdminSessionCookie } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";

export async function POST(request: Request) {
  if (!appConfig.ENABLE_MOCK_ADMIN_LOGIN) {
    return NextResponse.json({ ok: false, error: "MOCK_ADMIN_LOGIN_DISABLED" }, { status: 403 });
  }

  const payload = await request.json().catch(() => ({})) as { role?: string };
  const role = payload.role === "owner" ? "owner" : "admin";
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await setAdminSessionCookie(token, expiresAt, {
    userId: "mock-admin-local",
    role,
  });

  return NextResponse.json({
    ok: true,
    admin: {
      id: "mock-admin-local",
      role,
    },
    session: {
      tokenHashPreview: hashToken(token).slice(0, 10),
      expiresAt: expiresAt.toISOString(),
    },
  });
}

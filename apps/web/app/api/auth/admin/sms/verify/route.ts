import { NextResponse } from "next/server";
import { z } from "zod";
import { appConfig } from "@/lib/config";
import { adminSessionCookieName, createSessionToken, hashToken, setAdminSessionCookie } from "@/lib/auth/session";
import { verifySmsCode } from "@/lib/providers/sms";
import { resolveAdminAuthTarget } from "@/lib/services/admin-auth-service";
import { recordAuthLoginSuccess } from "@/lib/services/auth-audit-service";

const inputSchema = z.object({
  phone: z.string(),
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(request: Request) {
  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_ADMIN_SMS_VERIFY_REQUEST" }, { status: 400 });
  }

  const admin = await resolveAdminAuthTarget(parsed.data.phone);
  if (!admin) {
    return NextResponse.json({ ok: false, error: "ADMIN_PHONE_NOT_ALLOWED" }, { status: 403 });
  }

  const result = await verifySmsCode(admin.phone, "login", parsed.data.code);
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  await setAdminSessionCookie(token, expiresAt, {
    userId: admin.userId,
    phone: admin.phone,
    role: admin.role,
  });
  await recordAuthLoginSuccess({
    method: "sms",
    phone: admin.phone,
    role: admin.role,
    userId: admin.userId,
  });

  const response = NextResponse.json({
    ok: true,
    admin: {
      id: admin.userId,
      phone: admin.phone,
      role: admin.role,
    },
    session: {
      tokenHashPreview: hashToken(token).slice(0, 10),
      expiresAt: expiresAt.toISOString(),
    },
  });
  response.cookies.set(adminSessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: appConfig.APP_BASE_URL.startsWith("https://"),
    path: "/",
    expires: expiresAt,
  });
  return response;
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { getAdminUserDetail } from "@/lib/services/admin-ops-service";
import { getAccountPasswordState, setAccountPassword } from "@/lib/services/password-auth-service";

const passwordSchema = z.object({
  currentPassword: z.string().min(8).max(72).optional(),
  newPassword: z.string().min(8).max(72),
  confirmPassword: z.string().min(8).max(72),
});

export async function GET() {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });

  return NextResponse.json({
    ok: true,
    password: await getAccountPasswordState(session.userId),
  });
}

export async function PUT(request: Request) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });

  const parsed = passwordSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_ADMIN_PASSWORD_UPDATE" }, { status: 400 });
  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    return NextResponse.json({ ok: false, error: "PASSWORD_CONFIRM_MISMATCH" }, { status: 400 });
  }

  try {
    const user = await getAdminUserDetail(session.userId);
    if (!user) return NextResponse.json({ ok: false, error: "ADMIN_PROFILE_NOT_FOUND" }, { status: 404 });

    return NextResponse.json({
      ok: true,
      password: await setAccountPassword({
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        phone: user.phone ?? session.phone,
        role: session.role,
        userId: session.userId,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "ADMIN_PASSWORD_UPDATE_FAILED" },
      { status: 400 },
    );
  }
}

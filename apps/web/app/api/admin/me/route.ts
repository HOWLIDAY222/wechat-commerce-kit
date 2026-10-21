import { NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { isMainlandPhone, normalizeMainlandPhone } from "@/lib/providers/sms";
import { getAdminUserDetail, updateAdminUser } from "@/lib/services/admin-ops-service";
import { getAccountPasswordState } from "@/lib/services/password-auth-service";

const profilePatchSchema = z.object({
  name: z.string().trim().min(1).max(40),
  phone: z.string().trim().min(1).max(20),
  email: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? null : value),
    z.string().trim().email().max(120).nullable().optional(),
  ),
});

export async function GET() {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });

  const user = await getAdminUserDetail(session.userId);
  if (!user) return NextResponse.json({ ok: false, error: "ADMIN_PROFILE_NOT_FOUND" }, { status: 404 });

  return NextResponse.json({
    ok: true,
    password: await getAccountPasswordState(session.userId),
    user: {
      email: "email" in user ? user.email : null,
      id: user.id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      status: user.status,
      updatedAt: user.updatedAt,
    },
  });
}

export async function PATCH(request: Request) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });

  const parsed = profilePatchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_ADMIN_PROFILE_UPDATE" }, { status: 400 });

  try {
    const phone = normalizeMainlandPhone(parsed.data.phone);
    if (!isMainlandPhone(phone)) {
      return NextResponse.json({ ok: false, error: "INVALID_ADMIN_PHONE" }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      user: await updateAdminUser(
        session.userId,
        {
          email: parsed.data.email ?? null,
          name: parsed.data.name,
          phone,
        },
        session.userId,
      ),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "ADMIN_PROFILE_UPDATE_FAILED" },
      { status: 400 },
    );
  }
}

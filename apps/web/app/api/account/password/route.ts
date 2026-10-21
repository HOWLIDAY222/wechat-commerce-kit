import { NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentUserSession } from "@/lib/auth/session";
import { getAccountPasswordState, setAccountPassword } from "@/lib/services/password-auth-service";

const passwordSchema = z.object({
  currentPassword: z.string().min(8).max(72).optional(),
  newPassword: z.string().min(8).max(72),
});

export async function GET() {
  const session = await readCurrentUserSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    password: await getAccountPasswordState(session.userId),
  });
}

export async function PUT(request: Request) {
  const session = await readCurrentUserSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const parsed = passwordSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_PASSWORD_UPDATE_REQUEST" }, { status: 400 });
  }

  try {
    return NextResponse.json({
      ok: true,
      password: await setAccountPassword({
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        phone: session.phone,
        role: session.role,
        userId: session.userId,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "PASSWORD_UPDATE_FAILED" },
      { status: 400 },
    );
  }
}

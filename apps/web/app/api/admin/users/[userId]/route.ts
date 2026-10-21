import { NextResponse } from "next/server";
import { z } from "zod";
import { hasAdminCapability } from "@/lib/admin/permission-policy";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { getAdminUserDetail, updateAdminUser, writeAdminAudit } from "@/lib/services/admin-ops-service";

const userPatchSchema = z.object({
  role: z.enum(["CUSTOMER", "ADMIN", "OWNER"]).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  name: z.string().min(1).optional(),
});

type UserRouteProps = {
  params: Promise<{ userId: string }>;
};

export async function GET(_request: Request, { params }: UserRouteProps) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });

  const { userId } = await params;
  const user = await getAdminUserDetail(userId);
  if (!user) return NextResponse.json({ ok: false, error: "USER_NOT_FOUND" }, { status: 404 });
  await writeAdminAudit(session.userId, "admin.customer.detail.viewed", "user", userId, { fields: ["profile", "masked_contact", "orders", "addresses", "behavior"] });

  return NextResponse.json({
    ok: true,
    user,
    audit: {
      actorId: session.userId,
      action: "admin.users.detail",
      createdAt: new Date().toISOString(),
    },
  });
}

export async function PATCH(request: Request, { params }: UserRouteProps) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });

  const parsed = userPatchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_USER_UPDATE" }, { status: 400 });

  try {
    const { userId } = await params;
    const current = await getAdminUserDetail(userId);
    if (!current) return NextResponse.json({ ok: false, error: "USER_NOT_FOUND" }, { status: 404 });

    const currentRole = current.role.toUpperCase();
    const requestedRole = parsed.data.role?.toUpperCase();
    const requestedStatus = parsed.data.status?.toUpperCase();
    const changesRole = Boolean(requestedRole && requestedRole !== currentRole);
    const disablesAccount = requestedStatus === "DISABLED" && current.status.toUpperCase() !== "DISABLED";
    const changesPrivilegedStatus = Boolean(requestedStatus && requestedStatus !== current.status.toUpperCase() && isPrivilegedRole(currentRole));

    if (session.userId === userId && (changesRole || disablesAccount)) {
      return NextResponse.json({ ok: false, error: "ADMIN_SELF_LOCKOUT_FORBIDDEN" }, { status: 409 });
    }
    if (!hasAdminCapability(session.role, "manage_admin_privileges") && (changesRole || changesPrivilegedStatus || isPrivilegedRole(requestedRole))) {
      return NextResponse.json({ ok: false, error: "ADMIN_OWNER_REQUIRED" }, { status: 403 });
    }

    return NextResponse.json({
      ok: true,
      user: await updateAdminUser(userId, parsed.data, session.userId),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "USER_UPDATE_FAILED" },
      { status: 400 },
    );
  }
}

function isPrivilegedRole(role: string | undefined) {
  return role === "ADMIN" || role === "OWNER";
}

import { NextResponse } from "next/server";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { listAdminUsers } from "@/lib/services/admin-ops-service";

export async function GET() {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });

  return NextResponse.json({
    ok: true,
    users: await listAdminUsers(),
    audit: {
      actorId: session.userId,
      action: "admin.users.list",
      createdAt: new Date().toISOString(),
    },
  });
}

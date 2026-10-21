import { NextResponse } from "next/server";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { listRefundsForAdmin } from "@/lib/services/after-sales-service";

export async function GET() {
  const session = await readCurrentAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    refunds: await listRefundsForAdmin(),
    audit: {
      actorId: session.userId,
      action: "admin.refunds.list",
      createdAt: new Date().toISOString(),
    },
  });
}

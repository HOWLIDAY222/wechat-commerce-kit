import { NextResponse } from "next/server";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { listAllAfterSales } from "@/lib/services/after-sales-service";

export async function GET() {
  const session = await readCurrentAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    afterSales: await listAllAfterSales(),
    audit: {
      actorId: session.userId,
      action: "admin.after_sales.list",
      createdAt: new Date().toISOString(),
    },
  });
}

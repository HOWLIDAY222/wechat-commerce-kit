import { NextResponse } from "next/server";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { listOrdersForAdmin } from "@/lib/services/order-service";

export async function GET() {
  const session = await readCurrentAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    orders: await listOrdersForAdmin(),
    audit: {
      actorId: session.userId,
      action: "admin.orders.list",
      createdAt: new Date().toISOString(),
    },
  });
}

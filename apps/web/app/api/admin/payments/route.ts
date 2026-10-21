import { NextResponse } from "next/server";
import { readCurrentAdminSession } from "@/lib/auth/session";
import {
  listAdminOrdersMissingPaymentIntents,
  listAdminPaymentNotifications,
  listAdminPayments,
} from "@/lib/services/admin-ops-service";

export async function GET() {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });

  return NextResponse.json({
    ok: true,
    payments: await listAdminPayments(),
    missingPaymentIntentOrders: await listAdminOrdersMissingPaymentIntents(),
    notifications: await listAdminPaymentNotifications(),
    audit: {
      actorId: session.userId,
      action: "admin.payments.list",
      createdAt: new Date().toISOString(),
    },
  });
}

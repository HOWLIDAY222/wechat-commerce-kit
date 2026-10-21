import { NextResponse } from "next/server";
import { z } from "zod";
import { canExecuteProviderRefund } from "@/lib/admin/permission-policy";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import { executeProviderRefundForAdmin } from "@/lib/services/after-sales-service";

type RefundExecuteRouteProps = {
  params: Promise<{ refundNo: string }>;
};

const refundExecuteConfirmationSchema = z.object({
  confirmExecute: z.literal(true),
  confirmRefundNo: z.string().min(1),
});

export async function POST(request: Request, { params }: RefundExecuteRouteProps) {
  const session = await readCurrentAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  }
  if (!canExecuteProviderRefund(session.role, appConfig.PAYMENT_PROVIDER)) {
    return NextResponse.json({ ok: false, error: "ADMIN_OWNER_REQUIRED_FOR_REAL_REFUND" }, { status: 403 });
  }

  try {
    const { refundNo } = await params;
    const parsed = refundExecuteConfirmationSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "INVALID_REFUND_EXECUTE_CONFIRMATION" }, { status: 400 });
    }
    if (parsed.data.confirmRefundNo !== refundNo) {
      return NextResponse.json({ ok: false, error: "REFUND_EXECUTE_CONFIRMATION_MISMATCH" }, { status: 400 });
    }
    return NextResponse.json({
      ok: true,
      refund: await executeProviderRefundForAdmin(refundNo, session.userId),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "REFUND_EXECUTE_FAILED" },
      { status: 400 },
    );
  }
}

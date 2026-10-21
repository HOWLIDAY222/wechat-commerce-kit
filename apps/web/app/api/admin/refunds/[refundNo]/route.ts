import { NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { updateRefundForAdmin } from "@/lib/services/after-sales-service";

const refundPatchSchema = z.object({
  paymentRefundId: z.string().min(1).optional(),
  failureReason: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
});

type RefundRouteProps = {
  params: Promise<{ refundNo: string }>;
};

export async function PATCH(request: Request, { params }: RefundRouteProps) {
  const session = await readCurrentAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  }

  const parsed = refundPatchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_REFUND_UPDATE" }, { status: 400 });
  }

  try {
    const { refundNo } = await params;
    return NextResponse.json({
      ok: true,
      refund: await updateRefundForAdmin(refundNo, parsed.data, session.userId),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "REFUND_UPDATE_FAILED" },
      { status: 400 },
    );
  }
}

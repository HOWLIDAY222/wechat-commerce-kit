import { NextResponse } from "next/server";
import { z } from "zod";
import { afterSalesStatuses } from "@/lib/after-sales/state-machine";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { updateAfterSalesStatus } from "@/lib/services/after-sales-service";

const transitionSchema = z.object({
  status: z.enum(afterSalesStatuses),
  rejectReason: z.string().min(1).optional(),
  returnAddress: z.string().trim().min(5).max(500).optional(),
  detail: z.unknown().optional(),
});

type TransitionProps = {
  params: Promise<{ afterSalesNo: string }>;
};

export async function PATCH(request: Request, { params }: TransitionProps) {
  const session = await readCurrentAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  }

  const parsed = transitionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_AFTER_SALES_TRANSITION_REQUEST" }, { status: 400 });
  }

  try {
    const { afterSalesNo } = await params;
    return NextResponse.json({
      ok: true,
      afterSales: await updateAfterSalesStatus(afterSalesNo, {
        ...parsed.data,
        actorId: session.userId,
        actorType: "admin",
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "AFTER_SALES_TRANSITION_FAILED" },
      { status: 400 },
    );
  }
}

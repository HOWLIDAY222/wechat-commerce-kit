import { NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { addAfterSalesAdminMessage } from "@/lib/services/after-sales-service";

const messageSchema = z.object({ message: z.string().trim().min(1).max(1000) });
type RouteProps = { params: Promise<{ afterSalesNo: string }> };

export async function POST(request: Request, { params }: RouteProps) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  const parsed = messageSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_AFTER_SALES_MESSAGE" }, { status: 400 });
  try {
    const { afterSalesNo } = await params;
    return NextResponse.json({
      ok: true,
      afterSales: await addAfterSalesAdminMessage(afterSalesNo, session.userId, parsed.data.message),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "AFTER_SALES_MESSAGE_FAILED" },
      { status: 400 },
    );
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { readRequestUserSession } from "@/lib/auth/session";
import { submitAfterSalesReturnShipment } from "@/lib/services/after-sales-service";

const shipmentSchema = z.object({
  trackingCompany: z.string().trim().min(2).max(80),
  trackingNo: z.string().trim().min(4).max(100).regex(/^[A-Za-z0-9_-]+$/),
});

type RouteProps = { params: Promise<{ afterSalesNo: string }> };

export async function POST(request: Request, { params }: RouteProps) {
  const session = await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  const parsed = shipmentSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_RETURN_SHIPMENT" }, { status: 400 });
  try {
    const { afterSalesNo } = await params;
    return NextResponse.json({
      ok: true,
      afterSales: await submitAfterSalesReturnShipment(session.userId, afterSalesNo, parsed.data),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "RETURN_SHIPMENT_FAILED" },
      { status: 400 },
    );
  }
}

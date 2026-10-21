import { NextResponse } from "next/server";
import { z } from "zod";
import { readRequestUserSession } from "@/lib/auth/session";
import { createAfterSalesRequest, listAfterSalesByUser } from "@/lib/services/after-sales-service";

const afterSalesSchema = z.object({
  orderNo: z.string().min(1),
  type: z.enum(["return_refund", "exchange", "refund_only", "reship", "quality_issue"]),
  reason: z.string().min(1),
  description: z.string().min(1),
  items: z.array(
    z.object({
      orderItemId: z.string().min(1),
      quantity: z.number().int().positive(),
    }),
  ).min(1),
  imageUrls: z.array(z.string().url()).default([]),
});

export async function GET(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    afterSales: await listAfterSalesByUser(session.userId),
  });
}

export async function POST(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const parsed = afterSalesSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_AFTER_SALES_REQUEST" }, { status: 400 });
  }

  try {
    return NextResponse.json({
      ok: true,
      afterSales: await createAfterSalesRequest(session.userId, parsed.data),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "AFTER_SALES_CREATE_FAILED" },
      { status: 400 },
    );
  }
}

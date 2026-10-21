import { NextResponse } from "next/server";
import { readRequestUserSession } from "@/lib/auth/session";
import { confirmOrderReceiptForUser } from "@/lib/services/order-service";

type OrderReceiptRouteProps = { params: Promise<{ orderNo: string }> };

export async function POST(request: Request, { params }: OrderReceiptRouteProps) {
  const session = await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  try {
    const { orderNo } = await params;
    return NextResponse.json({ ok: true, order: await confirmOrderReceiptForUser(orderNo, session.userId) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ORDER_RECEIPT_CONFIRM_FAILED";
    return NextResponse.json({ ok: false, error: code }, { status: code === "ORDER_NOT_FOUND" ? 404 : 400 });
  }
}

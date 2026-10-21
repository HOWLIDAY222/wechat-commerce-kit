import { NextResponse } from "next/server";
import { readRequestUserSession } from "@/lib/auth/session";
import { repurchaseOrderForUser } from "@/lib/services/order-service";

type OrderRepurchaseRouteProps = { params: Promise<{ orderNo: string }> };

export async function POST(request: Request, { params }: OrderRepurchaseRouteProps) {
  const session = await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  try {
    const { orderNo } = await params;
    return NextResponse.json({ ok: true, ...(await repurchaseOrderForUser(orderNo, session.userId)) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "ORDER_REPURCHASE_FAILED";
    return NextResponse.json({ ok: false, error: code }, { status: code === "ORDER_NOT_FOUND" ? 404 : 400 });
  }
}

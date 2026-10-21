import { NextResponse } from "next/server";
import { readRequestUserSession } from "@/lib/auth/session";
import { getOrderForUser } from "@/lib/services/order-service";
import { getUserOrderDispatchEstimate } from "@/lib/services/order-dispatch-estimate-service";

const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };
type Props = { params: Promise<{ orderNo: string }> };

export async function GET(request: Request, { params }: Props) {
  const session = await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401, headers });
  try {
    const { orderNo } = await params;
    const order = await getOrderForUser(orderNo, session.userId);
    if (!order) return NextResponse.json({ ok: false, error: "ORDER_NOT_FOUND" }, { status: 404, headers });
    const dispatchEstimate = await getUserOrderDispatchEstimate(order.id, session.userId);
    if (!dispatchEstimate) return NextResponse.json({ ok: false, error: "ORDER_NOT_FOUND" }, { status: 404, headers });
    return NextResponse.json({ ok: true, dispatchEstimate }, { headers });
  } catch (error) {
    const code = error instanceof Error && ["DISPATCH_ESTIMATE_SCHEMA_REQUIRED", "DISPATCH_ESTIMATE_DATABASE_REQUIRED"].includes(error.message) ? error.message : "DISPATCH_ESTIMATE_UNAVAILABLE";
    return NextResponse.json({ ok: false, error: code }, { status: 503, headers });
  }
}

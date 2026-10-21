import { NextResponse } from "next/server";
import { readRequestUserSession } from "@/lib/auth/session";
import { getOrderForUser } from "@/lib/services/order-service";
import { getUserOrderLogistics } from "@/lib/services/wechat-logistics-service";

const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };
type Props = { params: Promise<{ orderNo: string }> };

export async function GET(request: Request, { params }: Props) {
  const session = await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401, headers });
  try {
    const { orderNo } = await params;
    const order = await getOrderForUser(orderNo, session.userId);
    if (!order) return NextResponse.json({ ok: false, error: "ORDER_NOT_FOUND" }, { status: 404, headers });
    const logistics = await getUserOrderLogistics(order.id, session.userId);
    return NextResponse.json({ ok: true, logistics }, { headers });
  } catch {
    return NextResponse.json({ ok: false, error: "WECHAT_LOGISTICS_UNAVAILABLE" }, { status: 503, headers });
  }
}

import { NextResponse } from "next/server";
import { readRequestUserSession } from "@/lib/auth/session";
import { getOrderForUser } from "@/lib/services/order-service";

type AccountOrderProps = {
  params: Promise<{ orderNo: string }>;
};

export async function GET(request: Request, { params }: AccountOrderProps) {
  const session = await readRequestUserSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const { orderNo } = await params;
  const order = await getOrderForUser(orderNo, session.userId);
  if (!order) {
    return NextResponse.json({ ok: false, error: "ORDER_NOT_FOUND" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, order }, { headers: { 'Cache-Control': 'no-store' } });
}

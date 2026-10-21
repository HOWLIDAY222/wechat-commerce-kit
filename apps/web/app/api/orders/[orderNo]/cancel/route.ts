import { NextResponse } from "next/server";
import { readRequestUserSession } from "@/lib/auth/session";
import { cancelOrderForUser } from "@/lib/services/order-service";

type CancelOrderProps = {
  params: Promise<{ orderNo: string }>;
};

export async function POST(request: Request, { params }: CancelOrderProps) {
  const { orderNo } = await params;
  const session = await readRequestUserSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  try {
    const order = await cancelOrderForUser(orderNo, session.userId);
    return NextResponse.json({ ok: true, order });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "ORDER_CANCEL_FAILED" },
      { status: 400 },
    );
  }
}

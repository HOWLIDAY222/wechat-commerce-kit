import { NextResponse } from "next/server";
import { readRequestUserSession } from "@/lib/auth/session";
import { listOrdersByUser } from "@/lib/services/order-service";

export async function GET(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    orders: await listOrdersByUser(session.userId),
  });
}

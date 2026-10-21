import { NextResponse } from "next/server";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { getAdminOrderLogistics } from "@/lib/services/wechat-logistics-service";

export async function GET(_request: Request, { params }: { params: Promise<{ orderNo: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401, headers });
  try {
    const { orderNo } = await params;
    const logistics = await getAdminOrderLogistics(orderNo);
    if (!logistics) return NextResponse.json({ ok: false, error: "ORDER_NOT_FOUND" }, { status: 404, headers });
    return NextResponse.json({ ok: true, logistics }, { headers });
  } catch (error) {
    const missing = error instanceof Error && error.message === "ORDER_NOT_FOUND";
    return NextResponse.json({ ok: false, error: missing ? "ORDER_NOT_FOUND" : "LOGISTICS_STATUS_UNAVAILABLE" }, { status: missing ? 404 : 503, headers });
  }
}

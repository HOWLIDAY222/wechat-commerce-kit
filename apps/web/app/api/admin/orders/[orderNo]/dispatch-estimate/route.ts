import { NextResponse } from "next/server";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { hasSameHostDispatchEstimateOrigin, parseDispatchEstimateInput } from "@/lib/commerce/order-dispatch-estimate";
import { getAdminOrderDispatchEstimate, setOrderDispatchEstimate } from "@/lib/services/order-dispatch-estimate-service";

const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
type Props = { params: Promise<{ orderNo: string }> };

export async function GET(_request: Request, { params }: Props) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401, headers });
  try {
    const { orderNo } = await params;
    const result = await getAdminOrderDispatchEstimate(orderNo);
    if (!result) return NextResponse.json({ ok: false, error: "ORDER_NOT_FOUND" }, { status: 404, headers });
    return NextResponse.json({ ok: true, ...result }, { headers });
  } catch (error) {
    const code = error instanceof Error && ["DISPATCH_ESTIMATE_SCHEMA_REQUIRED", "DISPATCH_ESTIMATE_DATABASE_REQUIRED"].includes(error.message) ? error.message : "DISPATCH_ESTIMATE_UNAVAILABLE";
    return NextResponse.json({ ok: false, error: code }, { status: 503, headers });
  }
}

export async function PUT(request: Request, { params }: Props) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401, headers });
  if (!hasSameHostDispatchEstimateOrigin(request)) return NextResponse.json({ ok: false, error: "INVALID_ORIGIN" }, { status: 403, headers });
  const input = parseDispatchEstimateInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ ok: false, error: "INVALID_DISPATCH_ESTIMATE" }, { status: 400, headers });
  try {
    const { orderNo } = await params;
    return NextResponse.json({ ok: true, ...await setOrderDispatchEstimate(orderNo, input, session.userId) }, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : "DISPATCH_ESTIMATE_SAVE_FAILED";
    const status = code === "ORDER_NOT_FOUND" ? 404 : code === "ADMIN_REQUIRED" ? 403 : ["DISPATCH_ESTIMATE_DATE_IN_PAST", "INVALID_DISPATCH_ESTIMATE"].includes(code) ? 400
      : code === "DISPATCH_ESTIMATE_REVISION_CONFLICT" || code.startsWith("DISPATCH_ESTIMATE_ORDER_") || code === "DISPATCH_ESTIMATE_SHIPMENT_EXISTS" || code === "DISPATCH_ESTIMATE_DIGITAL_GIFT_UNSUPPORTED" ? 409 : 503;
    const safeCode = /^(?:ORDER_NOT_FOUND|ADMIN_REQUIRED|DISPATCH_ESTIMATE_[A-Z_]+)$/.test(code) ? code : "DISPATCH_ESTIMATE_SAVE_FAILED";
    return NextResponse.json({ ok: false, error: safeCode }, { status, headers });
  }
}

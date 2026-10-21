import { after, NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { performAdminOrderAction } from "@/lib/services/order-service";
import { syncPendingWeChatShipments } from "@/lib/services/wechat-shipping-service";
import { syncPendingWeChatLogistics } from "@/lib/services/wechat-logistics-service";

const orderActionSchema = z.object({
  action: z.enum(["confirm", "cancel", "ship", "deliver", "correct_tracking"]),
  trackingCompany: z.string().min(1).max(80).optional(),
  trackingNo: z.string().min(1).max(120).optional(),
  note: z.string().max(500).optional(),
});
type OrderRouteProps = { params: Promise<{ orderNo: string }> };

export async function POST(request: Request, { params }: OrderRouteProps) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  const parsed = orderActionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_ORDER_ACTION" }, { status: 400 });
  try {
    const { orderNo } = await params;
    const order = await performAdminOrderAction(orderNo, parsed.data, session.userId);
    if (["ship", "correct_tracking"].includes(parsed.data.action)) {
      // The committed shipment is the durable queue. The timer also retries if
      // this process exits before the response's background work can finish.
      after(async () => {
        try { await syncPendingWeChatShipments({ orderId: order.id }); }
        catch { console.error("WECHAT_SHIPPING_BACKGROUND_SYNC_FAILED"); }
        // Optional query/messages are isolated from the committed order and the
        // mandatory shipping upload. The independent worker handles new rows.
        try { await syncPendingWeChatLogistics({ orderId: order.id }); }
        catch { console.error("WECHAT_LOGISTICS_BACKGROUND_SYNC_FAILED"); }
      });
    }
    return NextResponse.json({ ok: true, order });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "ORDER_ACTION_FAILED" }, { status: 400 });
  }
}

export async function PATCH() {
  return NextResponse.json({ ok: false, error: "ORDER_STATUS_DIRECT_EDIT_FORBIDDEN" }, { status: 405 });
}

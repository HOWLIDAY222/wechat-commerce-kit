import type { Prisma } from "@prisma/client";
import { parseWeChatPayNotification } from "@/lib/providers/wechat-pay";
import { processWeChatPaymentEvent } from "@/lib/services/wechat-payment-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  try {
    const { event, transaction } = await parseWeChatPayNotification(rawBody, request.headers);
    const rawPayload = {
      body: JSON.parse(rawBody),
      headers: {
        nonce: request.headers.get("wechatpay-nonce"),
        serial: request.headers.get("wechatpay-serial"),
        signature: request.headers.get("wechatpay-signature"),
        timestamp: request.headers.get("wechatpay-timestamp"),
      },
    } as Prisma.InputJsonValue;
    await processWeChatPaymentEvent({
      eventId: event.id,
      eventType: event.event_type,
      rawPayload,
      transaction,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WECHAT_PAY_NOTIFICATION_FAILED";
    console.error("payments.wechat.notify.failed", { error: message });
    return Response.json({ code: "FAIL", message: "notification processing failed" }, { status: 500 });
  }
}

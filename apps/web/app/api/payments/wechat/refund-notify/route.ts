import type { Prisma } from "@prisma/client";
import { parseWeChatPayRefundNotification } from "@/lib/providers/wechat-pay";
import { parseLegacyWeChatRefundNotification, queryVerifiedWeChatRefundCandidate } from "@/lib/providers/wechat-refund-sync";
import { processVerifiedWeChatRefundResult, processWeChatRefundEvent } from "@/lib/services/wechat-refund-service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const legacy = (request.headers.get("content-type") ?? "").toLowerCase().includes("xml") || rawBody.trimStart().startsWith("<");
  try {
    if (legacy) {
      // APIv2 XML decrypts into a discovery candidate, not financial proof.
      // A signed APIv3 GET must confirm it before the database-only writer runs.
      const candidate = parseLegacyWeChatRefundNotification(rawBody);
      const result = await queryVerifiedWeChatRefundCandidate(candidate);
      await processVerifiedWeChatRefundResult(result, { source: "LEGACY_NOTIFY_QUERY", eventId: `refund-v2-query:${result.refund_id}:${result.status}` });
      return legacyResponse(true);
    }
    const { event, refund } = await parseWeChatPayRefundNotification(rawBody, request.headers);
    await processWeChatRefundEvent({
      eventId: event.id,
      eventType: event.event_type,
      refund,
      rawPayload: {
        body: JSON.parse(rawBody),
        headers: {
          nonce: request.headers.get("wechatpay-nonce"),
          serial: request.headers.get("wechatpay-serial"),
          signature: request.headers.get("wechatpay-signature"),
          timestamp: request.headers.get("wechatpay-timestamp"),
        },
      } as Prisma.InputJsonValue,
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("payments.wechat.refund-notify.failed", {
      error: error instanceof Error ? error.message : "WECHAT_PAY_REFUND_NOTIFICATION_FAILED",
    });
    if (legacy) return legacyResponse(false, error instanceof Error && /^[A-Z][A-Z0-9_]{1,150}$/.test(error.message) ? error.message : "REFUND_NOTIFICATION_FAILED");
    return Response.json({ code: "FAIL", message: "refund notification processing failed" }, { status: 500 });
  }
}

function legacyResponse(success: boolean, message = "OK") {
  return new Response(`<xml><return_code><![CDATA[${success ? "SUCCESS" : "FAIL"}]]></return_code><return_msg><![CDATA[${message}]]></return_msg></xml>`, { status: success ? 200 : 500, headers: { "Content-Type": "application/xml; charset=utf-8" } });
}

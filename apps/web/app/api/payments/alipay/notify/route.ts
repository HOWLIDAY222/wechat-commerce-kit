import { NextResponse } from "next/server";
import {
  assertAlipayNotifyShape,
  getAlipayProviderStatus,
  isAlipayNotifySellerMatched,
  parseAlipayNotifyPayload,
  type AlipayNotifyPayload,
  verifyAlipayNotifySignature,
} from "@/lib/providers/alipay";
import { processAlipayPaymentNotify } from "@/lib/services/payment-notify-service";

export async function POST(request: Request) {
  const status = getAlipayProviderStatus();
  if (!status.configured) {
    return NextResponse.json(
      {
        ok: false,
        error: "ALIPAY_PROVIDER_NOT_CONFIGURED",
        missingKeys: status.missingKeys,
      },
      { status: 503 },
    );
  }

  let payload: AlipayNotifyPayload | null = null;

  try {
    payload = parseAlipayNotifyPayload(await request.formData());
    assertAlipayNotifyShape(payload);

    if (!verifyAlipayNotifySignature(payload)) {
      logAlipayNotifyFailure("ALIPAY_NOTIFY_SIGNATURE_INVALID", payload);
      return new Response("fail", { status: 400 });
    }

    if (!isAlipayNotifySellerMatched(payload)) {
      logAlipayNotifyFailure("ALIPAY_NOTIFY_SELLER_ID_MISMATCH", payload);
      return new Response("fail", { status: 400 });
    }

    await processAlipayPaymentNotify(payload);
    return new Response("success", { status: 200 });
  } catch (error) {
    logAlipayNotifyFailure(error instanceof Error ? error.message : "ALIPAY_NOTIFY_FAILED", payload);
    return new Response("fail", { status: 400 });
  }
}

function logAlipayNotifyFailure(error: string, payload: AlipayNotifyPayload | null) {
  console.error("payments.alipay.notify.failed", {
    error,
    orderNo: payload?.orderNo ? maskIdentifier(payload.orderNo) : undefined,
    tradeNo: payload?.tradeNo ? maskIdentifier(payload.tradeNo) : undefined,
    tradeStatus: payload?.tradeStatus || undefined,
    totalAmount: payload?.totalAmount || undefined,
    appId: payload?.appId ? maskIdentifier(payload.appId) : undefined,
    sellerId: payload?.sellerId ? maskIdentifier(payload.sellerId) : undefined,
  });
}

function maskIdentifier(value: string) {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

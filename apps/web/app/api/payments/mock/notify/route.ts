import { NextResponse } from "next/server";
import { z } from "zod";
import { appConfig } from "@/lib/config";
import { verifyMockNotify } from "@/lib/providers/payment";
import { processMockPaymentNotify } from "@/lib/services/payment-notify-service";

const notifySchema = z.object({
  paymentId: z.string(),
  orderNo: z.string(),
  amountCents: z.number().int().positive(),
  appId: z.string().min(1),
  sellerId: z.string().min(1),
  merchantId: z.string().min(1),
  merchantOrderNo: z.string().min(1),
});

export async function POST(request: Request) {
  if (appConfig.PAYMENT_PROVIDER !== "mock") {
    return NextResponse.json({ ok: false, error: "MOCK_PAYMENT_PROVIDER_DISABLED" }, { status: 503 });
  }

  const parsed = notifySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || !verifyMockNotify(parsed.success ? parsed.data : {})) {
    return NextResponse.json({ ok: false, error: "INVALID_MOCK_PAYMENT_NOTIFY" }, { status: 400 });
  }

  try {
    const result = await processMockPaymentNotify(parsed.data);
    return NextResponse.json({
      ok: true,
      verified: true,
      ...result,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "PAYMENT_NOTIFY_PROCESS_FAILED";
    return NextResponse.json({ ok: false, error: code }, { status: code === "ORDER_NOT_FOUND" ? 404 : 400 });
  }
}

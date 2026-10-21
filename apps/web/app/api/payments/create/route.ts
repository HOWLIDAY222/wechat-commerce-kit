import { NextResponse } from "next/server";
import { isDomesticHost, MINI_PROGRAM_PATH } from "@/lib/storefront-market";
import { z } from "zod";
import { readRequestUserSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { createPayment } from "@/lib/providers/payment";
import { getOrderForUser, markOrderPaymentPendingForUser } from "@/lib/services/order-service";

const inputSchema = z.object({
  orderNo: z.string().min(3),
  amountCents: z.number().int().positive(),
  currency: z.literal("CNY").default("CNY"),
});

export async function POST(request: Request) {
  if (isDomesticHost(request.headers.get("host"))) {
    return NextResponse.json({ ok: false, error: "MINIPROGRAM_PURCHASE_REQUIRED", redirectUrl: MINI_PROGRAM_PATH }, { status: 403 });
  }
  const session = await readRequestUserSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_PAYMENT_REQUEST" }, { status: 400 });
  }

  const order = await getOrderForUser(parsed.data.orderNo, session.userId);
  if (!order) {
    return NextResponse.json({ ok: false, error: "ORDER_NOT_FOUND" }, { status: 404 });
  }
  if('kind' in order&&order.kind!=='STANDARD')return NextResponse.json({ok:false,error:'GIFT_WECHAT_PAYMENT_REQUIRED'},{status:400});
  if (order.payableAmountCents !== parsed.data.amountCents) {
    return NextResponse.json({ ok: false, error: "PAYMENT_AMOUNT_MISMATCH" }, { status: 400 });
  }

  try {
    const updatedOrder = await markOrderPaymentPendingForUser(parsed.data.orderNo, session.userId);
    const payment = await createPayment(parsed.data);
    if (appConfig.COMMERCE_STORAGE === "prisma") {
      await prisma.paymentIntent.upsert({
        where: {
          provider_merchantOrderNo: {
            provider: payment.provider === "alipay" ? "ALIPAY" : "MOCK",
            merchantOrderNo: parsed.data.orderNo,
          },
        },
        update: {
          amountCents: parsed.data.amountCents,
          currency: parsed.data.currency,
          method: payment.provider === "alipay" ? "alipay_h5" : "mock",
          redirectUrl: payment.redirectUrl,
          status: "REQUIRES_REDIRECT",
          rawRequest: {
            provider: payment.provider,
            paymentId: payment.paymentId,
          },
        },
        create: {
          orderId: updatedOrder.id,
          provider: payment.provider === "alipay" ? "ALIPAY" : "MOCK",
          method: payment.provider === "alipay" ? "alipay_h5" : "mock",
          status: "REQUIRES_REDIRECT",
          amountCents: parsed.data.amountCents,
          currency: parsed.data.currency,
          merchantOrderNo: parsed.data.orderNo,
          redirectUrl: payment.redirectUrl,
          rawRequest: {
            provider: payment.provider,
            paymentId: payment.paymentId,
          },
        },
      });
    }
    return NextResponse.json({ ok: true, order: updatedOrder, payment });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "PAYMENT_CREATE_FAILED" },
      { status: 400 },
    );
  }
}

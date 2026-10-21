import { NextResponse } from "next/server";
import { z } from "zod";
import { auditEnvelope } from "@/lib/audit";
import { readRequestUserSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import { cancelOrderForUser } from "@/lib/services/order-service";

const cancelSchema = z.object({
  paymentId: z.string().min(1),
  orderNo: z.string().min(1),
  reason: z.string().min(1).default("user_cancelled"),
});

export async function POST(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const parsed = cancelSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_PAYMENT_CANCEL_REQUEST" }, { status: 400 });
  }

  try {
    const order = await cancelOrderForUser(parsed.data.orderNo, session.userId);

    return NextResponse.json({
      ok: true,
      order,
      payment: {
        provider: appConfig.PAYMENT_PROVIDER,
        paymentId: parsed.data.paymentId,
        orderNo: parsed.data.orderNo,
        status: "cancelled",
      },
      audit: auditEnvelope({
        actorId: session.userId,
        actorType: "user",
        action: "payment.user.cancelled",
        targetType: "payment_intent",
        targetId: parsed.data.paymentId,
        detail: parsed.data,
      }),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "PAYMENT_CANCEL_FAILED" },
      { status: 400 },
    );
  }
}

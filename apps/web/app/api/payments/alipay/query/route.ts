import { NextResponse } from "next/server";
import { z } from "zod";
import { readRequestUserSession } from "@/lib/auth/session";
import { queryAlipayTrade } from "@/lib/providers/alipay";
import { getOrderForUser } from "@/lib/services/order-service";
import { processAlipayTradeQueryPaid } from "@/lib/services/payment-notify-service";

const inputSchema = z.object({
  orderNo: z.string().min(3),
});

export async function POST(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_ALIPAY_QUERY_REQUEST" }, { status: 400 });
  }

  const order = await getOrderForUser(parsed.data.orderNo, session.userId);
  if (!order) {
    return NextResponse.json({ ok: false, error: "ORDER_NOT_FOUND" }, { status: 404 });
  }
  if (order.paymentStatus === "PAID") {
    return NextResponse.json({ ok: true, paid: true, order, query: null });
  }

  try {
    const query = await queryAlipayTrade(parsed.data.orderNo);
    if (!query.signatureValid) {
      console.error("payments.alipay.query.failed", {
        error: "ALIPAY_QUERY_SIGNATURE_INVALID",
        orderNo: maskIdentifier(parsed.data.orderNo),
        code: query.code,
        subCode: query.subCode,
      });
      return NextResponse.json({ ok: false, error: "ALIPAY_QUERY_SIGNATURE_INVALID" }, { status: 502 });
    }

    if (!["TRADE_SUCCESS", "TRADE_FINISHED"].includes(query.tradeStatus ?? "")) {
      return NextResponse.json({
        ok: true,
        paid: false,
        order,
        query: sanitizeQuery(query),
      });
    }

    const result = await processAlipayTradeQueryPaid(query);
    return NextResponse.json({
      ok: true,
      paid: true,
      order: result.order,
      query: sanitizeQuery(query),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ALIPAY_QUERY_FAILED";
    console.error("payments.alipay.query.failed", {
      error: message,
      orderNo: maskIdentifier(parsed.data.orderNo),
    });
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

function sanitizeQuery(query: Awaited<ReturnType<typeof queryAlipayTrade>>) {
  return {
    code: query.code,
    msg: query.msg,
    subCode: query.subCode,
    subMsg: query.subMsg,
    orderNo: query.orderNo,
    tradeStatus: query.tradeStatus,
    totalAmount: query.totalAmount,
    signatureValid: query.signatureValid,
    tradeNo: query.tradeNo ? maskIdentifier(query.tradeNo) : undefined,
  };
}

function maskIdentifier(value: string) {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

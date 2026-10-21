import { NextResponse } from "next/server";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { queryAlipayTrade } from "@/lib/providers/alipay";
import { queryWeChatPaymentForUser } from "@/lib/services/wechat-payment-service";
import { listAdminPayments, syncPaymentForAdminFromProvider } from "@/lib/services/admin-ops-service";
import { processAlipayTradeQueryPaid } from "@/lib/services/payment-notify-service";

type PaymentSyncRouteProps = {
  params: Promise<{ paymentId: string }>;
};

export async function POST(_request: Request, { params }: PaymentSyncRouteProps) {
  const session = await readCurrentAdminSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  }

  try {
    const { paymentId } = await params;
    if (appConfig.COMMERCE_STORAGE === "prisma") {
      const wechatPayment = await prisma.paymentIntent.findFirst({ where: { id: paymentId, provider: "WECHAT_PAY" }, include: { order: true } });
      if (wechatPayment) {
        const result = await queryWeChatPaymentForUser(wechatPayment.order.orderNo, wechatPayment.order.userId);
        return NextResponse.json({ ok: true, ...result, query: { provider: "WECHAT_PAY", tradeStatus: result.paid ? "PAID" : "PENDING" } });
      }
    }
    if (appConfig.COMMERCE_STORAGE !== "prisma" || appConfig.PAYMENT_PROVIDER === "mock") {
      const payment = (await listAdminPayments()).find((item) => item.id === paymentId);
      if (!payment) {
        return NextResponse.json({ ok: false, error: "PAYMENT_NOT_FOUND" }, { status: 404 });
      }
      if (payment.status === "PAID" || payment.status === "paid") {
        return NextResponse.json({ ok: true, paid: true, payment, query: { provider: "mock", tradeStatus: "PAID" } });
      }
      const synced = await syncPaymentForAdminFromProvider(
        paymentId,
        { status: "PAID", note: "mock provider query confirmed paid" },
        session.userId,
      );
      return NextResponse.json({ ok: true, paid: true, payment: synced, query: { provider: "mock", tradeStatus: "PAID" } });
    }

    const payment = await prisma.paymentIntent.findUnique({
      where: { id: paymentId },
      include: { order: true },
    });
    if (!payment) {
      return NextResponse.json({ ok: false, error: "PAYMENT_NOT_FOUND" }, { status: 404 });
    }
    if (payment.provider !== "ALIPAY") {
      return NextResponse.json({ ok: false, error: "PAYMENT_PROVIDER_NOT_ALIPAY" }, { status: 400 });
    }
    if (payment.status === "PAID" && payment.order.paymentStatus === "PAID") {
      return NextResponse.json({
        ok: true,
        paid: true,
        payment,
        order: payment.order,
        query: null,
      });
    }

    const query = await queryAlipayTrade(payment.order.orderNo);
    if (!query.signatureValid) {
      console.error("admin.payments.alipay.sync.failed", {
        error: "ALIPAY_QUERY_SIGNATURE_INVALID",
        orderNo: maskIdentifier(payment.order.orderNo),
        code: query.code,
        subCode: query.subCode,
      });
      return NextResponse.json({ ok: false, error: "ALIPAY_QUERY_SIGNATURE_INVALID" }, { status: 502 });
    }

    if (!["TRADE_SUCCESS", "TRADE_FINISHED"].includes(query.tradeStatus ?? "")) {
      return NextResponse.json({
        ok: true,
        paid: false,
        payment,
        order: payment.order,
        query: sanitizeQuery(query),
      });
    }

    const result = await processAlipayTradeQueryPaid(query);
    await prisma.auditLog.create({
      data: {
        actorId: session.userId,
        actorType: "admin",
        action: "admin.payment.alipay.synced",
        targetType: "payment_intent",
        targetId: payment.id,
        detail: {
          orderNo: payment.order.orderNo,
          tradeStatus: query.tradeStatus,
          tradeNo: query.tradeNo,
        },
      },
    });

    return NextResponse.json({
      ok: true,
      paid: true,
      order: result.order,
      query: sanitizeQuery(query),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "ALIPAY_PAYMENT_SYNC_FAILED";
    console.error("admin.payments.alipay.sync.failed", { error: message });
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

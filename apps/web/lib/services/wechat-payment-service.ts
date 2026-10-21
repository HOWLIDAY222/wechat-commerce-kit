import type { Prisma } from "@prisma/client";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import {
  closeWeChatPayOrder,
  createWeChatPayClientParams,
  createWeChatPayJsapiOrder,
  queryWeChatPayOrder,
  type WeChatPayTransaction,
} from "@/lib/providers/wechat-pay";
import { markOrderPaymentPendingForUser } from "@/lib/services/order-service";
import { getWeChatOpenIdForUser } from "@/lib/services/wechat-auth-service";
import { settleOrderInventoryForPayment } from "@/lib/services/payment-inventory-service";

type VerifiedWeChatPaymentEvent = {
  eventId: string;
  eventType: string;
  rawPayload: Prisma.InputJsonValue;
  transaction: WeChatPayTransaction;
};

const WECHAT_PAY_ATTEMPT_TTL_MS = 30 * 60 * 1000;

export async function prepareWeChatPaymentForUser(orderNo: string, userId: string) {
  assertPrismaStorage();
  const order = await prisma.order.findFirst({
    where: { orderNo, userId },
    include: { items: true },
  });
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (["CANCELLED", "CLOSED"].includes(order.status) || order.paymentStatus === "CANCELLED") throw new Error("CANCELLED_ORDER_CANNOT_PAY");
  if (["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(order.paymentStatus)) throw new Error("ORDER_ALREADY_PAID");

  const appId = appConfig.WECHAT_MINIPROGRAM_APP_ID;
  if (!appId) throw new Error("WECHAT_MINIPROGRAM_NOT_CONFIGURED");
  const openId = await getWeChatOpenIdForUser(userId, appId);
  if (!openId) throw new Error("WECHAT_IDENTITY_NOT_FOUND");

  const existing = await findLatestActivePayment(order.id);
  if (existing) {
    const reusablePrepayId = readReusablePrepayId(existing.rawResponse);
    if (reusablePrepayId) {
      return {
        order,
        paymentId: existing.id,
        paymentParams: await createWeChatPayClientParams(reusablePrepayId),
      };
    }

    const resolution = await resolveExistingPaymentAttempt(existing, order.userId);
    if (resolution === "paid") throw new Error("ORDER_ALREADY_PAID");
    if (resolution === "retry-same") return createPrepayForAttempt(order, openId, existing);
  }

  await markOrderPaymentPendingForUser(orderNo, userId);
  const merchantOrderNo = await createNextWeChatMerchantOrderNo(order.id, orderNo);
  const attempt = await createPaymentAttempt(order, merchantOrderNo);
  const existingPrepayId = readReusablePrepayId(attempt.payment.rawResponse);
  if (existingPrepayId) {
    return {
      order,
      paymentId: attempt.payment.id,
      paymentParams: await createWeChatPayClientParams(existingPrepayId),
    };
  }
  if (!attempt.created && attempt.payment.status === "CREATED" && Date.now() - attempt.payment.updatedAt.getTime() < 15_000) {
    throw new Error("WECHAT_PAY_PREPAY_IN_PROGRESS");
  }
  return createPrepayForAttempt(order, openId, attempt.payment);
}

export async function queryWeChatPaymentForUser(orderNo: string, userId: string) {
  assertPrismaStorage();
  const order = await prisma.order.findFirst({ where: { orderNo, userId } });
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(order.paymentStatus)) return { paid: true, order };

  const payment = await prisma.paymentIntent.findFirst({
    where: { orderId: order.id, provider: "WECHAT_PAY" },
    orderBy: { createdAt: "desc" },
  });
  if (!payment) throw new Error("WECHAT_PAY_INTENT_NOT_FOUND");
  const transaction = await queryWeChatPayOrder(payment.merchantOrderNo);
  if (transaction.trade_state !== "SUCCESS") {
    await prisma.paymentIntent.updateMany({
      where: { id: payment.id, status: { in: ["CREATED", "PENDING", "REQUIRES_REDIRECT"] } },
      data: { status: transaction.trade_state === "CLOSED" ? "CANCELLED" : "PENDING", rawResponse: toJson(transaction) },
    });
    return { paid: false, order, tradeState: transaction.trade_state };
  }
  if (!transaction.transaction_id) throw new Error("WECHAT_PAY_TRANSACTION_ID_MISSING");

  const result = await processWeChatPaymentEvent({
    eventId: `query:${transaction.transaction_id}`,
    eventType: "TRANSACTION.QUERY.SUCCESS",
    rawPayload: toJson({ source: "signed_query", transaction }),
    transaction,
  });
  return { paid: result.order.paymentStatus === "PAID", order: result.order, tradeState: transaction.trade_state };
}

export async function processWeChatPaymentEvent(input: VerifiedWeChatPaymentEvent) {
  assertPrismaStorage();
  const payment = await prisma.paymentIntent.findUnique({
    where: {
      provider_merchantOrderNo: {
        provider: "WECHAT_PAY",
        merchantOrderNo: input.transaction.out_trade_no,
      },
    },
    include: { order: true },
  });

  await prisma.paymentNotification.upsert({
    where: { provider_tradeNo: { provider: "WECHAT_PAY", tradeNo: input.eventId } },
    update: {
      orderId: payment?.orderId,
      paymentId: payment?.id,
      rawPayload: input.rawPayload,
      status: `${input.eventType}:${input.transaction.trade_state}`,
      verified: true,
    },
    create: {
      provider: "WECHAT_PAY",
      tradeNo: input.eventId,
      orderId: payment?.orderId,
      paymentId: payment?.id,
      rawPayload: input.rawPayload,
      status: `${input.eventType}:${input.transaction.trade_state}`,
      verified: true,
    },
  });
  if (!payment) throw new Error("WECHAT_PAY_INTENT_NOT_FOUND");
  assertPaymentMatches(payment, input.transaction);

  const appId = appConfig.WECHAT_MINIPROGRAM_APP_ID!;
  const expectedOpenId = await getWeChatOpenIdForUser(payment.order.userId, appId);
  if (!expectedOpenId || input.transaction.payer?.openid !== expectedOpenId) {
    throw new Error("WECHAT_PAY_OPEN_ID_MISMATCH");
  }

  return prisma.$transaction(async (tx) => {
    const notification = await tx.paymentNotification.findUniqueOrThrow({
      where: { provider_tradeNo: { provider: "WECHAT_PAY", tradeNo: input.eventId } },
    });
    const order = await tx.order.findUniqueOrThrow({
      where: { id: payment.orderId },
      include: { items: true },
    });
    if (notification.processedAt) return { processed: false, order };

    if (input.transaction.trade_state !== "SUCCESS") {
      if (["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(order.paymentStatus)) {
        await tx.paymentNotification.update({ where: { id: notification.id }, data: { processedAt: new Date() } });
        return { processed: false, order };
      }
      const terminal = ["CLOSED", "REVOKED", "PAYERROR"].includes(input.transaction.trade_state);
      await tx.paymentIntent.update({
        where: { id: payment.id },
        data: { status: terminal ? "FAILED" : "PENDING", rawResponse: toJson(input.transaction) },
      });
      const updatedOrder = terminal && order.paymentStatus === "PENDING"
        ? await tx.order.update({ where: { id: order.id }, data: { paymentStatus: "FAILED" } })
        : order;
      await tx.paymentNotification.update({ where: { id: notification.id }, data: { processedAt: new Date() } });
      return { processed: true, order: updatedOrder };
    }
    if (!input.transaction.transaction_id) throw new Error("WECHAT_PAY_TRANSACTION_ID_MISSING");

    await tx.paymentIntent.update({
      where: { id: payment.id },
      data: {
        status: "PAID",
        gatewayTradeNo: input.transaction.transaction_id,
        rawResponse: toJson(input.transaction),
      },
    });

    if (order.status === "CANCELLED" || order.status === "CLOSED") {
      const refund = await createCancelledPaymentRefund(tx, order, payment.id);
      await tx.paymentNotification.update({
        where: { id: notification.id },
        data: { processedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorType: "system",
          action: "payment.wechat.notify.cancelled_order",
          targetType: "payment_notification",
          targetId: notification.id,
          detail: { orderNo: order.orderNo, refundNo: refund.refundNo },
        },
      });
      return { processed: true, order };
    }

    await settleOrderInventoryForPayment(tx, order);
    const paidOrder = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(order.paymentStatus)
      ? order
      : await tx.order.update({
          where: { id: order.id },
          data: { paymentStatus: "PAID", ...(order.status === "CREATED" ? { status: "CONFIRMED" } : {}) },
          include: { items: true },
        });
    await tx.paymentNotification.update({ where: { id: notification.id }, data: { processedAt: new Date() } });
    await tx.auditLog.create({
      data: {
        actorType: "system",
        action: "payment.wechat.notify.paid",
        targetType: "payment_notification",
        targetId: notification.id,
        detail: {
          eventId: input.eventId,
          orderNo: order.orderNo,
          transactionId: input.transaction.transaction_id,
        },
      },
    });
    return { processed: true, order: paidOrder };
  }, {
    isolationLevel: "Serializable",
    maxWait: 5_000,
    timeout: 30_000,
  });
}

async function findLatestActivePayment(orderId: string) {
  return prisma.paymentIntent.findFirst({
    where: {
      orderId,
      provider: "WECHAT_PAY",
      status: { in: ["CREATED", "REQUIRES_REDIRECT", "PENDING", "PAID"] },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function resolveExistingPaymentAttempt(
  payment: { id: string; merchantOrderNo: string; status: string; updatedAt: Date },
  userId: string,
) {
  if (payment.status === "CREATED" && Date.now() - payment.updatedAt.getTime() < 15_000) {
    throw new Error("WECHAT_PAY_PREPAY_IN_PROGRESS");
  }

  let transaction: WeChatPayTransaction;
  try {
    transaction = await queryWeChatPayOrder(payment.merchantOrderNo);
  } catch (error) {
    if (isProviderResourceMissing(error)) return "retry-same" as const;
    throw error;
  }

  if (transaction.trade_state === "SUCCESS") {
    if (!transaction.transaction_id) throw new Error("WECHAT_PAY_TRANSACTION_ID_MISSING");
    await processWeChatPaymentEvent({
      eventId: `query:${transaction.transaction_id}`,
      eventType: "TRANSACTION.QUERY.SUCCESS",
      rawPayload: toJson({ source: "signed_query_before_retry", transaction }),
      transaction,
    });
    return "paid" as const;
  }
  if (transaction.trade_state === "CLOSED") {
    await prisma.paymentIntent.update({
      where: { id: payment.id },
      data: { status: "CANCELLED", rawResponse: toJson(transaction) },
    });
    return "closed" as const;
  }
  if (transaction.trade_state !== "NOTPAY") {
    throw new Error("WECHAT_PAY_PREVIOUS_ATTEMPT_UNRESOLVED");
  }

  try {
    await closeWeChatPayOrder(payment.merchantOrderNo);
  } catch (closeError) {
    const resolvedAfterClose = await resolvePaymentAfterUncertainClose(payment.merchantOrderNo);
    if (resolvedAfterClose) return resolvedAfterClose;
    await prisma.auditLog.create({
      data: {
        actorId: userId,
        actorType: "user",
        action: "payment.wechat.close.uncertain",
        targetType: "payment_intent",
        targetId: payment.id,
        detail: {
          merchantOrderNo: payment.merchantOrderNo,
          reason: closeError instanceof Error ? closeError.message : "unknown",
        },
      },
    });
    throw new Error("WECHAT_PAY_CLOSE_CONFIRMATION_REQUIRED");
  }
  await prisma.paymentIntent.update({
    where: { id: payment.id },
    data: { status: "CANCELLED", rawResponse: toJson({ source: "signed_query_then_close", transaction }) },
  });
  return "closed" as const;
}

async function resolvePaymentAfterUncertainClose(merchantOrderNo: string) {
  try {
    const transaction = await queryWeChatPayOrder(merchantOrderNo);
    if (transaction.trade_state === "SUCCESS") {
      if (!transaction.transaction_id) throw new Error("WECHAT_PAY_TRANSACTION_ID_MISSING");
      await processWeChatPaymentEvent({
        eventId: `query:${transaction.transaction_id}`,
        eventType: "TRANSACTION.QUERY.SUCCESS",
        rawPayload: toJson({ source: "signed_query_after_uncertain_close", transaction }),
        transaction,
      });
      return "paid" as const;
    }
    if (transaction.trade_state === "CLOSED") {
      await prisma.paymentIntent.update({
        where: { provider_merchantOrderNo: { provider: "WECHAT_PAY", merchantOrderNo } },
        data: { status: "CANCELLED", rawResponse: toJson(transaction) },
      });
      return "closed" as const;
    }
    return null;
  } catch {
    return null;
  }
}

async function createPrepayForAttempt(
  order: { id: string; payableAmountCents: number; items: Array<{ productName: string }> },
  openId: string,
  payment: { id: string; merchantOrderNo: string },
) {
  const expiresAt = new Date(Date.now() + WECHAT_PAY_ATTEMPT_TTL_MS);
  try {
    const result = await createWeChatPayJsapiOrder({
      amountCents: order.payableAmountCents,
      currency: "CNY",
      description: buildPaymentDescription(order.items),
      expiresAt,
      merchantOrderNo: payment.merchantOrderNo,
      openId,
    });
    await prisma.paymentIntent.update({
      where: { id: payment.id },
      data: {
        status: "REQUIRES_REDIRECT",
        rawResponse: {
          prepayId: result.prepayId,
          prepayCreatedAt: new Date().toISOString(),
          prepayExpiresAt: expiresAt.toISOString(),
        },
      },
    });
    return { order, paymentId: payment.id, paymentParams: result.paymentParams };
  } catch (error) {
    await markPaymentAttemptFailed(payment.id, order.id, error);
    throw error;
  }
}

async function createPaymentAttempt(order: { id: string; orderNo: string; payableAmountCents: number; currency: string }, merchantOrderNo: string) {
  try {
    const payment = await prisma.paymentIntent.create({
      data: {
        orderId: order.id,
        provider: "WECHAT_PAY",
        method: "wechat_jsapi",
        status: "CREATED",
        amountCents: order.payableAmountCents,
        currency: order.currency,
        merchantOrderNo,
        rawRequest: { channel: "wechat-miniprogram", orderNo: order.orderNo },
      },
    });
    return { created: true as const, payment };
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const payment = await prisma.paymentIntent.findUniqueOrThrow({
      where: { provider_merchantOrderNo: { provider: "WECHAT_PAY", merchantOrderNo } },
    });
    return { created: false as const, payment };
  }
}

async function markPaymentAttemptFailed(paymentId: string, orderId: string, error: unknown) {
  const reason = error instanceof Error ? error.message : "WECHAT_PAY_PREPAY_FAILED";
  await prisma.$transaction(async (tx) => {
    await tx.paymentIntent.update({
      where: { id: paymentId },
      data: { status: "PENDING", rawResponse: { error: reason, retryWithSameMerchantOrderNo: true } },
    }).catch(() => null);
    await tx.auditLog.create({
      data: {
        actorType: "system",
        action: "payment.wechat.prepay.uncertain",
        targetType: "payment_intent",
        targetId: paymentId,
        detail: { reason, orderId },
      },
    });
  });
}

async function createCancelledPaymentRefund(
  tx: Prisma.TransactionClient,
  order: { id: string; payableAmountCents: number },
  paymentId: string,
) {
  const reason = "WECHAT_PAYMENT_AFTER_CANCELLED_ORDER";
  const existing = await tx.refund.findFirst({ where: { orderId: order.id, paymentId, reason } });
  if (existing) return existing;
  const count = await tx.refund.count();
  const now = new Date();
  return tx.refund.create({
    data: {
      orderId: order.id,
      paymentId,
      refundNo: `RF${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(count + 1).padStart(5, "0")}`,
      refundAmountCents: order.payableAmountCents,
      refundStatus: "CREATED",
      reason,
    },
  });
}

function assertPaymentMatches(
  payment: { amountCents: number; currency: string; merchantOrderNo: string; order: { payableAmountCents: number } },
  transaction: WeChatPayTransaction,
) {
  if (transaction.out_trade_no !== payment.merchantOrderNo) throw new Error("WECHAT_PAY_ORDER_NO_MISMATCH");
  if (transaction.amount.total !== payment.amountCents || transaction.amount.total !== payment.order.payableAmountCents) {
    throw new Error("PAYMENT_AMOUNT_MISMATCH");
  }
  if (transaction.amount.currency !== payment.currency) throw new Error("WECHAT_PAY_CURRENCY_MISMATCH");
}

function readReusablePrepayId(value: Prisma.JsonValue | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const object = value as Prisma.JsonObject;
  const prepayId = object.prepayId;
  const expiresAt = object.prepayExpiresAt;
  if (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) {
    return "";
  }
  return typeof prepayId === "string" ? prepayId : "";
}

async function createNextWeChatMerchantOrderNo(orderId: string, orderNo: string) {
  const count = await prisma.paymentIntent.count({ where: { orderId, provider: "WECHAT_PAY" } });
  return `${orderNo}W${(count + 1).toString(36).toUpperCase()}`.slice(0, 32);
}

function buildPaymentDescription(items: Array<{ productName: string }>) {
  const first = items[0]?.productName || "商品";
  return `MerchantKit ${first}${items.length > 1 ? ` 等${items.length}件` : ""}`;
}

function assertPrismaStorage() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") throw new Error("WECHAT_PAY_REQUIRES_PRISMA");
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function isProviderResourceMissing(error: unknown) {
  return error instanceof Error && [
    "WECHAT_PAY_API_ORDER_NOT_EXIST",
    "WECHAT_PAY_API_RESOURCE_NOT_EXISTS",
  ].includes(error.message);
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

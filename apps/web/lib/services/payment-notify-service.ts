import { auditEnvelope } from "@/lib/audit";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import type { AlipayNotifyPayload, AlipayTradeQueryResult } from "@/lib/providers/alipay";
import { assertMockNotifyIdentity } from "@/lib/providers/payment";
import { getRuntimeOrder, markRuntimeOrderPaid } from "@/lib/runtime-commerce";
import type { Prisma } from "@prisma/client";
import { settleOrderInventoryForPayment } from "@/lib/services/payment-inventory-service";

type MockNotifyInput = {
  paymentId: string;
  orderNo: string;
  amountCents: number;
  appId: string;
  sellerId: string;
  merchantId: string;
  merchantOrderNo: string;
};

const globalForPaymentNotifications = globalThis as typeof globalThis & {
  __merchantkitRuntimeProcessedPaymentNotifications?: Set<string>;
};

const runtimeProcessedPaymentNotifications =
  globalForPaymentNotifications.__merchantkitRuntimeProcessedPaymentNotifications ?? new Set<string>();
globalForPaymentNotifications.__merchantkitRuntimeProcessedPaymentNotifications = runtimeProcessedPaymentNotifications;

export async function processMockPaymentNotify(input: MockNotifyInput) {
  assertMockNotifyIdentity(input);

  if (appConfig.COMMERCE_STORAGE === "prisma") {
    return processPrismaMockPaymentNotify(input);
  }

  const order = getRuntimeOrder(input.orderNo);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (order.payableAmountCents !== input.amountCents) throw new Error("PAYMENT_AMOUNT_MISMATCH");
  if (runtimeProcessedPaymentNotifications.has(input.paymentId)) {
    return {
      storage: "runtime" as const,
      processed: false,
      idempotencyKey: input.paymentId,
      order,
      audit: auditEnvelope({
        actorType: "system",
        action: "payment.mock.notify.duplicate",
        targetType: "payment_intent",
        targetId: input.paymentId,
        detail: input,
      }),
    };
  }

  runtimeProcessedPaymentNotifications.add(input.paymentId);

  return {
    storage: "runtime" as const,
    processed: true,
    idempotencyKey: input.paymentId,
    order: markRuntimeOrderPaid(input.orderNo),
    audit: auditEnvelope({
      actorType: "system",
      action: "payment.mock.notify",
      targetType: "payment_intent",
      targetId: input.paymentId,
      detail: input,
    }),
  };
}

export async function processAlipayPaymentNotify(input: AlipayNotifyPayload) {
  const amountCents = Math.round(Number(input.totalAmount) * 100);
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("ALIPAY_NOTIFY_AMOUNT_INVALID");

  if (appConfig.COMMERCE_STORAGE === "prisma") {
    return prisma.$transaction(async (tx) => {
      const existingNotification = await tx.paymentNotification.findUnique({
        where: {
          provider_tradeNo: {
            provider: "ALIPAY",
            tradeNo: input.tradeNo,
          },
        },
        include: { order: true },
      });

      if (existingNotification?.processedAt && existingNotification.order) {
        const order = await repairProcessedAlipayNotification(tx, {
          action: "payment.alipay.notify.idempotent_repaired",
          amountCents,
          order: existingNotification.order,
          raw: input.raw,
          status: input.tradeStatus,
          tradeNo: input.tradeNo,
        });
        return {
          storage: "prisma" as const,
          processed: false,
          idempotencyKey: input.tradeNo,
          order,
        };
      }

      const order = await tx.order.findUnique({
        where: { orderNo: input.orderNo },
      });
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.payableAmountCents !== amountCents) throw new Error("PAYMENT_AMOUNT_MISMATCH");

      const payment = await tx.paymentIntent.upsert({
        where: {
          provider_merchantOrderNo: {
            provider: "ALIPAY",
            merchantOrderNo: input.orderNo,
          },
        },
        update: {
          status: "PAID",
          amountCents,
          gatewayTradeNo: input.tradeNo,
          rawResponse: input.raw,
        },
        create: {
          orderId: order.id,
          provider: "ALIPAY",
          method: "alipay_h5",
          status: "PAID",
          amountCents,
          merchantOrderNo: input.orderNo,
          gatewayTradeNo: input.tradeNo,
          rawResponse: input.raw,
        },
      });

      if (order.status === "CANCELLED") {
        const notification = await tx.paymentNotification.upsert({
          where: {
            provider_tradeNo: {
              provider: "ALIPAY",
              tradeNo: input.tradeNo,
            },
          },
          update: {
            orderId: order.id,
            paymentId: payment.id,
            status: input.tradeStatus,
            rawPayload: input.raw,
            verified: true,
            processedAt: new Date(),
          },
          create: {
            provider: "ALIPAY",
            tradeNo: input.tradeNo,
            orderId: order.id,
            paymentId: payment.id,
            status: input.tradeStatus,
            rawPayload: input.raw,
            verified: true,
            processedAt: new Date(),
          },
        });
        const refund = await createCancelledOrderPaymentRefund(tx, {
          amountCents,
          orderId: order.id,
          paymentId: payment.id,
          reason: "ALIPAY_PAYMENT_AFTER_CANCELLED_ORDER",
        });
        await tx.auditLog.create({
          data: {
            actorType: "system",
            action: "payment.alipay.notify.cancelled_order",
            targetType: "payment_notification",
            targetId: notification.id,
            detail: { orderNo: input.orderNo, tradeNo: input.tradeNo, refundNo: refund.refundNo },
          },
        });

        return {
          storage: "prisma" as const,
          processed: true,
          idempotencyKey: input.tradeNo,
          order,
        };
      }

      if (!isSettledPaymentStatus(order.paymentStatus)) await settleOrderInventoryForPayment(tx, order);
      const paidOrder = order.paymentStatus === "REFUNDED"
        ? order
        : await tx.order.update({
            where: { id: order.id },
            data: buildPaidOrderUpdateData(order),
          });

      const notification = await tx.paymentNotification.upsert({
        where: {
          provider_tradeNo: {
            provider: "ALIPAY",
            tradeNo: input.tradeNo,
          },
        },
        update: {
          orderId: order.id,
          paymentId: payment.id,
          status: input.tradeStatus,
          rawPayload: input.raw,
          verified: true,
          processedAt: new Date(),
        },
        create: {
          provider: "ALIPAY",
          tradeNo: input.tradeNo,
          orderId: order.id,
          paymentId: payment.id,
          status: input.tradeStatus,
          rawPayload: input.raw,
          verified: true,
          processedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          actorType: "system",
          action: "payment.alipay.notify",
          targetType: "payment_notification",
          targetId: notification.id,
          detail: { orderNo: input.orderNo, tradeNo: input.tradeNo },
        },
      });

      return {
        storage: "prisma" as const,
        processed: true,
        idempotencyKey: input.tradeNo,
        order: paidOrder,
      };
    });
  }

  const order = getRuntimeOrder(input.orderNo);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (order.payableAmountCents !== amountCents) throw new Error("PAYMENT_AMOUNT_MISMATCH");
  if (runtimeProcessedPaymentNotifications.has(input.tradeNo)) {
    return {
      storage: "runtime" as const,
      processed: false,
      idempotencyKey: input.tradeNo,
      order,
    };
  }
  runtimeProcessedPaymentNotifications.add(input.tradeNo);
  return {
    storage: "runtime" as const,
    processed: true,
    idempotencyKey: input.tradeNo,
    order: markRuntimeOrderPaid(input.orderNo),
  };
}

export async function processAlipayTradeQueryPaid(input: AlipayTradeQueryResult) {
  if (!input.signatureValid) throw new Error("ALIPAY_QUERY_SIGNATURE_INVALID");
  if (!["TRADE_SUCCESS", "TRADE_FINISHED"].includes(input.tradeStatus ?? "")) {
    throw new Error("ALIPAY_QUERY_TRADE_NOT_PAID");
  }
  if (!input.tradeNo || !input.totalAmount) throw new Error("ALIPAY_QUERY_PAYMENT_MISSING");

  const amountCents = Math.round(Number(input.totalAmount) * 100);
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("ALIPAY_QUERY_AMOUNT_INVALID");

  if (appConfig.COMMERCE_STORAGE === "prisma") {
    const raw = JSON.parse(JSON.stringify(input.raw)) as Prisma.InputJsonValue;

    return prisma.$transaction(async (tx) => {
      const existingNotification = await tx.paymentNotification.findUnique({
        where: {
          provider_tradeNo: {
            provider: "ALIPAY",
            tradeNo: input.tradeNo!,
          },
        },
        include: { order: true },
      });

      if (existingNotification?.processedAt && existingNotification.order) {
        const order = await repairProcessedAlipayNotification(tx, {
          action: "payment.alipay.query.idempotent_repaired",
          amountCents,
          order: existingNotification.order,
          raw,
          status: input.tradeStatus!,
          tradeNo: input.tradeNo!,
        });
        return {
          storage: "prisma" as const,
          processed: false,
          idempotencyKey: input.tradeNo!,
          order,
        };
      }

      const order = await tx.order.findUnique({
        where: { orderNo: input.orderNo },
      });
      if (!order) throw new Error("ORDER_NOT_FOUND");
      if (order.payableAmountCents !== amountCents) throw new Error("PAYMENT_AMOUNT_MISMATCH");

      const payment = await tx.paymentIntent.upsert({
        where: {
          provider_merchantOrderNo: {
            provider: "ALIPAY",
            merchantOrderNo: input.orderNo,
          },
        },
        update: {
          status: "PAID",
          amountCents,
          gatewayTradeNo: input.tradeNo,
          rawResponse: raw,
        },
        create: {
          orderId: order.id,
          provider: "ALIPAY",
          method: "alipay_h5",
          status: "PAID",
          amountCents,
          merchantOrderNo: input.orderNo,
          gatewayTradeNo: input.tradeNo,
          rawResponse: raw,
        },
      });

      if (order.status === "CANCELLED") {
        const notification = await tx.paymentNotification.upsert({
          where: {
            provider_tradeNo: {
              provider: "ALIPAY",
              tradeNo: input.tradeNo!,
            },
          },
          update: {
            orderId: order.id,
            paymentId: payment.id,
            status: input.tradeStatus!,
            rawPayload: raw,
            verified: true,
            processedAt: new Date(),
          },
          create: {
            provider: "ALIPAY",
            tradeNo: input.tradeNo!,
            orderId: order.id,
            paymentId: payment.id,
            status: input.tradeStatus!,
            rawPayload: raw,
            verified: true,
            processedAt: new Date(),
          },
        });
        const refund = await createCancelledOrderPaymentRefund(tx, {
          amountCents,
          orderId: order.id,
          paymentId: payment.id,
          reason: "ALIPAY_PAYMENT_AFTER_CANCELLED_ORDER",
        });
        await tx.auditLog.create({
          data: {
            actorType: "system",
            action: "payment.alipay.query.cancelled_order",
            targetType: "payment_notification",
            targetId: notification.id,
            detail: { orderNo: input.orderNo, tradeNo: input.tradeNo, refundNo: refund.refundNo },
          },
        });

        return {
          storage: "prisma" as const,
          processed: true,
          idempotencyKey: input.tradeNo!,
          order,
        };
      }

      if (!isSettledPaymentStatus(order.paymentStatus)) await settleOrderInventoryForPayment(tx, order);
      const paidOrder = order.paymentStatus === "REFUNDED"
        ? order
        : await tx.order.update({
            where: { id: order.id },
            data: buildPaidOrderUpdateData(order),
          });

      const notification = await tx.paymentNotification.upsert({
        where: {
          provider_tradeNo: {
            provider: "ALIPAY",
            tradeNo: input.tradeNo!,
          },
        },
        update: {
          orderId: order.id,
          paymentId: payment.id,
          status: input.tradeStatus!,
          rawPayload: raw,
          verified: true,
          processedAt: new Date(),
        },
        create: {
          provider: "ALIPAY",
          tradeNo: input.tradeNo!,
          orderId: order.id,
          paymentId: payment.id,
          status: input.tradeStatus!,
          rawPayload: raw,
          verified: true,
          processedAt: new Date(),
        },
      });

      await tx.auditLog.create({
        data: {
          actorType: "system",
          action: "payment.alipay.query.paid",
          targetType: "payment_notification",
          targetId: notification.id,
          detail: { orderNo: input.orderNo, tradeNo: input.tradeNo },
        },
      });

      return {
        storage: "prisma" as const,
        processed: true,
        idempotencyKey: input.tradeNo!,
        order: paidOrder,
      };
    });
  }

  const order = getRuntimeOrder(input.orderNo);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (order.payableAmountCents !== amountCents) throw new Error("PAYMENT_AMOUNT_MISMATCH");
  if (runtimeProcessedPaymentNotifications.has(input.tradeNo)) {
    return {
      storage: "runtime" as const,
      processed: false,
      idempotencyKey: input.tradeNo,
      order,
    };
  }
  runtimeProcessedPaymentNotifications.add(input.tradeNo);
  return {
    storage: "runtime" as const,
    processed: true,
    idempotencyKey: input.tradeNo,
    order: markRuntimeOrderPaid(input.orderNo),
  };
}

async function processPrismaMockPaymentNotify(input: MockNotifyInput) {
  return prisma.$transaction(async (tx) => {
    const existingNotification = await tx.paymentNotification.findUnique({
      where: {
        provider_tradeNo: {
          provider: "MOCK",
          tradeNo: input.paymentId,
        },
      },
      include: {
        order: true,
      },
    });

    if (existingNotification?.processedAt && existingNotification.order) {
      return {
        storage: "prisma" as const,
        processed: false,
        idempotencyKey: input.paymentId,
        order: existingNotification.order,
        audit: auditEnvelope({
          actorType: "system",
          action: "payment.mock.notify.duplicate",
          targetType: "payment_notification",
          targetId: existingNotification.id,
          detail: input,
        }),
      };
    }

    const order = await tx.order.findUnique({
      where: { orderNo: input.orderNo },
    });
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (order.payableAmountCents !== input.amountCents) throw new Error("PAYMENT_AMOUNT_MISMATCH");

    const payment = await tx.paymentIntent.upsert({
      where: {
        provider_merchantOrderNo: {
          provider: "MOCK",
          merchantOrderNo: input.orderNo,
        },
      },
      update: {
        status: "PAID",
        amountCents: input.amountCents,
        gatewayTradeNo: input.paymentId,
        rawResponse: input,
      },
      create: {
        orderId: order.id,
        provider: "MOCK",
        method: "mock",
        status: "PAID",
        amountCents: input.amountCents,
        merchantOrderNo: input.orderNo,
        gatewayTradeNo: input.paymentId,
        rawResponse: input,
      },
    });

    if (!isSettledPaymentStatus(order.paymentStatus)) await settleOrderInventoryForPayment(tx, order);
    const paidOrder = order.paymentStatus === "REFUNDED"
      ? order
      : await tx.order.update({
          where: { id: order.id },
          data: buildPaidOrderUpdateData(order),
        });

    const notification = await tx.paymentNotification.upsert({
      where: {
        provider_tradeNo: {
          provider: "MOCK",
          tradeNo: input.paymentId,
        },
      },
      update: {
        orderId: order.id,
        paymentId: payment.id,
        status: "TRADE_SUCCESS",
        rawPayload: input,
        verified: true,
        processedAt: new Date(),
      },
      create: {
        provider: "MOCK",
        tradeNo: input.paymentId,
        orderId: order.id,
        paymentId: payment.id,
        status: "TRADE_SUCCESS",
        rawPayload: input,
        verified: true,
        processedAt: new Date(),
      },
    });

    await tx.auditLog.create({
      data: {
        actorType: "system",
        action: "payment.mock.notify",
        targetType: "payment_notification",
        targetId: notification.id,
        detail: input,
      },
    });

    return {
      storage: "prisma" as const,
      processed: true,
      idempotencyKey: input.paymentId,
      order: paidOrder,
      audit: auditEnvelope({
        actorType: "system",
        action: "payment.mock.notify",
        targetType: "payment_notification",
        targetId: notification.id,
        detail: input,
      }),
    };
  });
}

async function repairProcessedAlipayNotification(
  tx: Prisma.TransactionClient,
  input: {
    action: string;
    amountCents: number;
    order: {
      id: string;
      orderNo: string;
      paymentStatus: string;
      status: string;
    };
    raw: Prisma.InputJsonValue;
    status: string;
    tradeNo: string;
  },
) {
  const payment = await tx.paymentIntent.upsert({
    where: {
      provider_merchantOrderNo: {
        provider: "ALIPAY",
        merchantOrderNo: input.order.orderNo,
      },
    },
    update: {
      amountCents: input.amountCents,
      gatewayTradeNo: input.tradeNo,
      rawResponse: input.raw,
      status: "PAID",
    },
    create: {
      amountCents: input.amountCents,
      gatewayTradeNo: input.tradeNo,
      merchantOrderNo: input.order.orderNo,
      method: "alipay_h5",
      orderId: input.order.id,
      provider: "ALIPAY",
      rawResponse: input.raw,
      status: "PAID",
    },
  });

  await tx.paymentNotification.updateMany({
    where: {
      provider: "ALIPAY",
      tradeNo: input.tradeNo,
    },
    data: {
      orderId: input.order.id,
      paymentId: payment.id,
      rawPayload: input.raw,
      status: input.status,
      verified: true,
    },
  });

  if (input.order.status === "CANCELLED") {
    const refund = await createCancelledOrderPaymentRefund(tx, {
      amountCents: input.amountCents,
      orderId: input.order.id,
      paymentId: payment.id,
      reason: "ALIPAY_PAYMENT_AFTER_CANCELLED_ORDER",
    });
    await tx.auditLog.create({
      data: {
        actorType: "system",
        action: input.action,
        targetType: "payment_notification",
        targetId: input.tradeNo,
        detail: {
          orderNo: input.order.orderNo,
          paymentStatus: input.order.paymentStatus,
          refundNo: refund.refundNo,
          repaired: input.order.paymentStatus !== "PAID",
          tradeNo: input.tradeNo,
        },
      },
    });
    return input.order;
  }

  const needsOrderRepair = !isSettledPaymentStatus(input.order.paymentStatus)
    || (input.order.paymentStatus !== "REFUNDED" && input.order.status === "CREATED");
  let repairedOrder = input.order;
  if (needsOrderRepair) {
    const { userId } = await tx.order.findUniqueOrThrow({
      where: { id: input.order.id },
      select: { userId: true },
    });
    await settleOrderInventoryForPayment(tx, {
      id: input.order.id,
      orderNo: input.order.orderNo,
      userId,
    });
    repairedOrder = await tx.order.update({
      where: { id: input.order.id },
      data: buildPaidOrderUpdateData(input.order),
    });
  }

  if (needsOrderRepair) {
    await tx.auditLog.create({
      data: {
        actorType: "system",
        action: input.action,
        targetType: "payment_notification",
        targetId: input.tradeNo,
        detail: {
          after: {
            paymentStatus: repairedOrder.paymentStatus,
            status: repairedOrder.status,
          },
          before: {
            paymentStatus: input.order.paymentStatus,
            status: input.order.status,
          },
          orderNo: input.order.orderNo,
          tradeNo: input.tradeNo,
        },
      },
    });
  }

  return repairedOrder;
}

function buildPaidOrderUpdateData(order: { status: string }): Prisma.OrderUpdateInput {
  const data: Prisma.OrderUpdateInput = { paymentStatus: "PAID" };
  if (isConfirmablePaidOrderStatus(order.status)) {
    data.status = "CONFIRMED";
  }
  return data;
}

function isSettledPaymentStatus(status: string) {
  return status === "PAID" || status === "REFUNDED";
}

function isConfirmablePaidOrderStatus(status: string) {
  return !["CONFIRMED", "CANCELLED", "CLOSED"].includes(status.toUpperCase());
}

async function createCancelledOrderPaymentRefund(
  tx: Prisma.TransactionClient,
  input: {
    amountCents: number;
    orderId: string;
    paymentId: string;
    reason: string;
  },
) {
  const existingRefund = await tx.refund.findFirst({
    where: {
      orderId: input.orderId,
      paymentId: input.paymentId,
      reason: input.reason,
    },
  });
  if (existingRefund) return existingRefund;

  return tx.refund.create({
    data: {
      orderId: input.orderId,
      paymentId: input.paymentId,
      refundNo: await createPaymentConflictRefundNo(tx),
      refundAmountCents: input.amountCents,
      refundStatus: "CREATED",
      reason: input.reason,
    },
  });
}

async function createPaymentConflictRefundNo(tx: Prisma.TransactionClient) {
  const now = new Date();
  const count = await tx.refund.count();
  return `RF${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(count + 1).padStart(5, "0")}`;
}

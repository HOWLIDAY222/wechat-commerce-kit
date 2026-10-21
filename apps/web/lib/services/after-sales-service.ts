import { getOrderRefundSummary } from "@/lib/services/wechat-refund-read-model";
import {reverseRefundPoints} from "@/lib/services/member-points-service";
import { calculateAfterSalesLines } from "@/lib/commerce/after-sales-eligibility";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { assertAfterSalesTransition, type AfterSalesStatus } from "@/lib/after-sales/state-machine";
import { requestAlipayRefund } from "@/lib/providers/alipay";
import { writeRuntimeAdminAudit } from "@/lib/services/admin-ops-service";
import type { Prisma } from "@prisma/client";
import { executeWeChatRefundForAdmin } from "@/lib/services/wechat-refund-service";
import { hasActualShipment, requiresReturnReceipt } from "@/lib/commerce/refunded-order-lifecycle";
import { tryReconcileRefundedOrderLifecycle } from "@/lib/services/refunded-order-lifecycle-service";
import {
  addRuntimeAfterSalesImage,
  completeRuntimeAfterSalesRefund,
  createRuntimeAfterSalesRequest,
  getRuntimeAfterSalesForUser,
  listAllRuntimeAfterSales,
  listRuntimeRefunds,
  listRuntimeReshipments,
  listRuntimeAfterSalesByUser,
  updateRuntimeRefundForAdmin,
  updateRuntimeAfterSalesStatus,
  updateRuntimeReshipmentForAdmin,
  type RuntimeAfterSalesType,
  type RuntimeReshipmentStatus,
} from "@/lib/runtime-commerce";

type AfterSalesCreateInput = {
  orderNo: string;
  type: RuntimeAfterSalesType;
  reason: string;
  description: string;
  items: Array<{ orderItemId: string; quantity: number }>;
  imageUrls?: string[];
};

type AfterSalesTransitionInput = {
  status: AfterSalesStatus;
  actorId: string;
  actorType: "admin" | "system";
  rejectReason?: string;
  returnAddress?: string;
  detail?: unknown;
};

type ReshipmentUpdateInput = {
  status?: "PROCESSING" | "SHIPPED" | "DELIVERED" | "RETURNED";
  trackingCompany?: string;
  trackingNo?: string;
  note?: string;
};

export type ReshipmentActionInput = {
  action: "ship" | "deliver" | "mark-returned";
  trackingCompany?: string;
  trackingNo?: string;
  note?: string;
};

type RefundUpdateInput = {
  paymentRefundId?: string;
  failureReason?: string;
  note?: string;
};

const typeToDb = {
  return_refund: "RETURN_REFUND",
  exchange: "EXCHANGE",
  refund_only: "REFUND_ONLY",
  reship: "RESHIP",
  quality_issue: "QUALITY_ISSUE",
} as const;

const typeFromDb = {
  RETURN_REFUND: "return_refund",
  EXCHANGE: "exchange",
  REFUND_ONLY: "refund_only",
  RESHIP: "reship",
  QUALITY_ISSUE: "quality_issue",
} as const;

const statusToDb = {
  submitted: "SUBMITTED",
  reviewing: "REVIEWING",
  approved: "APPROVED",
  rejected: "REJECTED",
  waiting_return: "WAITING_RETURN",
  return_in_transit: "RETURN_IN_TRANSIT",
  received: "RECEIVED",
  inspecting: "INSPECTING",
  refund_processing: "REFUND_PROCESSING",
  refunded: "REFUNDED",
  exchange_shipping: "EXCHANGE_SHIPPING",
  reshipped: "RESHIPPED",
  completed: "COMPLETED",
  cancelled: "CANCELLED",
} as const;

const statusFromDb = {
  SUBMITTED: "submitted",
  REVIEWING: "reviewing",
  APPROVED: "approved",
  REJECTED: "rejected",
  WAITING_RETURN: "waiting_return",
  RETURN_IN_TRANSIT: "return_in_transit",
  RECEIVED: "received",
  INSPECTING: "inspecting",
  REFUND_PROCESSING: "refund_processing",
  REFUNDED: "refunded",
  EXCHANGE_SHIPPING: "exchange_shipping",
  RESHIPPED: "reshipped",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
} as const;

const afterSalesInclude = {
  order: true,
  items: true,
  images: true,
  refunds: true,
  messages: { orderBy: { createdAt: "asc" as const } },
} as const;

const afterSalesStatusLabels: Record<AfterSalesStatus, string> = {
  submitted: "已提交",
  reviewing: "审核中",
  approved: "已通过",
  rejected: "已驳回",
  waiting_return: "等待寄回",
  return_in_transit: "寄回途中",
  received: "已收货",
  inspecting: "检验中",
  refund_processing: "退款处理中",
  refunded: "已退款",
  exchange_shipping: "换货发出中",
  reshipped: "已补发",
  completed: "售后已完成",
  cancelled: "已取消",
};

export async function createAfterSalesRequest(userId: string, input: AfterSalesCreateInput) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") return createRuntimeAfterSalesRequest(userId, input);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM orders WHERE order_no = ${input.orderNo} AND user_id = ${userId} FOR UPDATE`;
    const order = await tx.order.findFirst({
      where: { orderNo: input.orderNo, userId },
      include: { items: true },
    });
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (["CLOSED", "CANCELLED"].includes(order.status)) throw new Error("CLOSED_ORDER_AFTER_SALES_FORBIDDEN");
    if(order.kind==='GIFT_PURCHASE')throw Error('GIFT_PURCHASE_USE_GIFT_WALLET');
    if(order.kind==='GIFT_REDEMPTION'&&['refund_only','return_refund'].includes(input.type))throw Error('GIFT_REFUND_CONTACT_SERVICE');
    if (order.paymentStatus !== "PAID") throw new Error("UNPAID_ORDER_AFTER_SALES_FORBIDDEN");
    if (input.type !== "refund_only" && order.fulfillmentStatus !== "DELIVERED") {
      throw new Error("ORDER_NOT_DELIVERED_AFTER_SALES_FORBIDDEN");
    }
    const previous = await tx.afterSalesItem.findMany({
      where: { orderItemId: { in: input.items.map(item => item.orderItemId) } },
      include: { afterSales: { select: { status: true, refunds: { select: { refundStatus: true } } } } },
    });
    const requestItems = calculateAfterSalesLines(order.items, input.items, previous);
    const refundAmountCents = requestItems.reduce((total, item) => total + item.refundAmountCents, 0);
    if (refundAmountCents > order.payableAmountCents) throw new Error("REFUND_AMOUNT_EXCEEDS_ORDER");
    for (const imageUrl of input.imageUrls ?? []) assertTrustedEvidenceUrl(imageUrl);

    const afterSalesNo = await createAfterSalesNo(tx.afterSalesRequest.count.bind(tx.afterSalesRequest));
    const request = await tx.afterSalesRequest.create({
      data: {
        afterSalesNo,
        userId,
        orderId: order.id,
        type: typeToDb[input.type],
        reason: input.reason,
        description: input.description,
        refundAmountCents,
        items: {
          create: requestItems.map(({ orderItem, quantity, refundAmountCents: itemRefundAmountCents }) => ({
            orderItemId: orderItem.id,
            productId: orderItem.productId,
            skuId: orderItem.skuId,
            productName: orderItem.productName,
            color: orderItem.color,
            size: orderItem.size,
            quantity,
            unitPriceCents: orderItem.unitPriceCents,
            refundAmountCents: itemRefundAmountCents,
          })),
        },
        images: {
          create: (input.imageUrls ?? []).map((imageUrl) => ({ imageUrl })),
        },
      },
      include: afterSalesInclude,
    });

    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorType: "user",
        action: "after_sales.created",
        targetType: "after_sales_request",
        targetId: request.id,
        detail: { afterSalesNo },
      },
    });

    return normalizeAfterSales(request);
  }, { isolationLevel: "Serializable" });
}

export async function listAfterSalesByUser(userId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") return listRuntimeAfterSalesByUser(userId);

  const requests = await prisma.afterSalesRequest.findMany({
    where: { userId },
    include: afterSalesInclude,
    orderBy: { createdAt: "desc" },
  });
  return requests.map(normalizeAfterSales);
}

export async function getAfterSalesForUser(afterSalesNo: string, userId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") return getRuntimeAfterSalesForUser(afterSalesNo, userId);

  const request = await prisma.afterSalesRequest.findFirst({
    where: { afterSalesNo, userId },
    include: afterSalesInclude,
  });
  return request ? { ...normalizeAfterSales(request), refundSummary: await getOrderRefundSummary(request.orderId) } : null;
}

export async function listAllAfterSales() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") return listAllRuntimeAfterSales();

  const requests = await prisma.afterSalesRequest.findMany({
    include: afterSalesInclude,
    orderBy: { createdAt: "desc" },
  });
  return requests.map(normalizeAfterSales);
}

export async function addAfterSalesImage(userId: string, afterSalesNo: string, input: { imageUrl: string }) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") return addRuntimeAfterSalesImage(userId, afterSalesNo, input);

  return prisma.$transaction(async (tx) => {
    const request = await tx.afterSalesRequest.findFirst({
      where: { afterSalesNo, userId },
      include: afterSalesInclude,
    });
    if (!request) throw new Error("AFTER_SALES_NOT_FOUND");
    if (request.type !== "QUALITY_ISSUE") throw new Error("AFTER_SALES_IMAGE_ONLY_FOR_QUALITY_ISSUE");
    if (["CANCELLED", "REJECTED", "REFUNDED", "COMPLETED"].includes(request.status)) {
      throw new Error("AFTER_SALES_IMAGE_UPLOAD_CLOSED");
    }
    if (request.images.length >= 6) throw new Error("AFTER_SALES_IMAGE_LIMIT_EXCEEDED");

    await tx.afterSalesImage.create({
      data: {
        afterSalesId: request.id,
        imageUrl: input.imageUrl,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorType: "user",
        action: "after_sales.image.added",
        targetType: "after_sales_request",
        targetId: request.id,
        detail: { imageUrl: input.imageUrl },
      },
    });

    const updated = await tx.afterSalesRequest.findUniqueOrThrow({
      where: { id: request.id },
      include: afterSalesInclude,
    });
    return normalizeAfterSales(updated);
  });
}

export async function addAfterSalesImageUpload(
  userId: string,
  afterSalesNo: string,
  input: { checksum: string; imageUrl: string; mimeType: string; sizeBytes: number },
) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return addRuntimeAfterSalesImage(userId, afterSalesNo, { imageUrl: input.imageUrl });
  }

  return prisma.$transaction(async (tx) => {
    const request = await requireOpenQualityIssue(tx, userId, afterSalesNo);
    await tx.afterSalesImage.create({ data: { afterSalesId: request.id, imageUrl: input.imageUrl } });
    await tx.upload.create({
      data: {
        scope: "AFTER_SALES",
        ownerId: request.id,
        url: input.imageUrl,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        checksum: input.checksum,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorType: "user",
        action: "after_sales.image.uploaded",
        targetType: "after_sales_request",
        targetId: request.id,
        detail: { checksum: input.checksum, imageUrl: input.imageUrl, sizeBytes: input.sizeBytes },
      },
    });
    const updated = await tx.afterSalesRequest.findUniqueOrThrow({ where: { id: request.id }, include: afterSalesInclude });
    return normalizeAfterSales(updated);
  });
}

export async function addAfterSalesMessage(userId: string, afterSalesNo: string, message: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") throw new Error("AFTER_SALES_MESSAGES_REQUIRE_PRISMA");
  return prisma.$transaction(async (tx) => {
    const request = await tx.afterSalesRequest.findFirst({ where: { afterSalesNo, userId } });
    if (!request) throw new Error("AFTER_SALES_NOT_FOUND");
    if (["CANCELLED", "COMPLETED", "REJECTED", "REFUNDED"].includes(request.status)) {
      throw new Error("AFTER_SALES_MESSAGE_CLOSED");
    }
    await tx.afterSalesMessage.create({
      data: { afterSalesId: request.id, senderType: "USER", senderId: userId, message },
    });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorType: "user",
        action: "after_sales.message.added",
        targetType: "after_sales_request",
        targetId: request.id,
        detail: { length: message.length },
      },
    });
    const updated = await tx.afterSalesRequest.findUniqueOrThrow({ where: { id: request.id }, include: afterSalesInclude });
    return normalizeAfterSales(updated);
  });
}

export async function addAfterSalesAdminMessage(afterSalesNo: string, adminId: string, message: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") throw new Error("AFTER_SALES_MESSAGES_REQUIRE_PRISMA");
  return prisma.$transaction(async (tx) => {
    const request = await tx.afterSalesRequest.findUnique({ where: { afterSalesNo } });
    if (!request) throw new Error("AFTER_SALES_NOT_FOUND");
    if (["CANCELLED", "COMPLETED", "REJECTED", "REFUNDED"].includes(request.status)) {
      throw new Error("AFTER_SALES_MESSAGE_CLOSED");
    }
    await tx.afterSalesMessage.create({
      data: { afterSalesId: request.id, senderType: "ADMIN", senderId: adminId, message },
    });
    await tx.auditLog.create({
      data: {
        actorId: adminId,
        actorType: "admin",
        action: "admin.after_sales.message.added",
        targetType: "after_sales_request",
        targetId: request.id,
        detail: { length: message.length },
      },
    });
    const updated = await tx.afterSalesRequest.findUniqueOrThrow({ where: { id: request.id }, include: afterSalesInclude });
    return normalizeAfterSales(updated);
  });
}

export async function submitAfterSalesReturnShipment(
  userId: string,
  afterSalesNo: string,
  input: { trackingCompany: string; trackingNo: string },
) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") throw new Error("AFTER_SALES_RETURN_SHIPMENT_REQUIRES_PRISMA");
  return prisma.$transaction(async (tx) => {
    const identity = await tx.afterSalesRequest.findFirst({ where: { afterSalesNo, userId }, select: { orderId: true } });
    if (!identity) throw new Error("AFTER_SALES_NOT_FOUND");
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${identity.orderId} FOR UPDATE`;
    const request = await tx.afterSalesRequest.findFirst({ where: { afterSalesNo, userId } });
    if (!request) throw new Error("AFTER_SALES_NOT_FOUND");
    assertAfterSalesTransition(statusFromDb[request.status], "return_in_transit", typeFromDb[request.type]);
    await tx.afterSalesRequest.update({
      where: { id: request.id },
      data: {
        status: "RETURN_IN_TRANSIT",
        returnTrackingCompany: input.trackingCompany,
        returnTrackingNo: input.trackingNo,
      },
    });
    await tx.afterSalesMessage.create({
      data: {
        afterSalesId: request.id,
        senderType: "USER",
        senderId: userId,
        message: `已提交退货物流：${input.trackingCompany} ${input.trackingNo}`,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorType: "user",
        action: "after_sales.return_shipment.submitted",
        targetType: "after_sales_request",
        targetId: request.id,
        detail: input,
      },
    });
    const updated = await tx.afterSalesRequest.findUniqueOrThrow({ where: { id: request.id }, include: afterSalesInclude });
    return normalizeAfterSales(updated);
  });
}

export async function updateAfterSalesStatus(afterSalesNo: string, input: AfterSalesTransitionInput) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") return updateRuntimeAfterSalesStatus(afterSalesNo, input);

  let lifecycleOrderId: string | undefined;
  const result = await prisma.$transaction(async (tx) => {
    const identity = await tx.afterSalesRequest.findUnique({ where: { afterSalesNo }, select: { orderId: true } });
    if (!identity) throw new Error("AFTER_SALES_NOT_FOUND");
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${identity.orderId} FOR UPDATE`;
    const request = await tx.afterSalesRequest.findUnique({
      where: { afterSalesNo },
      include: afterSalesInclude,
    });
    if (!request) throw new Error("AFTER_SALES_NOT_FOUND");
    lifecycleOrderId = request.orderId;

    const fromStatus = statusFromDb[request.status];
    assertAfterSalesTransition(fromStatus, input.status, typeFromDb[request.type]);
    if (input.status === "rejected" && !input.rejectReason) throw new Error("REJECT_REASON_REQUIRED");
    if (input.status === "waiting_return" && !input.returnAddress) throw new Error("RETURN_ADDRESS_REQUIRED");
    await assertAfterSalesCompletionReady(tx, request, fromStatus, input.status);

    const status = statusToDb[input.status];
    const timestampField =
      input.status === "approved"
        ? { approvedAt: new Date() }
        : input.status === "rejected"
          ? { rejectedAt: new Date() }
          : input.status === "received"
            ? { receivedAt: new Date() }
            : input.status === "completed"
              ? { completedAt: new Date() }
              : {};

    const sideEffect = await createTransitionSideEffect(tx, request, input);
    await tx.afterSalesRequest.update({
      where: { id: request.id },
      data: {
        status,
        rejectReason: input.rejectReason ?? request.rejectReason,
        returnAddress: input.returnAddress ?? request.returnAddress,
        ...timestampField,
      },
    });
    await tx.afterSalesMessage.create({
      data: {
        afterSalesId: request.id,
        senderType: input.actorType === "admin" ? "ADMIN" : "SYSTEM",
        senderId: input.actorId,
        message: `售后状态已更新：${afterSalesStatusLabels[input.status]}`,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorType: input.actorType,
        action: `after_sales.status.${input.status}`,
        targetType: "after_sales_request",
        targetId: request.id,
        detail: { afterSalesNo, ...(input.detail as object | undefined), ...sideEffect },
      },
    });

    const updated = await tx.afterSalesRequest.findUniqueOrThrow({
      where: { id: request.id },
      include: afterSalesInclude,
    });
    return normalizeAfterSales(updated);
  });
  if (lifecycleOrderId && ["received", "inspecting", "completed"].includes(input.status)) {
    await tryReconcileRefundedOrderLifecycle(lifecycleOrderId, { source: "AFTER_SALES_TRANSITION", actorId: input.actorType === "admin" ? input.actorId : undefined });
    return normalizeAfterSales(await prisma.afterSalesRequest.findUniqueOrThrow({ where: { afterSalesNo }, include: afterSalesInclude }));
  }
  return result;
}

export async function listRefundsForAdmin() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") return listRuntimeRefunds();

  return prisma.refund.findMany({
    include: {
      order: true,
      afterSales: true,
      admin: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

async function syncOrderPaymentStatusAfterSucceededRefund(tx: Prisma.TransactionClient, orderId: string) {
  await reverseRefundPoints(tx, orderId);
  const order = await tx.order.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      payableAmountCents: true,
      paymentStatus: true,
    },
  });
  if (order.paymentStatus === "REFUNDED") return;

  const refundTotal = await tx.refund.aggregate({
    where: {
      orderId,
      refundStatus: "SUCCEEDED",
    },
    _sum: {
      refundAmountCents: true,
    },
  });
  const refundedAmountCents = refundTotal._sum.refundAmountCents ?? 0;
  if (order.payableAmountCents > 0 && refundedAmountCents >= order.payableAmountCents) {
    await tx.order.update({
      where: { id: orderId },
      data: { paymentStatus: "REFUNDED" },
    });
  }
}

export async function updateRefundForAdmin(refundNo: string, input: RefundUpdateInput, actorId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const refund = updateRuntimeRefundForAdmin(refundNo, {
      paymentRefundId: input.paymentRefundId,
      failureReason: input.failureReason,
      actorId,
      note: input.note,
    });
    writeRuntimeAdminAudit(actorId, "admin.refund.updated", "refund", refund.refundNo, {
      refundNo,
      orderNo: refund.orderNo,
      status: refund.status,
      paymentRefundId: refund.paymentRefundId,
      failureReason: refund.failureReason,
      note: input.note,
    });
    return refund;
  }

  return prisma.$transaction(async (tx) => {
    const refund = await tx.refund.findUnique({
      where: { refundNo },
      include: { order: true },
    });
    if (!refund) throw new Error("REFUND_NOT_FOUND");

    const updated = await tx.refund.update({
      where: { id: refund.id },
      data: {
        paymentRefundId: input.paymentRefundId ?? refund.paymentRefundId,
        adminId: actorId,
      },
      include: {
        order: true,
        afterSales: true,
        admin: true,
      },
    });

    await tx.auditLog.create({
      data: {
        actorId,
        actorType: "admin",
        action: "admin.refund.updated",
        targetType: "refund",
        targetId: refund.id,
        detail: {
          refundNo,
          orderNo: refund.order.orderNo,
          before: {
            status: refund.refundStatus,
            paymentRefundId: refund.paymentRefundId,
          },
          after: {
            status: updated.refundStatus,
            paymentRefundId: updated.paymentRefundId,
          },
          failureReason: input.failureReason,
          note: input.note,
        },
      },
    });

    return updated;
  });
}

export async function executeProviderRefundForAdmin(refundNo: string, actorId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    if (appConfig.PAYMENT_PROVIDER !== "mock") throw new Error("ALIPAY_REFUND_REQUIRES_PRISMA_STORAGE");
    const refund = listRuntimeRefunds().find((item) => item.refundNo === refundNo);
    if (!refund) throw new Error("REFUND_NOT_FOUND");
    if (refund.status === "succeeded") {
      completeRuntimeAfterSalesRefund(refund.afterSalesNo, actorId);
      return refund;
    }
    if (!["created", "manual_marked", "processing", "failed"].includes(refund.status)) {
      throw new Error("REFUND_STATUS_NOT_EXECUTABLE");
    }
    const updated = updateRuntimeRefundForAdmin(refundNo, {
      status: "succeeded",
      paymentRefundId: `mock-${refundNo}`,
      actorId,
      note: "mock provider confirmed refund success",
    });
    completeRuntimeAfterSalesRefund(updated.afterSalesNo, actorId);
    return updated;
  }
  const provider = await prisma.refund.findUnique({
    where: { refundNo },
    select: { payment: { select: { provider: true } } },
  });
  if (provider?.payment?.provider === "WECHAT_PAY") {
    return executeWeChatRefundForAdmin(refundNo, actorId);
  }
  if (appConfig.PAYMENT_PROVIDER === "mock") {
    return prisma.$transaction(async (tx) => {
      const refund = await tx.refund.findUnique({ where: { refundNo } });
      if (!refund) throw new Error("REFUND_NOT_FOUND");
      if (refund.refundStatus === "SUCCEEDED" && refund.paymentRefundId) {
        return tx.refund.findUniqueOrThrow({
          where: { id: refund.id },
          include: { order: true, afterSales: true, admin: true },
        });
      }
      if (!["CREATED", "MANUAL_MARKED", "PROCESSING", "FAILED"].includes(refund.refundStatus)) {
        throw new Error("REFUND_STATUS_NOT_EXECUTABLE");
      }
      return completePrismaRefund(tx, {
        refundId: refund.id,
        orderId: refund.orderId,
        afterSalesId: refund.afterSalesId,
        actorId,
        paymentRefundId: `mock-${refund.refundNo}`,
        auditAction: "admin.refund.mock.succeeded",
        auditDetail: { refundNo: refund.refundNo, provider: "mock" },
      });
    });
  }
  if (appConfig.PAYMENT_PROVIDER !== "alipay") throw new Error("ALIPAY_REFUND_REQUIRES_ALIPAY_PROVIDER");

  const prepared = await prisma.$transaction(async (tx) => {
    const refund = await tx.refund.findUnique({
      where: { refundNo },
      include: {
        order: {
          include: {
            paymentIntents: true,
          },
        },
      },
    });
    if (!refund) throw new Error("REFUND_NOT_FOUND");
    if (refund.refundAmountCents <= 0) throw new Error("REFUND_AMOUNT_INVALID");
    if (refund.refundStatus === "SUCCEEDED" && refund.paymentRefundId) {
      return { alreadySucceeded: true as const, refund, payment: null };
    }
    if (!["CREATED", "MANUAL_MARKED", "PROCESSING", "FAILED"].includes(refund.refundStatus)) {
      throw new Error("REFUND_STATUS_NOT_EXECUTABLE");
    }

    const payment = refund.order.paymentIntents.find((item) => item.provider === "ALIPAY" && item.status === "PAID");
    if (!payment) throw new Error("ALIPAY_PAID_PAYMENT_NOT_FOUND");
    if (payment.amountCents < refund.refundAmountCents) throw new Error("REFUND_AMOUNT_EXCEEDS_PAYMENT");

    const processing = await tx.refund.update({
      where: { id: refund.id },
      data: {
        refundStatus: "PROCESSING",
        adminId: actorId,
      },
      include: {
        order: true,
        afterSales: true,
        admin: true,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        actorType: "admin",
        action: "admin.refund.alipay.processing",
        targetType: "refund",
        targetId: refund.id,
        detail: { refundNo, orderNo: refund.order.orderNo, amountCents: refund.refundAmountCents },
      },
    });

    return { alreadySucceeded: false as const, refund: processing, payment };
  });

  if (prepared.alreadySucceeded) {
    if (prepared.refund.afterSalesId) {
      await prisma.afterSalesRequest.updateMany({
        where: { id: prepared.refund.afterSalesId, status: "REFUND_PROCESSING" },
        data: { status: "REFUNDED" },
      });
    }
    return prepared.refund;
  }

  const refundResult = await requestAlipayRefund({
    orderNo: prepared.refund.order.orderNo,
    tradeNo: prepared.payment.gatewayTradeNo,
    refundNo: prepared.refund.refundNo,
    refundAmountCents: prepared.refund.refundAmountCents,
    reason: prepared.refund.reason,
  });

  if (!refundResult.signatureValid) {
    await markRefundExecutionFailed(prepared.refund.id, prepared.refund.refundNo, actorId, "ALIPAY_REFUND_SIGNATURE_INVALID", refundResult);
    throw new Error("ALIPAY_REFUND_SIGNATURE_INVALID");
  }

  if (refundResult.code !== "10000") {
    await markRefundExecutionFailed(prepared.refund.id, prepared.refund.refundNo, actorId, refundResult.subCode ?? refundResult.msg ?? "ALIPAY_REFUND_FAILED", refundResult);
    throw new Error(refundResult.subCode ?? refundResult.msg ?? "ALIPAY_REFUND_FAILED");
  }

  return prisma.$transaction((tx) => completePrismaRefund(tx, {
    refundId: prepared.refund.id,
    orderId: prepared.refund.orderId,
    afterSalesId: prepared.refund.afterSalesId,
    actorId,
    paymentRefundId: refundResult.tradeNo ?? prepared.refund.refundNo,
    auditAction: "admin.refund.alipay.succeeded",
    auditDetail: {
      refundNo: prepared.refund.refundNo,
      orderNo: prepared.refund.order.orderNo,
      tradeNo: refundResult.tradeNo,
      refundFee: refundResult.refundFee,
      fundChange: refundResult.fundChange,
    },
  }));
}

async function completePrismaRefund(
  tx: Prisma.TransactionClient,
  input: {
    refundId: string;
    orderId: string;
    afterSalesId: string | null;
    actorId: string;
    paymentRefundId: string;
    auditAction: string;
    auditDetail: Prisma.InputJsonObject;
  },
) {
  const updated = await tx.refund.update({
    where: { id: input.refundId },
    data: {
      refundStatus: "SUCCEEDED",
      paymentRefundId: input.paymentRefundId,
      adminId: input.actorId,
      completedAt: new Date(),
    },
    include: {
      order: true,
      afterSales: true,
      admin: true,
    },
  });
  await syncOrderPaymentStatusAfterSucceededRefund(tx, input.orderId);
  if (input.afterSalesId) {
    const request = await tx.afterSalesRequest.findUnique({
      where: { id: input.afterSalesId },
      include: { items: true },
    });
    if (request) {
      for (const item of request.items) {
        await tx.orderItem.update({
          where: { id: item.orderItemId },
          data: { refundAmountCents: { increment: item.refundAmountCents } },
        });
      }
      if (request.status === "REFUND_PROCESSING") {
        await tx.afterSalesRequest.update({ where: { id: request.id }, data: { status: "REFUNDED" } });
        await tx.auditLog.create({
          data: {
            actorId: input.actorId,
            actorType: "admin",
            action: "after_sales.status.refunded",
            targetType: "after_sales_request",
            targetId: request.id,
            detail: { afterSalesNo: request.afterSalesNo, refundNo: updated.refundNo },
          },
        });
      }
    }
  }
  await tx.auditLog.create({
    data: {
      actorId: input.actorId,
      actorType: "admin",
      action: input.auditAction,
      targetType: "refund",
      targetId: input.refundId,
      detail: input.auditDetail,
    },
  });
  return updated;
}

export async function listReshipmentsForAdmin() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") return listRuntimeReshipments();

  return prisma.shipment.findMany({
    where: {
      items: {
        some: {},
      },
    },
    include: {
      order: true,
      items: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

type AfterSalesRefundOperation = {
  id: string;
  refundNo: string;
  status: string;
  amountCents: number;
  paymentRefundId: string | null;
};

type AfterSalesReshipmentOperation = {
  id: string;
  label: string;
  status: string;
  trackingCompany: string | null;
  trackingNo: string | null;
};

export async function getAfterSalesAdminOperations(afterSalesNo: string, orderNo: string): Promise<{
  refunds: AfterSalesRefundOperation[];
  reshipments: AfterSalesReshipmentOperation[];
}> {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return {
      refunds: listRuntimeRefunds()
        .filter((row) => row.afterSalesNo === afterSalesNo)
        .map((row) => ({ id: row.id, refundNo: row.refundNo, status: row.status, amountCents: row.amountCents, paymentRefundId: row.paymentRefundId ?? null })),
      reshipments: listRuntimeReshipments()
        .filter((row) => row.orderNo === orderNo && row.afterSalesNo === afterSalesNo)
        .map((row) => ({ id: row.id, label: row.reshipmentNo, status: row.status, trackingCompany: row.trackingCompany ?? null, trackingNo: row.trackingNo ?? null })),
    };
  }

  const [refundRows, shipmentRows] = await Promise.all([
    prisma.refund.findMany({
      where: { afterSales: { afterSalesNo } },
      select: { id: true, refundNo: true, refundStatus: true, refundAmountCents: true, paymentRefundId: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.shipment.findMany({
      where: { order: { orderNo }, items: { some: {} } },
      select: { id: true, status: true, trackingCompany: true, trackingNo: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return {
    refunds: refundRows.map((row) => ({ id: row.id, refundNo: row.refundNo, status: row.refundStatus, amountCents: row.refundAmountCents, paymentRefundId: row.paymentRefundId })),
    reshipments: shipmentRows.map((row) => ({ id: row.id, label: `物流 ${row.id.slice(-8)}`, status: row.status, trackingCompany: row.trackingCompany, trackingNo: row.trackingNo })),
  };
}

export async function performReshipmentAction(reshipmentId: string, input: ReshipmentActionInput, actorId: string) {
  const status = input.action === "ship" ? "SHIPPED" : input.action === "deliver" ? "DELIVERED" : "RETURNED";
  return updateReshipmentForAdmin(reshipmentId, { status, trackingCompany: input.trackingCompany, trackingNo: input.trackingNo, note: input.note }, actorId);
}

async function updateReshipmentForAdmin(reshipmentId: string, input: ReshipmentUpdateInput, actorId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const current = listRuntimeReshipments().find((item) => item.id === reshipmentId || item.reshipmentNo === reshipmentId);
    if (!current) throw new Error("RESHIPMENT_NOT_FOUND");
    if (input.status) assertReshipmentTransition(current.status, input.status, input);
    const reshipment = updateRuntimeReshipmentForAdmin(current.reshipmentNo, {
      status: input.status ? toRuntimeReshipmentStatus(input.status) : undefined,
      trackingCompany: input.trackingCompany,
      trackingNo: input.trackingNo,
      actorId,
      note: input.note,
    });
    writeRuntimeAdminAudit(actorId, "admin.reshipment.updated", "reshipment", reshipment.reshipmentNo, {
      reshipmentNo: reshipment.reshipmentNo,
      orderNo: reshipment.orderNo,
      status: reshipment.status,
      trackingCompany: reshipment.trackingCompany,
      trackingNo: reshipment.trackingNo,
      note: input.note,
    });
    return reshipment;
  }

  return prisma.$transaction(async (tx) => {
    const identity = await tx.shipment.findUnique({ where: { id: reshipmentId }, select: { orderId: true } });
    if (!identity) throw new Error("RESHIPMENT_NOT_FOUND");
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${identity.orderId} FOR UPDATE`;
    const shipment = await tx.shipment.findUnique({
      where: { id: reshipmentId },
      include: {
        order: true,
        items: true,
      },
    });
    if (!shipment) throw new Error("RESHIPMENT_NOT_FOUND");
    if (shipment.order.paymentStatus !== "PAID" || shipment.order.status !== "CONFIRMED") throw new Error("ORDER_NOT_AVAILABLE_FOR_FULFILLMENT");

    const status = input.status ?? shipment.status;
    if (input.status) assertReshipmentTransition(shipment.status, input.status, input);
    const updated = await tx.shipment.update({
      where: { id: shipment.id },
      data: {
        status,
        trackingCompany: input.trackingCompany ?? shipment.trackingCompany,
        trackingNo: input.trackingNo ?? shipment.trackingNo,
        shippedAt: status === "SHIPPED" || status === "DELIVERED" ? (shipment.shippedAt ?? new Date()) : shipment.shippedAt,
        deliveredAt: status === "DELIVERED" ? (shipment.deliveredAt ?? new Date()) : shipment.deliveredAt,
      },
      include: {
        order: true,
        items: true,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        actorType: "admin",
        action: "admin.reshipment.updated",
        targetType: "shipment",
        targetId: shipment.id,
        detail: {
          orderNo: shipment.order.orderNo,
          before: {
            status: shipment.status,
            trackingCompany: shipment.trackingCompany,
            trackingNo: shipment.trackingNo,
          },
          after: {
            status: updated.status,
            trackingCompany: updated.trackingCompany,
            trackingNo: updated.trackingNo,
          },
          note: input.note,
        },
      },
    });

    return updated;
  });
}

function assertReshipmentTransition(currentStatus: string, nextStatus: NonNullable<ReshipmentUpdateInput["status"]>, input: ReshipmentUpdateInput) {
  const current = currentStatus.toUpperCase();
  if ((current === "CREATED" || current === "PROCESSING") && nextStatus === "SHIPPED") {
    if (!input.trackingCompany || !input.trackingNo) throw new Error("RESHIPMENT_TRACKING_REQUIRED");
    return;
  }
  if (current === "SHIPPED" && (nextStatus === "DELIVERED" || nextStatus === "RETURNED")) return;
  throw new Error("RESHIPMENT_ACTION_NOT_ALLOWED");
}

async function createTransitionSideEffect(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  request: Awaited<ReturnType<typeof prisma.afterSalesRequest.findUnique>> & { items: Array<{ orderItemId: string; refundAmountCents: number; quantity: number }> },
  input: AfterSalesTransitionInput,
) {
  if (input.status === "refund_processing") {
    const duplicate = await tx.afterSalesItem.findFirst({
      where: {
        orderItemId: { in: request.items.map((item) => item.orderItemId) },
        afterSales: {
          refunds: {
            some: { refundStatus: "SUCCEEDED" },
          },
        },
      },
    });
    if (duplicate) throw new Error("ORDER_ITEM_ALREADY_REFUNDED");

    const existingRefund = await tx.refund.findFirst({ where: { afterSalesId: request.id } });
    if (existingRefund) return { refundNo: existingRefund.refundNo, refundAmountCents: existingRefund.refundAmountCents };

    const payment = await tx.paymentIntent.findFirst({
      where: { orderId: request.orderId, status: "PAID" },
      orderBy: { createdAt: "desc" },
    });
    if (!payment) throw new Error("PAID_PAYMENT_NOT_FOUND");
    const refundNo = await createRefundNo(tx.refund.count.bind(tx.refund));
    const refund = await tx.refund.create({
      data: {
        orderId: request.orderId,
        afterSalesId: request.id,
        paymentId: payment?.id,
        refundNo,
        refundAmountCents: request.refundAmountCents,
        refundStatus: "CREATED",
        reason: request.reason,
        adminId: input.actorId,
      },
    });
    return { refundNo: refund.refundNo, refundAmountCents: refund.refundAmountCents };
  }

  if (input.status === "exchange_shipping" || input.status === "reshipped") {
    const order = await tx.order.findUniqueOrThrow({ where: { id: request.orderId }, select: { paymentStatus: true, status: true } });
    if (order.paymentStatus !== "PAID" || order.status !== "CONFIRMED") throw new Error("ORDER_NOT_AVAILABLE_FOR_FULFILLMENT");
    const shipment = await tx.shipment.create({
      data: {
        orderId: request.orderId,
        status: "PROCESSING",
        items: {
          create: request.items.map((item) => ({
            orderItemId: item.orderItemId,
            quantity: item.quantity,
          })),
        },
      },
    });
    return { reshipmentId: shipment.id };
  }

  return undefined;
}

async function assertAfterSalesCompletionReady(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  request: Awaited<ReturnType<typeof prisma.afterSalesRequest.findUnique>> & { items: Array<{ orderItemId: string }> },
  fromStatus: AfterSalesStatus,
  nextStatus: AfterSalesStatus,
) {
  if (nextStatus !== "completed") return;

  if (fromStatus === "refunded") {
    const order = await tx.order.findUniqueOrThrow({ where: { id: request.orderId }, include: { shipments: true, refunds: true } });
    if (requiresReturnReceipt(request, hasActualShipment(order)) && !request.receivedAt) throw new Error("RETURN_RECEIPT_REQUIRED");
    const full = order.payableAmountCents > 0 && order.refunds.filter(refund => refund.refundStatus === "SUCCEEDED").reduce((sum, refund) => sum + refund.refundAmountCents, 0) >= order.payableAmountCents;
    const exact = await tx.refund.aggregate({ where: { afterSalesId: request.id, refundStatus: "SUCCEEDED" }, _sum: { refundAmountCents: true } });
    if (!full && (request.refundAmountCents <= 0 || (exact._sum.refundAmountCents ?? 0) < request.refundAmountCents)) throw new Error("REFUND_SUCCESS_REQUIRED");
  }

  if (fromStatus === "exchange_shipping" || fromStatus === "reshipped") {
    const orderItemIds = request.items.map((item) => item.orderItemId);
    const deliveredShipments = await tx.shipment.findMany({
      where: {
        orderId: request.orderId,
        status: "DELIVERED",
        items: { some: { orderItemId: { in: orderItemIds } } },
      },
      include: { items: true },
    });
    const deliveredItemIds = new Set(deliveredShipments.flatMap((shipment) => shipment.items.map((item) => item.orderItemId)));
    if (orderItemIds.some((orderItemId) => !deliveredItemIds.has(orderItemId))) {
      throw new Error("RESHIPMENT_DELIVERY_REQUIRED");
    }
  }
}

type NormalizableAfterSales = {
  id: string;
  afterSalesNo: string;
  userId: string;
  type: keyof typeof typeFromDb;
  reason: string;
  description: string;
  status: keyof typeof statusFromDb;
  refundAmountCents: number;
  rejectReason: string | null;
  returnAddress: string | null;
  returnTrackingCompany: string | null;
  returnTrackingNo: string | null;
  createdAt: Date;
  updatedAt: Date;
  order: { orderNo: string };
  items: Array<{
    orderItemId: string;
    productName: string;
    color: string;
    size: string;
    quantity: number;
    refundAmountCents: number;
  }>;
  images: Array<{ imageUrl: string }>;
  messages: Array<{ id: string; senderType: string; message: string; createdAt: Date }>;
};

function normalizeAfterSales(request: NormalizableAfterSales) {
  return {
    id: request.id,
    afterSalesNo: request.afterSalesNo,
    userId: request.userId,
    orderNo: request.order.orderNo,
    type: typeFromDb[request.type],
    reason: request.reason,
    description: request.description,
    status: statusFromDb[request.status],
    items: request.items.map((item) => ({
      orderItemId: item.orderItemId,
      productName: item.productName,
      color: item.color,
      size: item.size,
      quantity: item.quantity,
      refundAmountCents: item.refundAmountCents,
    })),
    imageUrls: request.images.map((image) => image.imageUrl),
    refundAmountCents: request.refundAmountCents,
    rejectReason: request.rejectReason ?? undefined,
    returnAddress: request.returnAddress ?? undefined,
    returnTrackingCompany: request.returnTrackingCompany ?? undefined,
    returnTrackingNo: request.returnTrackingNo ?? undefined,
    messages: request.messages.map((message) => ({
      id: message.id,
      senderType: message.senderType.toLowerCase(),
      message: message.message,
      createdAt: message.createdAt,
    })),
    audit: [],
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

async function requireOpenQualityIssue(tx: Prisma.TransactionClient, userId: string, afterSalesNo: string) {
  const request = await tx.afterSalesRequest.findFirst({
    where: { afterSalesNo, userId },
    include: { images: true },
  });
  if (!request) throw new Error("AFTER_SALES_NOT_FOUND");
  if (request.type !== "QUALITY_ISSUE") throw new Error("AFTER_SALES_IMAGE_ONLY_FOR_QUALITY_ISSUE");
  if (["CANCELLED", "REJECTED", "REFUNDED", "COMPLETED"].includes(request.status)) {
    throw new Error("AFTER_SALES_IMAGE_UPLOAD_CLOSED");
  }
  if (request.images.length >= 6) throw new Error("AFTER_SALES_IMAGE_LIMIT_EXCEEDED");
  return request;
}

async function createAfterSalesNo(countRequests: () => Promise<number>) {
  const now = new Date();
  const count = await countRequests();
  return `AS${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(count + 1).padStart(5, "0")}`;
}

async function createRefundNo(countRefunds: () => Promise<number>) {
  const now = new Date();
  const count = await countRefunds();
  return `RF${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(count + 1).padStart(5, "0")}`;
}

function toRuntimeReshipmentStatus(status: NonNullable<ReshipmentUpdateInput["status"]>): RuntimeReshipmentStatus {
  return status.toLowerCase() as RuntimeReshipmentStatus;
}

async function markRefundExecutionFailed(
  refundId: string,
  refundNo: string,
  actorId: string,
  reason: string,
  detail: unknown,
) {
  await prisma.$transaction(async (tx) => {
    await tx.refund.update({
      where: { id: refundId },
      data: {
        refundStatus: "FAILED",
        adminId: actorId,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        actorType: "admin",
        action: "admin.refund.alipay.failed",
        targetType: "refund",
        targetId: refundId,
        detail: { refundNo, reason, gateway: toPrismaJson(detail) } as Prisma.InputJsonObject,
      },
    });
  });
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function assertTrustedEvidenceUrl(value: string) {
  const url = new URL(value);
  const baseUrl = new URL(appConfig.APP_BASE_URL);
  const publicRoot = `/${appConfig.UPLOAD_PUBLIC_PATH.trim().replace(/^\/+/, "").replace(/\/+$/, "")}`;
  if (url.origin !== baseUrl.origin || !(url.pathname === publicRoot || url.pathname.startsWith(`${publicRoot}/`))) {
    throw new Error("AFTER_SALES_IMAGE_URL_NOT_TRUSTED");
  }
}

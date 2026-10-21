import {reverseRefundPoints} from "@/lib/services/member-points-service";
import {completeGiftRefund} from "@/lib/services/gift-card-service";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { tryReconcileRefundedOrderLifecycle } from "@/lib/services/refunded-order-lifecycle-service";
import { isRetryableRefundTransaction } from "@/lib/commerce/refunded-order-lifecycle";
import { assertRefundPaymentIdentity, nextObservedRefundStatus, normalizeVerifiedRefund, refundObservationFingerprint, type WeChatRefundObservation } from "@/lib/commerce/wechat-refund-sync";
import {
  queryWeChatPayRefund,
  queryWeChatPayOrder,
  requestWeChatPayRefund,
  type WeChatPayRefundNotification,
  type WeChatPayRefundResult,
} from "@/lib/providers/wechat-pay";

type VerifiedRefundEvent = {
  eventId: string;
  eventType: string;
  rawPayload: Prisma.InputJsonValue;
  refund: WeChatPayRefundNotification;
};

export async function executeWeChatRefundForAdmin(refundNo: string, actorId: string) {
  assertPrismaStorage();
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { role: true, status: true } });
  if (actor?.role !== "OWNER" || actor.status !== "ACTIVE") throw new Error("ADMIN_OWNER_REQUIRED_FOR_REAL_REFUND");
  const refund = await loadExecutableRefund(refundNo);
  if (refund.refundStatus === "SUCCEEDED") return refund;
  if (!refund.payment || refund.payment.provider !== "WECHAT_PAY") throw new Error("WECHAT_PAID_PAYMENT_NOT_FOUND");

  if (refund.refundStatus === "PROCESSING") {
    let existingResult: WeChatPayRefundResult | null = null;
    try {
      existingResult = await queryWeChatPayRefund(refund.refundNo);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "WECHAT_PAY_API_RESOURCE_NOT_EXISTS") {
        await auditUncertainRefund(refund.id, refund.refundNo, actorId, error);
        throw new Error("WECHAT_PAY_REFUND_CONFIRMATION_REQUIRED");
      }
    }
    if (existingResult) return processSignedRefundResult(existingResult, actorId);
  }

  const transaction = await queryWeChatPayOrder(refund.payment.merchantOrderNo);
  if (transaction.trade_state !== "SUCCESS" || !transaction.transaction_id) {
    throw new Error("WECHAT_PAY_ORDER_NOT_PAID");
  }
  if (refund.payment.gatewayTradeNo && transaction.transaction_id !== refund.payment.gatewayTradeNo) {
    throw new Error("WECHAT_PAY_TRANSACTION_ID_MISMATCH");
  }

  await prisma.refund.update({
    where: { id: refund.id },
    data: { refundStatus: "PROCESSING", adminId: actorId },
  });

  let result: WeChatPayRefundResult;
  try {
    result = await requestWeChatPayRefund({
      amountCents: refund.refundAmountCents,
      merchantOrderNo: refund.payment.merchantOrderNo,
      reason: refund.reason,
      refundNo: refund.refundNo,
      totalAmountCents: refund.payment.amountCents,
    });
  } catch (requestError) {
    try {
      result = await queryWeChatPayRefund(refund.refundNo);
    } catch (queryError) {
      await auditUncertainRefund(refund.id, refund.refundNo, actorId, { requestError, queryError });
      throw new Error("WECHAT_PAY_REFUND_CONFIRMATION_REQUIRED");
    }
  }
  return processSignedRefundResult(result, actorId);
}

export async function processWeChatRefundEvent(input: VerifiedRefundEvent) {
  assertPrismaStorage();
  if (!appConfig.WECHAT_PAY_MCH_ID || input.refund.mchid !== appConfig.WECHAT_PAY_MCH_ID) throw Error("WECHAT_PAY_MCH_ID_MISMATCH");
  const refund = await applyVerifiedRefund({ eventId: input.eventId, eventType: input.eventType, observation: normalizeVerifiedRefund(input.refund), rawPayload: input.rawPayload, source: "V3_NOTIFY", actorId: "system" });
  return finishVerifiedRefund(refund);
}

async function processSignedRefundResult(result: WeChatPayRefundResult, actorId: string) {
  return processVerifiedWeChatRefundResult(result, { actorId, source: "SIGNED_QUERY" });
}

export type VerifiedWeChatRefundResultOptions = { actorId?: string; source?: "SIGNED_QUERY" | "LEGACY_NOTIFY_QUERY" | "DISCOVERY_QUERY"; eventId?: string };
// Only callers that already verified the V3 response signature may use this
// database-only sink. It never discovers, queries or initiates a refund.
export async function processVerifiedWeChatRefundResult(result: WeChatPayRefundResult, options: VerifiedWeChatRefundResultOptions = {}) {
  assertPrismaStorage();
  const refund = await applyVerifiedRefund({ eventId: options.eventId ?? `refund-query:${result.refund_id}:${result.status}`, eventType: "REFUND.QUERY", observation: normalizeVerifiedRefund({ ...result, refund_status: result.status }), rawPayload: toJson({ source: "signed_refund_response", result }), source: options.source ?? "SIGNED_QUERY", actorId: options.actorId ?? "system" });
  return finishVerifiedRefund(refund, options.actorId);
}

async function finishVerifiedRefund(refund: { id: string; orderId: string }, actorId?: string) {
  await tryReconcileRefundedOrderLifecycle(refund.orderId, { source: "VERIFIED_REFUND", actorId: actorId === "system" ? undefined : actorId });
  return prisma.refund.findUniqueOrThrow({ where: { id: refund.id }, include: refundWriteInclude });
}

type VerifiedRefundWrite = { eventId: string; eventType: string; observation: WeChatRefundObservation; rawPayload: Prisma.InputJsonValue; source: "V3_NOTIFY" | NonNullable<VerifiedWeChatRefundResultOptions["source"]>; actorId: string };
const refundWriteInclude = { afterSales: { include: { items: true } }, order: true, payment: true, admin: true } as const;
async function applyVerifiedRefund(input: VerifiedRefundWrite) {
  if (!input.eventId || input.eventId.length > 512 || !input.eventType.startsWith("REFUND.")) throw Error("WECHAT_PAY_REFUND_EVENT_INVALID");
  for (let attempt = 0; ; attempt++) {
    try { return await prisma.$transaction(async tx => {
      // Hold this short database-only lock for every writer, including a
      // duplicate event with a different order hint. No network runs inside it.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('wechat-refund-write-v1'))`;
      const observation = input.observation;
      const [byNo, byProviderId] = await Promise.all([
        tx.refund.findUnique({ where: { refundNo: observation.outRefundNo }, include: refundWriteInclude }),
        tx.refund.findMany({ where: { paymentRefundId: observation.providerRefundId }, include: refundWriteInclude, take: 2 }),
      ]);
      if (byProviderId.length > 1 || byNo && byProviderId[0] && byNo.id !== byProviderId[0].id) throw Error("WECHAT_PAY_REFUND_ID_AMBIGUOUS");
      let refund = byNo ?? byProviderId[0] ?? null;
      let payment = refund?.payment ?? null;
      if (refund && !payment) throw Error("WECHAT_PAID_PAYMENT_NOT_FOUND");
      if (!payment && observation.merchantOrderNo) payment = await tx.paymentIntent.findUnique({ where: { provider_merchantOrderNo: { provider: "WECHAT_PAY", merchantOrderNo: observation.merchantOrderNo } } });
      if (!payment && observation.transactionId) {
        const matches = await tx.paymentIntent.findMany({ where: { provider: "WECHAT_PAY", gatewayTradeNo: observation.transactionId }, take: 2 });
        if (matches.length > 1) throw Error("WECHAT_PAY_PAYMENT_AMBIGUOUS");
        payment = matches[0] ?? null;
      }
      if (!payment) throw Error("WECHAT_PAID_PAYMENT_NOT_FOUND");
      assertRefundPaymentIdentity(payment, observation);
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${payment.orderId} FOR UPDATE`;
      if (!refund && !observation.merchantOrderNo && !observation.transactionId) throw Error("WECHAT_PAY_REFUND_IDENTITY_INVALID");
      if (refund && (refund.orderId !== payment.orderId || refund.paymentId !== payment.id || refund.refundAmountCents !== observation.refundAmountCents)) throw Error("WECHAT_PAY_REFUND_AMOUNT_MISMATCH");
      if (refund?.paymentRefundId && refund.paymentRefundId !== observation.providerRefundId) throw Error("WECHAT_PAY_REFUND_ID_MISMATCH");
      if (refund?.afterSales && refund.afterSales.orderId !== payment.orderId) throw Error("WECHAT_PAY_REFUND_AFTER_SALES_MISMATCH");
      const priorIdentity = await tx.paymentNotification.findFirst({ where: { provider: "WECHAT_PAY", verified: true, processedAt: { not: null }, rawPayload: { path: ["refundSync", "observation", "providerRefundId"], equals: observation.providerRefundId } }, orderBy: { createdAt: "asc" }, select: { rawPayload: true } });
      const priorObservation = (priorIdentity?.rawPayload as { refundSync?: { observation?: { outRefundNo?: string } } } | undefined)?.refundSync?.observation;
      if (priorObservation?.outRefundNo && priorObservation.outRefundNo !== observation.outRefundNo) throw Error("WECHAT_PAY_REFUND_NO_MISMATCH");
      // A query may omit identity fields already fixed by an exact local refund
      // number. Persist a canonical complete intent for safe event replay.
      const canonical = { ...observation, merchantOrderNo: payment.merchantOrderNo, transactionId: payment.gatewayTradeNo ?? observation.transactionId };
      const fingerprint = refundObservationFingerprint(canonical);
      const notification = await tx.paymentNotification.findUnique({ where: { provider_tradeNo: { provider: "WECHAT_PAY", tradeNo: input.eventId } } });
      if (notification) {
        const payload = notification.rawPayload as { refundSync?: { fingerprint?: string } } | null;
        if (!notification.status.startsWith("REFUND.") || notification.paymentId && notification.paymentId !== payment.id || notification.orderId && notification.orderId !== payment.orderId || payload?.refundSync?.fingerprint && payload.refundSync.fingerprint !== fingerprint) throw Error("WECHAT_PAY_REFUND_EVENT_CHANGED");
        if (notification.processedAt) {
          if (!refund) throw Error("WECHAT_PAY_REFUND_EVENT_CHANGED");
          return refund;
        }
      }
      const imported = !refund;
      if (!refund) refund = await tx.refund.create({ data: { id: "wx-refund-" + createHash("sha256").update(observation.providerRefundId).digest("hex"), orderId: payment.orderId, paymentId: payment.id, refundNo: observation.outRefundNo, refundAmountCents: observation.refundAmountCents, paymentRefundId: observation.providerRefundId, reason: "商户平台退款（微信已核实）" }, include: refundWriteInclude });
      const nextStatus = nextObservedRefundStatus(refund.refundStatus, observation.status);
      const newlySucceeded = nextStatus === "SUCCEEDED" && refund.refundStatus !== "SUCCEEDED";
      if (nextStatus === "SUCCEEDED") {
        const others = await tx.refund.aggregate({ where: { paymentId: payment.id, id: { not: refund.id }, refundStatus: "SUCCEEDED" }, _sum: { refundAmountCents: true } });
        if ((others._sum.refundAmountCents ?? 0) + refund.refundAmountCents > payment.amountCents) throw Error("REFUND_TOTAL_EXCEEDS_PAYMENT");
      }
      const rawPayload = toJson({ refundSync: { version: 1, fingerprint, observation: canonical, source: input.source, imported }, payload: input.rawPayload });
      const savedNotification = notification ? await tx.paymentNotification.update({ where: { id: notification.id }, data: { orderId: payment.orderId, paymentId: payment.id, status: `${input.eventType}:${observation.status}`, rawPayload, verified: true } })
        : await tx.paymentNotification.create({ data: { provider: "WECHAT_PAY", tradeNo: input.eventId, orderId: payment.orderId, paymentId: payment.id, status: `${input.eventType}:${observation.status}`, rawPayload, verified: true } });
      await tx.refund.update({ where: { id: refund.id }, data: { refundStatus: nextStatus, paymentRefundId: observation.providerRefundId, ...(newlySucceeded ? { completedAt: new Date() } : {}) } });
      if (newlySucceeded && refund.afterSales) {
        for (const item of refund.afterSales.items) await tx.orderItem.update({ where: { id: item.orderItemId }, data: { refundAmountCents: { increment: item.refundAmountCents } } });
        if (refund.afterSales.status === "REFUND_PROCESSING") {
          await tx.afterSalesRequest.update({ where: { id: refund.afterSales.id }, data: { status: "REFUNDED" } });
          await tx.afterSalesMessage.create({ data: { afterSalesId: refund.afterSales.id, senderType: "SYSTEM", senderId: "system", message: "原支付渠道已确认退款成功。" } });
        }
      }
      if (newlySucceeded) {
        const fullyRefunded = await syncOrderRefundStatus(tx, refund.orderId);
        // A partial external refund cannot void an entire gift card.
        if (fullyRefunded) await completeGiftRefund(tx, refund.orderId);
      }
      await tx.paymentNotification.update({ where: { id: savedNotification.id }, data: { processedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: input.actorId === "system" ? undefined : input.actorId, actorType: input.actorId === "system" ? "system" : "admin", action: `refund.wechat.${nextStatus.toLowerCase()}`, targetType: "refund", targetId: refund.id, detail: { eventId: input.eventId, providerRefundId: observation.providerRefundId, refundNo: refund.refundNo, observedStatus: observation.status, source: input.source, imported, linkedAfterSales: !!refund.afterSalesId } } });
      return tx.refund.findUniqueOrThrow({ where: { id: refund.id }, include: refundWriteInclude });
    }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 30_000 }); }
    catch (error) { if (attempt >= 3 || !isRetryableRefundTransaction(error)) throw error; await new Promise(resolve => setTimeout(resolve, 25 * (attempt + 1))); }
  }
}

async function loadExecutableRefund(refundNo: string) {
  const refund = await prisma.refund.findUnique({
    where: { refundNo },
    include: { order: true, payment: true, afterSales: true, admin: true },
  });
  if (!refund) throw new Error("REFUND_NOT_FOUND");
  if(refund.order.kind==='GIFT_PURCHASE'){
    const card=await prisma.giftCard.findUnique({where:{purchaseOrderId:refund.orderId}});
    if(!card||!['REFUND_PENDING','REFUNDED','CANCELLED'].includes(card.status)||card.redemptionOrderId)throw Error('GIFT_REFUND_UNAVAILABLE');
  }
  if (!["CREATED", "MANUAL_MARKED", "PROCESSING", "FAILED", "SUCCEEDED"].includes(refund.refundStatus)) {
    throw new Error("REFUND_STATUS_NOT_EXECUTABLE");
  }
  if (refund.refundAmountCents <= 0) throw new Error("REFUND_AMOUNT_INVALID");
  if (!refund.payment || refund.payment.amountCents < refund.refundAmountCents) throw new Error("REFUND_AMOUNT_EXCEEDS_PAYMENT");
  if (refund.refundStatus !== "SUCCEEDED") {
    const unlinked = await prisma.refund.findFirst({ where: { orderId: refund.orderId, id: { not: refund.id }, afterSalesId: null, paymentRefundId: { not: null }, refundStatus: { in: ["PROCESSING", "SUCCEEDED"] } }, select: { id: true } });
    if (unlinked) throw Error("REFUND_RECONCILIATION_REQUIRED");
  }
  const aggregate = await prisma.refund.aggregate({
    where: {
      paymentId: refund.paymentId,
      id: { not: refund.id },
      refundStatus: { in: ["CREATED", "MANUAL_MARKED", "PROCESSING", "SUCCEEDED"] },
    },
    _sum: { refundAmountCents: true },
  });
  if ((aggregate._sum.refundAmountCents ?? 0) + refund.refundAmountCents > refund.payment.amountCents) {
    throw new Error("REFUND_TOTAL_EXCEEDS_PAYMENT");
  }
  return refund;
}

async function auditUncertainRefund(refundId: string, refundNo: string, actorId: string, detail: unknown) {
  const errors = JSON.parse(JSON.stringify(detail, (_key, value) => value instanceof Error ? value.message : value)) as Prisma.InputJsonValue;
  await prisma.auditLog.create({
    data: {
      actorId,
      actorType: "admin",
      action: "refund.wechat.confirmation_required",
      targetType: "refund",
      targetId: refundId,
      detail: { refundNo, errors },
    },
  });
}

async function syncOrderRefundStatus(tx: Prisma.TransactionClient, orderId: string) {
  await reverseRefundPoints(tx, orderId);
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { payableAmountCents: true } });
  const aggregate = await tx.refund.aggregate({
    where: { orderId, refundStatus: "SUCCEEDED" },
    _sum: { refundAmountCents: true },
  });
  if ((aggregate._sum.refundAmountCents ?? 0) >= order.payableAmountCents) {
    await tx.order.update({ where: { id: orderId }, data: { paymentStatus: "REFUNDED" } });
    return true;
  }
  return false;
}

function assertPrismaStorage() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") throw new Error("WECHAT_PAY_REQUIRES_PRISMA");
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

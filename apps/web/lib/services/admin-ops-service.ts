import type { Prisma } from "@prisma/client";
import { appConfig } from "@/lib/config";
import { OFFICIAL_X_PROFILE_URL } from "@/lib/official-social";
import { prisma } from "@/lib/db/prisma";
import { getAdminBusinessOrderFilter } from "@/lib/services/admin-business-orders";
import {
  listAllRuntimeAfterSales,
  listAllRuntimeOrders,
  updateRuntimePaymentForAdmin,
  type RuntimePaymentStatus,
} from "@/lib/runtime-commerce";

type UserPatch = {
  role?: "CUSTOMER" | "ADMIN" | "OWNER";
  status?: "ACTIVE" | "DISABLED";
  name?: string;
  phone?: string;
  email?: string | null;
};

type SettingInput = {
  key: string;
  value: Prisma.InputJsonValue;
};

type PaymentPatch = {
  status?: "CREATED" | "REQUIRES_REDIRECT" | "PENDING" | "PAID" | "FAILED" | "CANCELLED";
  gatewayTradeNo?: string;
  note?: string;
};

type RuntimeUserRecord = {
  id: string;
  phone?: string;
  email?: string | null;
  name: string;
  role: "CUSTOMER" | "ADMIN" | "OWNER";
  status: "ACTIVE" | "DISABLED";
  orderCount: number;
  afterSalesCount: number;
  createdAt: Date;
  updatedAt: Date;
};

type RuntimeSettingRecord = {
  id: string;
  key: string;
  value: Prisma.InputJsonValue;
  createdAt: Date;
  updatedAt: Date;
};

type RuntimePaymentOverride = {
  gatewayTradeNo?: string;
  note?: string;
  updatedAt: Date;
};

type RuntimeAuditLog = {
  id: string;
  actorId?: string;
  actorType: string;
  action: string;
  targetType: string;
  targetId?: string;
  detail?: Prisma.InputJsonValue;
  createdAt: Date;
};

const globalForAdminOps = globalThis as typeof globalThis & {
  __merchantkitRuntimeUserOverrides?: Map<string, Partial<RuntimeUserRecord>>;
  __merchantkitRuntimeSettings?: Map<string, RuntimeSettingRecord>;
  __merchantkitRuntimePaymentOverrides?: Map<string, RuntimePaymentOverride>;
  __merchantkitRuntimeAuditLogs?: RuntimeAuditLog[];
};

const runtimeUserOverrides = globalForAdminOps.__merchantkitRuntimeUserOverrides ?? new Map<string, Partial<RuntimeUserRecord>>();
const runtimeSettings = globalForAdminOps.__merchantkitRuntimeSettings ?? new Map<string, RuntimeSettingRecord>();
const runtimePaymentOverrides = globalForAdminOps.__merchantkitRuntimePaymentOverrides ?? new Map<string, RuntimePaymentOverride>();
const runtimeAuditLogs = globalForAdminOps.__merchantkitRuntimeAuditLogs ?? [];
globalForAdminOps.__merchantkitRuntimeUserOverrides = runtimeUserOverrides;
globalForAdminOps.__merchantkitRuntimeSettings = runtimeSettings;
globalForAdminOps.__merchantkitRuntimePaymentOverrides = runtimePaymentOverrides;
globalForAdminOps.__merchantkitRuntimeAuditLogs = runtimeAuditLogs;

function ensureRuntimeSettings() {
  if (runtimeSettings.size > 0) return;
  const now = new Date();
  for (const [key, value] of Object.entries({
    siteName: "MerchantKit",
    commerceMode: "OPEN",
    supportPhone: "",
    supportEmail: "support@example.invalid",
    xProfileUrl: OFFICIAL_X_PROFILE_URL,
    shippingFeeCents: 0,
    shippingRemoteFeeCents: 1000,
    shippingFarRemoteFeeCents: 2000,
    paymentProvider: appConfig.PAYMENT_PROVIDER,
    smsProvider: appConfig.SMS_PROVIDER,
  })) {
    runtimeSettings.set(key, {
      id: `runtime-setting-${key}`,
      key,
      value,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function listAdminUsers() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return listRuntimeAdminUsers();
  }

  return prisma.user.findMany({
    select: {
      id: true,
      phone: true,
      email: true,
      name: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      lastLoginAt: true,
      customerProfile: true,
      _count: {
        select: {
          orders: { where: await getAdminBusinessOrderFilter() },
          addresses: true,
          afterSalesRequests: true,
          sessions: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function getAdminUserDetail(userId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const user = listRuntimeAdminUsers().find((item) => item.id === userId);
    if (!user) return null;
    const orders = listAllRuntimeOrders().filter((order) => order.userId === userId);
    const afterSalesRequests = listAllRuntimeAfterSales().filter((request) => request.userId === userId);
    const auditLogs = runtimeAuditLogs.filter((log) => log.actorId === userId || log.targetId === userId).slice(0, 20);
    return {
      ...user,
      addresses: [],
      orders,
      afterSalesRequests,
      loginLogs: [],
      sessions: [],
      auditLogs,
    };
  }

  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      phone: true,
      email: true,
      name: true,
      role: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      lastLoginAt: true,
      customerProfile: true,
      addresses: {
        orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
        take: 10,
      },
      orders: {
        where: await getAdminBusinessOrderFilter(),
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          orderNo: true,
          status: true,
          paymentStatus: true,
          fulfillmentStatus: true,
          payableAmountCents: true,
          currency: true,
          createdAt: true,
          updatedAt: true,
          items: {
            select: {
              id: true,
              productName: true,
              color: true,
              size: true,
              quantity: true,
            },
          },
        },
      },
      afterSalesRequests: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          afterSalesNo: true,
          order: { select: { orderNo: true } },
          type: true,
          reason: true,
          status: true,
          refundAmountCents: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      loginLogs: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      sessions: {
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          expiresAt: true,
          ip: true,
          userAgent: true,
          createdAt: true,
        },
      },
      auditLogs: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      _count: {
        select: {
          orders: { where: await getAdminBusinessOrderFilter() },
          addresses: true,
          afterSalesRequests: true,
          sessions: true,
          loginLogs: true,
          auditLogs: true,
        },
      },
    },
  });
}

export async function updateAdminUser(userId: string, input: UserPatch, actorId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const users = listRuntimeAdminUsers();
    const current = users.find((user) => user.id === userId);
    if (!current) throw new Error("USER_NOT_FOUND");
    const updated = { ...current, ...input, updatedAt: new Date() };
    runtimeUserOverrides.set(userId, updated);
    writeRuntimeAdminAudit(actorId, "admin.user.updated", "user", userId, input);
    return updated;
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: input,
  });
  await writePrismaAudit(actorId, "admin.user.updated", "user", userId, input);
  return user;
}

export async function listAdminPayments() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return listAllRuntimeOrders().map((order) => {
      const id = `runtime-payment-${order.orderNo}`;
      const override = runtimePaymentOverrides.get(id);
      return {
        id,
        orderNo: order.orderNo,
        provider: "mock",
        status: order.paymentStatus,
        amountCents: order.payableAmountCents,
        currency: order.currency,
        merchantOrderNo: order.orderNo,
        gatewayTradeNo: override?.gatewayTradeNo,
        note: override?.note,
        createdAt: order.createdAt,
        updatedAt: override?.updatedAt ?? order.updatedAt,
      };
    });
  }

  return prisma.paymentIntent.findMany({
    where: { order: await getAdminBusinessOrderFilter() },
    select: {
      id: true,
      provider: true,
      status: true,
      amountCents: true,
      currency: true,
      merchantOrderNo: true,
      gatewayTradeNo: true,
      createdAt: true,
      updatedAt: true,
      order: { select: { orderNo: true } },
      notifications: {
        orderBy: { createdAt: "desc" },
        take: 5,
        select: { id: true, tradeNo: true, status: true, verified: true, createdAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function listAdminOrdersMissingPaymentIntents() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return [];
  }

  return prisma.order.findMany({
    where: {
      AND: [await getAdminBusinessOrderFilter()],
      paymentStatus: { in: ["NOT_STARTED", "PENDING"] },
      paymentIntents: { none: {} },
      status: { notIn: ["CANCELLED", "CLOSED"] },
    },
    select: {
      id: true,
      orderNo: true,
      paymentStatus: true,
      payableAmountCents: true,
      createdAt: true,
      user: {
        select: {
          phone: true,
          name: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function syncPaymentForAdminFromProvider(paymentId: string, input: PaymentPatch, actorId: string) {
  if (!input.status && !input.gatewayTradeNo && !input.note) throw new Error("PAYMENT_UPDATE_EMPTY");

  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const orderNo = paymentId.startsWith("runtime-payment-") ? paymentId.replace("runtime-payment-", "") : paymentId;
    const paymentStatus = input.status ? toRuntimePaymentStatus(input.status) : undefined;
    const order = paymentStatus
      ? updateRuntimePaymentForAdmin(orderNo, {
          paymentStatus,
          actorId,
          gatewayTradeNo: input.gatewayTradeNo,
          note: input.note,
        })
      : listAllRuntimeOrders().find((candidate) => candidate.orderNo === orderNo);
    if (!order) throw new Error("PAYMENT_NOT_FOUND");

    const runtimePaymentId = `runtime-payment-${order.orderNo}`;
    if (input.gatewayTradeNo || input.note) {
      runtimePaymentOverrides.set(runtimePaymentId, {
        ...runtimePaymentOverrides.get(runtimePaymentId),
        gatewayTradeNo: input.gatewayTradeNo ?? runtimePaymentOverrides.get(runtimePaymentId)?.gatewayTradeNo,
        note: input.note ?? runtimePaymentOverrides.get(runtimePaymentId)?.note,
        updatedAt: new Date(),
      });
    }
    writeRuntimeAdminAudit(actorId, "admin.payment.provider_synced", "payment_intent", runtimePaymentId, {
      paymentId: runtimePaymentId,
      orderNo: order.orderNo,
      status: input.status,
      paymentStatus: order.paymentStatus,
      gatewayTradeNo: input.gatewayTradeNo,
      note: input.note,
    });
    return {
      id: runtimePaymentId,
      orderNo: order.orderNo,
      provider: "mock",
      status: order.paymentStatus,
      amountCents: order.payableAmountCents,
      currency: order.currency,
      merchantOrderNo: order.orderNo,
      gatewayTradeNo: runtimePaymentOverrides.get(runtimePaymentId)?.gatewayTradeNo,
      note: runtimePaymentOverrides.get(runtimePaymentId)?.note,
      createdAt: order.createdAt,
      updatedAt: runtimePaymentOverrides.get(runtimePaymentId)?.updatedAt ?? order.updatedAt,
    };
  }

  return prisma.$transaction(async (tx) => {
    const payment = await tx.paymentIntent.findUnique({
      where: { id: paymentId },
      include: { order: true },
    });
    if (!payment) throw new Error("PAYMENT_NOT_FOUND");
    if (input.status === "PAID" && payment.order.status === "CANCELLED") {
      throw new Error("CANCELLED_ORDER_CANNOT_PAY");
    }

    const updatedPayment = await tx.paymentIntent.update({
      where: { id: payment.id },
      data: {
        status: input.status,
        gatewayTradeNo: input.gatewayTradeNo ?? undefined,
        rawResponse: input.note
          ? {
              ...(isRecord(payment.rawResponse) ? payment.rawResponse : {}),
              adminNote: input.note,
              adminUpdatedAt: new Date().toISOString(),
            }
          : undefined,
      },
      include: {
        order: true,
        notifications: { orderBy: { createdAt: "desc" }, take: 5 },
        refunds: true,
      },
    });

    if (input.status) {
      const orderUpdateData: Prisma.OrderUpdateInput = { paymentStatus: toOrderPaymentStatus(input.status) };
      if (input.status === "PAID" && payment.order.status === "CREATED") {
        orderUpdateData.status = "CONFIRMED";
      }
      await tx.order.update({
        where: { id: payment.orderId },
        data: orderUpdateData,
      });
    }

    await tx.auditLog.create({
      data: {
        actorId,
        actorType: "admin",
        action: "admin.payment.provider_synced",
        targetType: "payment_intent",
        targetId: payment.id,
        detail: {
          paymentId: payment.id,
          orderNo: payment.order.orderNo,
          before: {
            status: payment.status,
            gatewayTradeNo: payment.gatewayTradeNo,
          },
          after: {
            status: updatedPayment.status,
            gatewayTradeNo: updatedPayment.gatewayTradeNo,
          },
          note: input.note,
        },
      },
    });

    return updatedPayment;
  });
}

export async function listAdminPaymentNotifications() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return [];
  }

  return prisma.paymentNotification.findMany({
    where: { OR: [{ orderId: null }, { order: { is: await getAdminBusinessOrderFilter() } }] },
    include: {
      order: true,
      payment: true,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function listAdminSettings() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    ensureRuntimeSettings();
    return Array.from(runtimeSettings.values()).sort((a, b) => a.key.localeCompare(b.key));
  }

  return prisma.siteSetting.findMany({
    orderBy: { key: "asc" },
  });
}

export async function upsertAdminSetting(input: SettingInput, actorId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    ensureRuntimeSettings();
    const now = new Date();
    const existing = runtimeSettings.get(input.key);
    const setting: RuntimeSettingRecord = {
      id: existing?.id ?? `runtime-setting-${input.key}`,
      key: input.key,
      value: input.value,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    runtimeSettings.set(input.key, setting);
    writeRuntimeAdminAudit(actorId, "admin.setting.upserted", "site_setting", input.key, input);
    return setting;
  }

  const setting = await prisma.siteSetting.upsert({
    where: { key: input.key },
    update: { value: input.value },
    create: input,
  });
  await writePrismaAudit(actorId, "admin.setting.upserted", "site_setting", setting.id, input);
  return setting;
}

export async function upsertAdminSettings(inputs: SettingInput[], actorId: string) {
  if (inputs.length === 0) return [];
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const results = [];
    for (const input of inputs) results.push(await upsertAdminSetting(input, actorId));
    return results;
  }

  return prisma.$transaction(async (tx) => {
    const settings = [];
    for (const input of inputs) {
      settings.push(await tx.siteSetting.upsert({
        where: { key: input.key },
        update: { value: input.value },
        create: input,
      }));
    }
    await tx.auditLog.create({
      data: {
        actorId,
        actorType: "admin",
        action: "admin.settings.updated",
        targetType: "site_setting",
        detail: JSON.parse(JSON.stringify({ keys: inputs.map((item) => item.key) })) as Prisma.InputJsonValue,
      },
    });
    return settings;
  });
}

export async function listAdminAuditLogs() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return [...runtimeAuditLogs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 100);
  }

  return prisma.auditLog.findMany({
    include: { actor: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function writeAdminAudit(actorId: string, action: string, targetType: string, targetId: string, detail: unknown) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    writeRuntimeAdminAudit(actorId, action, targetType, targetId, detail);
    return;
  }
  await writePrismaAudit(actorId, action, targetType, targetId, detail);
}

function listRuntimeAdminUsers(): RuntimeUserRecord[] {
  const orders = listAllRuntimeOrders();
  const afterSales = listAllRuntimeAfterSales();
  const userIds = new Set<string>([
    ...orders.map((order) => order.userId),
    ...afterSales.map((request) => request.userId),
    "mock-admin-local",
  ]);
  const now = new Date();

  return Array.from(userIds).map((userId) => {
    const override = runtimeUserOverrides.get(userId);
    const phone = userId.startsWith("mock-user-") ? userId.replace("mock-user-", "") : undefined;
    return {
      id: userId,
      phone,
      name: userId === "mock-admin-local" ? "Local Admin" : phone ? `User ${phone.slice(-4)}` : userId,
      role: userId === "mock-admin-local" ? "ADMIN" : "CUSTOMER",
      status: "ACTIVE",
      orderCount: orders.filter((order) => order.userId === userId).length,
      afterSalesCount: afterSales.filter((request) => request.userId === userId).length,
      createdAt: orders.find((order) => order.userId === userId)?.createdAt ?? now,
      updatedAt: now,
      ...override,
    };
  });
}

function toRuntimePaymentStatus(status: NonNullable<PaymentPatch["status"]>): RuntimePaymentStatus {
  if (status === "PAID") return "paid";
  if (status === "FAILED") return "failed";
  if (status === "CANCELLED") return "cancelled";
  if (status === "CREATED") return "not_started";
  return "pending";
}

function toOrderPaymentStatus(status: NonNullable<PaymentPatch["status"]>) {
  if (status === "PAID") return "PAID";
  if (status === "FAILED") return "FAILED";
  if (status === "CANCELLED") return "CANCELLED";
  return "PENDING";
}

function isRecord(value: unknown): value is Record<string, Prisma.JsonValue> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function writeRuntimeAdminAudit(
  actorId: string,
  action: string,
  targetType: string,
  targetId: string,
  detail: unknown,
) {
  writeRuntimeAudit({
    actorId,
    actorType: "admin",
    action,
    targetType,
    targetId,
    detail,
  });
}

export function writeRuntimeAudit({
  action,
  actorId,
  actorType,
  detail,
  targetId,
  targetType,
}: {
  actorId?: string;
  actorType: string;
  action: string;
  targetType: string;
  targetId?: string;
  detail?: unknown;
}) {
  runtimeAuditLogs.unshift({
    id: `runtime-audit-${runtimeAuditLogs.length + 1}`,
    actorId,
    actorType,
    action,
    targetType,
    targetId,
    detail: toJson(detail),
    createdAt: new Date(),
  });
}

async function writePrismaAudit(actorId: string, action: string, targetType: string, targetId: string, detail: unknown) {
  await prisma.auditLog.create({
    data: {
      actorId,
      actorType: "admin",
      action,
      targetType,
      targetId,
      detail: toJson(detail),
    },
  });
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

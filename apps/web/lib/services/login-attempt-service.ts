import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { normalizeMainlandPhone } from "@/lib/providers/sms";

export type PasswordLoginScope = "customer_password" | "admin_password";

type LoginAttemptMeta = {
  ip?: string;
  phone: string;
  scope: PasswordLoginScope;
  userAgent?: string;
};

type RuntimeFailure = {
  createdAt: Date;
  ip?: string;
  phone: string;
  scope: PasswordLoginScope;
};

type WeChatLoginAttemptMeta = {
  ip?: string;
  userAgent?: string;
};

type RuntimeWeChatFailure = WeChatLoginAttemptMeta & {
  createdAt: Date;
};

const passwordFailureWindowMs = 15 * 60 * 1000;
const maxPasswordFailuresPerWindow = 5;
const maxWeChatFailuresPerWindow = 10;

const globalForLoginAttempts = globalThis as typeof globalThis & {
  __merchantkitPasswordLoginFailures?: RuntimeFailure[];
  __merchantkitWeChatLoginFailures?: RuntimeWeChatFailure[];
};

const runtimeFailures = globalForLoginAttempts.__merchantkitPasswordLoginFailures ?? [];
globalForLoginAttempts.__merchantkitPasswordLoginFailures = runtimeFailures;
const runtimeWeChatFailures = globalForLoginAttempts.__merchantkitWeChatLoginFailures ?? [];
globalForLoginAttempts.__merchantkitWeChatLoginFailures = runtimeWeChatFailures;

export function getClientIp(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || undefined;
}

export async function assertPasswordLoginAllowed(meta: LoginAttemptMeta) {
  const normalizedPhone = normalizeLoginPhone(meta.phone);
  const since = new Date(Date.now() - passwordFailureWindowMs);

  if (appConfig.COMMERCE_STORAGE === "prisma") {
    const byPhone = await prisma.loginLog.count({
      where: {
        phone: normalizedPhone,
        success: false,
        failureReason: { startsWith: `${meta.scope}:` },
        createdAt: { gte: since },
      },
    });
    const byIp = meta.ip
      ? await prisma.loginLog.count({
          where: {
            ip: meta.ip,
            success: false,
            failureReason: { startsWith: `${meta.scope}:` },
            createdAt: { gte: since },
          },
        })
      : 0;
    if (byPhone >= maxPasswordFailuresPerWindow || byIp >= maxPasswordFailuresPerWindow) {
      throw new Error("PASSWORD_LOGIN_RATE_LIMITED");
    }
    return;
  }

  pruneRuntimeFailures();
  const byPhone = runtimeFailures.filter((failure) => failure.scope === meta.scope && failure.phone === normalizedPhone).length;
  const byIp = meta.ip
    ? runtimeFailures.filter((failure) => failure.scope === meta.scope && failure.ip === meta.ip).length
    : 0;
  if (byPhone >= maxPasswordFailuresPerWindow || byIp >= maxPasswordFailuresPerWindow) {
    throw new Error("PASSWORD_LOGIN_RATE_LIMITED");
  }
}

export async function recordPasswordLoginFailure(meta: LoginAttemptMeta & { reason: string }) {
  const normalizedPhone = normalizeLoginPhone(meta.phone);
  if (appConfig.COMMERCE_STORAGE === "prisma") {
    await prisma.loginLog.create({
      data: {
        phone: normalizedPhone,
        ip: meta.ip,
        userAgent: meta.userAgent,
        success: false,
        failureReason: `${meta.scope}:${meta.reason}`,
      },
    });
    return;
  }

  pruneRuntimeFailures();
  runtimeFailures.push({
    createdAt: new Date(),
    ip: meta.ip,
    phone: normalizedPhone,
    scope: meta.scope,
  });
}

export async function clearPasswordLoginFailures(meta: LoginAttemptMeta) {
  const normalizedPhone = normalizeLoginPhone(meta.phone);
  if (appConfig.COMMERCE_STORAGE === "prisma") return;

  for (let index = runtimeFailures.length - 1; index >= 0; index -= 1) {
    const failure = runtimeFailures[index];
    if (failure.scope !== meta.scope) continue;
    if (failure.phone === normalizedPhone || (meta.ip && failure.ip === meta.ip)) {
      runtimeFailures.splice(index, 1);
    }
  }
}

export async function assertWeChatLoginAllowed(meta: WeChatLoginAttemptMeta) {
  if (!meta.ip) return;
  const since = new Date(Date.now() - passwordFailureWindowMs);

  if (appConfig.COMMERCE_STORAGE === "prisma") {
    const failures = await prisma.loginLog.count({
      where: {
        ip: meta.ip,
        success: false,
        failureReason: { startsWith: "wechat:" },
        createdAt: { gte: since },
      },
    });
    if (failures >= maxWeChatFailuresPerWindow) throw new Error("WECHAT_LOGIN_RATE_LIMITED");
    return;
  }

  pruneRuntimeWeChatFailures();
  const failures = runtimeWeChatFailures.filter((failure) => failure.ip === meta.ip).length;
  if (failures >= maxWeChatFailuresPerWindow) throw new Error("WECHAT_LOGIN_RATE_LIMITED");
}

export async function recordWeChatLoginFailure(meta: WeChatLoginAttemptMeta & { reason: string }) {
  if (appConfig.COMMERCE_STORAGE === "prisma") {
    await prisma.loginLog.create({
      data: {
        ip: meta.ip,
        userAgent: meta.userAgent,
        success: false,
        failureReason: `wechat:${meta.reason}`,
      },
    });
    return;
  }

  pruneRuntimeWeChatFailures();
  runtimeWeChatFailures.push({ createdAt: new Date(), ip: meta.ip, userAgent: meta.userAgent });
}

function normalizeLoginPhone(phone: string) {
  return normalizeMainlandPhone(phone || "");
}

function pruneRuntimeFailures() {
  const cutoff = Date.now() - passwordFailureWindowMs;
  for (let index = runtimeFailures.length - 1; index >= 0; index -= 1) {
    if (runtimeFailures[index].createdAt.getTime() < cutoff) runtimeFailures.splice(index, 1);
  }
}

function pruneRuntimeWeChatFailures() {
  const cutoff = Date.now() - passwordFailureWindowMs;
  for (let index = runtimeWeChatFailures.length - 1; index >= 0; index -= 1) {
    if (runtimeWeChatFailures[index].createdAt.getTime() < cutoff) runtimeWeChatFailures.splice(index, 1);
  }
}

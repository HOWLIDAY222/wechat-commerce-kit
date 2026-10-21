import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { isMainlandPhone, normalizeMainlandPhone } from "@/lib/providers/sms";
import { maskPhone, toActorType } from "@/lib/services/auth-audit-service";
import { writeRuntimeAudit } from "@/lib/services/admin-ops-service";
import type { SessionRole } from "@/lib/auth/session";

type RuntimePasswordRecord = {
  userId: string;
  phone: string;
  role: SessionRole;
  passwordHash: string;
  passwordSalt: string;
};

type PasswordLoginTarget = {
  userId: string;
  phone: string;
  role: SessionRole;
};

const globalForRuntimePasswords = globalThis as typeof globalThis & {
  __merchantkitRuntimePasswords?: Map<string, RuntimePasswordRecord>;
};

const runtimePasswords = globalForRuntimePasswords.__merchantkitRuntimePasswords ?? new Map<string, RuntimePasswordRecord>();
globalForRuntimePasswords.__merchantkitRuntimePasswords = runtimePasswords;

export function assertValidPassword(password: string) {
  if (password.length < 8 || password.length > 72) {
    throw new Error("PASSWORD_LENGTH_INVALID");
  }
}

export function createPasswordHash(password: string) {
  assertValidPassword(password);
  const salt = randomBytes(16).toString("hex");
  return {
    passwordHash: hashPassword(password, salt),
    passwordSalt: salt,
  };
}

export async function getAccountPasswordState(userId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return { hasPassword: Array.from(runtimePasswords.values()).some((record) => record.userId === userId) };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, passwordSalt: true },
  });
  return { hasPassword: Boolean(user?.passwordHash && user.passwordSalt) };
}

export async function setAccountPassword({
  currentPassword,
  newPassword,
  phone,
  role,
  userId,
}: {
  currentPassword?: string;
  newPassword: string;
  phone?: string;
  role: SessionRole;
  userId: string;
}) {
  assertValidPassword(newPassword);

  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const existing = Array.from(runtimePasswords.values()).find((record) => record.userId === userId);
    if (existing) {
      if (!currentPassword) throw new Error("CURRENT_PASSWORD_REQUIRED");
      if (!verifyPassword(currentPassword, existing.passwordSalt, existing.passwordHash)) throw new Error("CURRENT_PASSWORD_INVALID");
    }
    const hashed = createPasswordHash(newPassword);
    const normalizedPhone = phone ? normalizeMainlandPhone(phone) : existing?.phone;
    if (!normalizedPhone || !isMainlandPhone(normalizedPhone)) throw new Error("PASSWORD_PHONE_REQUIRED");
    const record: RuntimePasswordRecord = {
      userId,
      phone: normalizedPhone,
      role,
      ...hashed,
    };
    const phoneMasked = maskPhone(normalizedPhone);
    runtimePasswords.set(normalizedPhone, record);
    writeRuntimeAudit({
      actorId: userId,
      actorType: toActorType(role),
      action: existing ? "account.password.updated" : "account.password.set",
      targetType: "user",
      targetId: userId,
      detail: {
        role,
        ...(phoneMasked ? { phoneMasked } : {}),
      },
    });
    return { hasPassword: true };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, passwordHash: true, passwordSalt: true },
  });
  if (!user) throw new Error("USER_NOT_FOUND");

  if (user.passwordHash && user.passwordSalt) {
    if (!currentPassword) throw new Error("CURRENT_PASSWORD_REQUIRED");
    if (!verifyPassword(currentPassword, user.passwordSalt, user.passwordHash)) throw new Error("CURRENT_PASSWORD_INVALID");
  }

  const hadPassword = Boolean(user.passwordHash && user.passwordSalt);
  const hashed = createPasswordHash(newPassword);
  const phoneMasked = maskPhone(phone);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: hashed,
    });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorType: toActorType(role),
        action: hadPassword ? "account.password.updated" : "account.password.set",
        targetType: "user",
        targetId: userId,
        detail: {
          role,
          ...(phoneMasked ? { phoneMasked } : {}),
        },
      },
    });
  });
  return { hasPassword: true };
}

export async function verifyCustomerPasswordLogin(phone: string, password: string): Promise<PasswordLoginTarget> {
  const normalized = normalizeAndValidatePhone(phone);
  assertValidPassword(password);

  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const record = runtimePasswords.get(normalized);
    if (!record) throw new Error("PASSWORD_NOT_SET");
    if (!verifyPassword(password, record.passwordSalt, record.passwordHash)) throw new Error("PASSWORD_INVALID");
    return { userId: record.userId, phone: record.phone, role: record.role };
  }

  const user = await prisma.user.findUnique({
    where: { phone: normalized },
    select: { id: true, phone: true, role: true, status: true, passwordHash: true, passwordSalt: true },
  });
  if (!user || user.status !== "ACTIVE") throw new Error("USER_NOT_FOUND");
  if (!user.passwordHash || !user.passwordSalt) throw new Error("PASSWORD_NOT_SET");
  if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) throw new Error("PASSWORD_INVALID");

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  return {
    userId: user.id,
    phone: user.phone ?? normalized,
    role: user.role === "OWNER" ? "owner" : user.role === "ADMIN" ? "admin" : "customer",
  };
}

export async function verifyPasswordForUser(userId: string, password: string) {
  assertValidPassword(password);

  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const record = Array.from(runtimePasswords.values()).find((item) => item.userId === userId);
    if (!record) throw new Error("PASSWORD_NOT_SET");
    if (!verifyPassword(password, record.passwordSalt, record.passwordHash)) throw new Error("PASSWORD_INVALID");
    return true;
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, passwordSalt: true, status: true },
  });
  if (!user || user.status !== "ACTIVE") throw new Error("USER_NOT_FOUND");
  if (!user.passwordHash || !user.passwordSalt) throw new Error("PASSWORD_NOT_SET");
  if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) throw new Error("PASSWORD_INVALID");
  return true;
}

function normalizeAndValidatePhone(phone: string) {
  const normalized = normalizeMainlandPhone(phone);
  if (!isMainlandPhone(normalized)) throw new Error("INVALID_PHONE");
  return normalized;
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString("hex");
}

function verifyPassword(password: string, salt: string, expectedHash: string) {
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

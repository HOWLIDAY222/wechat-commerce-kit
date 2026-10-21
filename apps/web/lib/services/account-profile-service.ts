import type { Prisma } from "@prisma/client";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { isMainlandPhone, normalizeMainlandPhone } from "@/lib/providers/sms";

export type AccountProfile = {
  birthYear: number | null;
  countryCode: string | null;
  createdAt: Date | string;
  email: string | null;
  gender: string | null;
  id: string;
  marketingGranted: boolean;
  name: string;
  personalizationGranted: boolean;
  phone: string | null;
  preferredLocale: string | null;
  role: string;
  updatedAt: Date | string;
};

type AccountProfilePatch = {
  birthYear?: number | null;
  countryCode?: string | null;
  email?: string | null;
  gender?: "MALE" | "FEMALE" | "NON_BINARY" | "PREFER_NOT_TO_SAY" | null;
  marketingGranted?: boolean;
  name: string;
  personalizationGranted?: boolean;
  phone: string;
  preferredLocale?: "zh-CN" | "en" | null;
};

type RuntimeProfile = AccountProfile;

const globalForAccountProfiles = globalThis as typeof globalThis & {
  __merchantkitRuntimeAccountProfiles?: Map<string, RuntimeProfile>;
};

const runtimeAccountProfiles = globalForAccountProfiles.__merchantkitRuntimeAccountProfiles ?? new Map<string, RuntimeProfile>();
globalForAccountProfiles.__merchantkitRuntimeAccountProfiles = runtimeAccountProfiles;

export async function getAccountProfile(userId: string, fallback?: { phone?: string }) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return getRuntimeProfile(userId, fallback);
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      createdAt: true,
      email: true,
      id: true,
      name: true,
      phone: true,
      role: true,
      updatedAt: true,
      customerProfile: true,
    },
  });
  if (!user) throw new Error("ACCOUNT_NOT_FOUND");
  return flattenProfile(user);
}

export async function updateAccountProfile(userId: string, input: AccountProfilePatch) {
  const normalizedPhone = normalizeMainlandPhone(input.phone);
  if (!isMainlandPhone(normalizedPhone)) throw new Error("INVALID_PHONE");

  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const current = getRuntimeProfile(userId, { phone: normalizedPhone });
    const updated = {
      ...current,
      birthYear: input.birthYear ?? null,
      countryCode: input.countryCode ?? null,
      email: input.email ?? null,
      gender: input.gender ?? null,
      marketingGranted: input.marketingGranted ?? false,
      name: input.name,
      personalizationGranted: input.personalizationGranted ?? false,
      phone: normalizedPhone,
      preferredLocale: input.preferredLocale ?? null,
      updatedAt: new Date(),
    };
    runtimeAccountProfiles.set(userId, updated);
    return updated;
  }

  await assertUniqueAccountFields(userId, { ...input, phone: normalizedPhone });
  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      email: input.email ?? null,
      name: input.name,
      phone: normalizedPhone,
      customerProfile: {
        upsert: {
          create: {
            birthYear: input.birthYear,
            countryCode: input.countryCode,
            gender: input.gender,
            marketingGranted: input.marketingGranted ?? false,
            personalizationGranted: input.personalizationGranted ?? false,
            preferredLocale: input.preferredLocale,
          },
          update: {
            birthYear: input.birthYear,
            countryCode: input.countryCode,
            gender: input.gender,
            marketingGranted: input.marketingGranted,
            personalizationGranted: input.personalizationGranted,
            preferredLocale: input.preferredLocale,
          },
        },
      },
    },
    select: {
      createdAt: true,
      email: true,
      id: true,
      name: true,
      phone: true,
      role: true,
      updatedAt: true,
      customerProfile: true,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: userId,
      actorType: "user",
      action: "account.profile.updated",
      targetType: "user",
      targetId: userId,
      detail: {
        emailUpdated: typeof input.email !== "undefined",
        nameUpdated: true,
        phoneUpdated: true,
        demographicsUpdated: true,
        personalizationGranted: input.personalizationGranted ?? false,
        marketingGranted: input.marketingGranted ?? false,
      },
    },
  });

  await prisma.privacyConsent.createMany({
    data: [
      { userId, category: "PERSONALIZATION", granted: input.personalizationGranted ?? false, policyVersion: "2026-08-19", locale: input.preferredLocale, source: "account-profile", withdrawnAt: input.personalizationGranted ? null : new Date() },
      { userId, category: "MARKETING", granted: input.marketingGranted ?? false, policyVersion: "2026-08-19", locale: input.preferredLocale, source: "account-profile", withdrawnAt: input.marketingGranted ? null : new Date() },
    ],
  });
  return flattenProfile(user);
}

async function assertUniqueAccountFields(userId: string, input: AccountProfilePatch) {
  const or: Prisma.UserWhereInput[] = [{ phone: input.phone }];
  if (input.email) or.push({ email: input.email });

  const conflict = await prisma.user.findFirst({
    where: {
      id: { not: userId },
      OR: or,
    },
    select: {
      email: true,
      phone: true,
    },
  });
  if (!conflict) return;
  if (conflict.phone === input.phone) throw new Error("ACCOUNT_PHONE_IN_USE");
  if (input.email && conflict.email === input.email) throw new Error("ACCOUNT_EMAIL_IN_USE");
}

function getRuntimeProfile(userId: string, fallback?: { phone?: string }): RuntimeProfile {
  const existing = runtimeAccountProfiles.get(userId);
  if (existing) return existing;
  const now = new Date();
  const profile = {
    birthYear: null,
    countryCode: null,
    createdAt: now,
    email: null,
    gender: null,
    id: userId,
    marketingGranted: false,
    name: fallback?.phone ? `User ${fallback.phone.slice(-4)}` : "MerchantKit 用户",
    personalizationGranted: false,
    phone: fallback?.phone ? normalizeMainlandPhone(fallback.phone) : null,
    preferredLocale: "zh-CN",
    role: "CUSTOMER",
    updatedAt: now,
  };
  runtimeAccountProfiles.set(userId, profile);
  return profile;
}

function flattenProfile(user: {
  birthYear?: never;
  countryCode?: never;
  createdAt: Date;
  customerProfile: { birthYear: number | null; countryCode: string | null; gender: string | null; marketingGranted: boolean; personalizationGranted: boolean; preferredLocale: string | null } | null;
  email: string | null;
  id: string;
  name: string;
  phone: string | null;
  role: string;
  updatedAt: Date;
}): AccountProfile {
  return {
    birthYear: user.customerProfile?.birthYear ?? null,
    countryCode: user.customerProfile?.countryCode ?? null,
    createdAt: user.createdAt,
    email: user.email,
    gender: user.customerProfile?.gender ?? null,
    id: user.id,
    marketingGranted: user.customerProfile?.marketingGranted ?? false,
    name: user.name,
    personalizationGranted: user.customerProfile?.personalizationGranted ?? false,
    phone: user.phone,
    preferredLocale: user.customerProfile?.preferredLocale ?? null,
    role: user.role,
    updatedAt: user.updatedAt,
  };
}

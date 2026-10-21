import { createHmac, randomInt, randomUUID } from "crypto";
import { appConfig } from "@/lib/config";
import {
  assertAliyunSmsRequestShape,
  buildAliyunSmsRequest,
  getAliyunSmsProviderStatus,
  sendAliyunSms,
} from "@/lib/providers/aliyun-sms";

export type SmsScene = "login" | "register" | "checkout";

export type SmsIssueResult = {
  provider: "mock" | "aliyun";
  phone: string;
  scene: SmsScene;
  nonce: string;
  codeHash: string;
  expiresAt: Date;
  devCode?: string;
};

type StoredSmsCode = {
  phone: string;
  scene: SmsScene;
  nonce: string;
  codeHash: string;
  expiresAt: Date;
  createdAt: Date;
  ip?: string;
  consumedAt?: Date;
};

type SmsMeta = {
  ip?: string;
  userAgent?: string;
};

export type SmsVerifyResult =
  | { ok: true; phone: string; scene: SmsScene }
  | { ok: false; error: string };

export type SmsCooldownError = Error & {
  retryAfterSeconds: number;
};

const globalForSmsCodes = globalThis as typeof globalThis & {
  __merchantkitIssuedSmsCodes?: Map<string, StoredSmsCode[]>;
};

const issuedCodes = globalForSmsCodes.__merchantkitIssuedSmsCodes ?? new Map<string, StoredSmsCode[]>();
globalForSmsCodes.__merchantkitIssuedSmsCodes = issuedCodes;

export function normalizeMainlandPhone(value: string) {
  return value.replace(/\D/g, "").replace(/^86/, "");
}

export function isMainlandPhone(value: string) {
  return /^1[3-9]\d{9}$/.test(normalizeMainlandPhone(value));
}

export function hashSmsCode(phone: string, code: string, nonce: string) {
  return createHmac("sha256", appConfig.SESSION_SECRET)
    .update([normalizeMainlandPhone(phone), code, nonce].join("|"))
    .digest("hex");
}

export function createSmsCooldownError(retryAfterSeconds: number): SmsCooldownError {
  const error = new Error("SMS_SEND_COOLDOWN") as SmsCooldownError;
  error.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  return error;
}

function getPhoneRecords(phone: string) {
  return issuedCodes.get(phone) ?? [];
}

function pruneExpiredRecords(phone: string) {
  const now = Date.now();
  const active = getPhoneRecords(phone).filter((record) => {
    return record.expiresAt.getTime() > now || now - record.createdAt.getTime() < 24 * 60 * 60 * 1000;
  });
  issuedCodes.set(phone, active);
  return active;
}

function assertCanIssueCode(phone: string, meta?: SmsMeta) {
  const now = Date.now();
  const records = pruneExpiredRecords(phone);
  const lastRecord = records.at(-1);
  const cooldownMs = appConfig.SMS_SEND_COOLDOWN_SECONDS * 1000;

  if (lastRecord && now - lastRecord.createdAt.getTime() < cooldownMs) {
    throw createSmsCooldownError((cooldownMs - (now - lastRecord.createdAt.getTime())) / 1000);
  }

  const hourAgo = now - 60 * 60 * 1000;
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const hourlyCount = records.filter((record) => record.createdAt.getTime() >= hourAgo).length;
  const dailyCount = records.filter((record) => record.createdAt.getTime() >= dayAgo).length;

  if (hourlyCount >= appConfig.SMS_MAX_SENDS_PER_HOUR) {
    throw new Error("SMS_PHONE_HOURLY_LIMIT");
  }
  if (dailyCount >= appConfig.SMS_MAX_SENDS_PER_DAY) {
    throw new Error("SMS_PHONE_DAILY_LIMIT");
  }

  if (meta?.ip) {
    let ipHourlyCount = 0;
    for (const phoneRecords of issuedCodes.values()) {
      ipHourlyCount += phoneRecords.filter((record) => {
        return record.ip === meta.ip && record.createdAt.getTime() >= hourAgo;
      }).length;
    }
    if (ipHourlyCount >= appConfig.SMS_MAX_IP_SENDS_PER_HOUR) {
      throw new Error("SMS_IP_HOURLY_LIMIT");
    }
  }
}

export async function issueSmsCode(phone: string, scene: SmsScene, meta?: SmsMeta): Promise<SmsIssueResult> {
  const normalized = normalizeMainlandPhone(phone);
  if (!isMainlandPhone(normalized)) {
    throw new Error("INVALID_PHONE");
  }
  if (appConfig.COMMERCE_STORAGE === "prisma") {
    const { assertCanIssuePrismaSmsCode } = await import("@/lib/services/prisma-sms-store");
    await assertCanIssuePrismaSmsCode(normalized, meta);
  } else {
    assertCanIssueCode(normalized, meta);
  }

  const code = String(randomInt(100000, 1000000));
  const nonce = randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + appConfig.SMS_CODE_TTL_SECONDS * 1000);
  const codeHash = hashSmsCode(normalized, code, nonce);

  if (appConfig.SMS_PROVIDER === "aliyun") {
    const status = getAliyunSmsProviderStatus();
    if (!status.configured) {
      throw new Error("ALIYUN_SMS_PROVIDER_NOT_CONFIGURED");
    }

    const aliyunRequest = buildAliyunSmsRequest(normalized, scene, code);
    assertAliyunSmsRequestShape(aliyunRequest);
    await sendAliyunSms(aliyunRequest);
  }

  if (appConfig.COMMERCE_STORAGE === "prisma") {
    const { storePrismaSmsCode } = await import("@/lib/services/prisma-sms-store");
    await storePrismaSmsCode({ phone: normalized, scene, nonce, codeHash, expiresAt, meta });
  } else {
    issuedCodes.set(normalized, [
      ...getPhoneRecords(normalized),
      {
        phone: normalized,
        scene,
        nonce,
        codeHash,
        expiresAt,
        createdAt,
        ip: meta?.ip,
      },
    ]);
  }

  return {
    provider: appConfig.SMS_PROVIDER,
    phone: normalized,
    scene,
    nonce,
    codeHash,
    expiresAt,
    devCode: appConfig.SMS_PROVIDER === "mock" ? code : undefined,
  };
}

export async function verifySmsCode(phone: string, scene: SmsScene, code: string): Promise<SmsVerifyResult> {
  const normalized = normalizeMainlandPhone(phone);
  if (!isMainlandPhone(normalized)) {
    return { ok: false, error: "INVALID_PHONE" };
  }

  if (appConfig.COMMERCE_STORAGE === "prisma") {
    const { verifyPrismaSmsCode } = await import("@/lib/services/prisma-sms-store");
    return verifyPrismaSmsCode(normalized, scene, code);
  }

  const records = pruneExpiredRecords(normalized);
  const record = records.findLast((candidate) => {
    return candidate.scene === scene && !candidate.consumedAt;
  });

  if (!record) {
    return { ok: false, error: "SMS_CODE_NOT_FOUND" };
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: "SMS_CODE_EXPIRED" };
  }
  if (hashSmsCode(normalized, code, record.nonce) !== record.codeHash) {
    return { ok: false, error: "SMS_CODE_MISMATCH" };
  }

  record.consumedAt = new Date();
  return { ok: true, phone: normalized, scene };
}

import { Prisma } from "@prisma/client";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { createSmsCooldownError, hashSmsCode, type SmsScene, type SmsVerifyResult } from "@/lib/providers/sms";

type SmsMeta = {
  ip?: string;
  userAgent?: string;
};

type SmsCodeInput = {
  phone: string;
  scene: SmsScene;
  nonce: string;
  codeHash: string;
  expiresAt: Date;
  meta?: SmsMeta;
};

function toDbScene(scene: SmsScene) {
  if (scene === "register") return "REGISTER";
  if (scene === "checkout") return "CHECKOUT";
  return "LOGIN";
}

async function recordLogin(phone: string, success: boolean, failureReason?: string) {
  await prisma.loginLog.create({
    data: {
      phone,
      success,
      failureReason,
    },
  });
}

export async function assertCanIssuePrismaSmsCode(phone: string, meta?: SmsMeta) {
  const limits = await prisma.$queryRaw<
    Array<{
      daily_count: number | bigint;
      hourly_count: number | bigint;
      ip_hourly_count: number | bigint;
      remaining_seconds: number | bigint | null;
    }>
  >(Prisma.sql`
    SELECT
      (
        SELECT COALESCE(CEIL(EXTRACT(EPOCH FROM (
          MAX(created_at) + (${appConfig.SMS_SEND_COOLDOWN_SECONDS} * INTERVAL '1 second') - CURRENT_TIMESTAMP
        )))::int, 0)
        FROM sms_codes
        WHERE phone = ${phone}
          AND created_at >= CURRENT_TIMESTAMP - (${appConfig.SMS_SEND_COOLDOWN_SECONDS} * INTERVAL '1 second')
      ) AS remaining_seconds,
      (
        SELECT COUNT(*)::int
        FROM sms_codes
        WHERE phone = ${phone}
          AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 hour'
      ) AS hourly_count,
      (
        SELECT COUNT(*)::int
        FROM sms_codes
        WHERE phone = ${phone}
          AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 day'
      ) AS daily_count,
      ${
        meta?.ip
          ? Prisma.sql`
              (
                SELECT COUNT(*)::int
                FROM sms_codes
                WHERE ip = ${meta.ip}
                  AND created_at >= CURRENT_TIMESTAMP - INTERVAL '1 hour'
              )
            `
          : Prisma.sql`0`
      } AS ip_hourly_count
  `);

  const row = limits[0];
  const remainingSeconds = Number(row?.remaining_seconds ?? 0);
  if (remainingSeconds > 0) throw createSmsCooldownError(remainingSeconds);

  const hourlyCount = Number(row?.hourly_count ?? 0);
  const dailyCount = Number(row?.daily_count ?? 0);
  const ipHourlyCount = Number(row?.ip_hourly_count ?? 0);

  if (hourlyCount >= appConfig.SMS_MAX_SENDS_PER_HOUR) throw new Error("SMS_PHONE_HOURLY_LIMIT");
  if (dailyCount >= appConfig.SMS_MAX_SENDS_PER_DAY) throw new Error("SMS_PHONE_DAILY_LIMIT");
  if (ipHourlyCount >= appConfig.SMS_MAX_IP_SENDS_PER_HOUR) throw new Error("SMS_IP_HOURLY_LIMIT");
}

export async function storePrismaSmsCode(input: SmsCodeInput) {
  await prisma.smsCode.create({
    data: {
      phone: input.phone,
      scene: toDbScene(input.scene),
      nonce: input.nonce,
      codeHash: input.codeHash,
      expiresAt: input.expiresAt,
      ip: input.meta?.ip,
      userAgent: input.meta?.userAgent,
    },
  });
}

export async function verifyPrismaSmsCode(
  phone: string,
  scene: SmsScene,
  code: string,
): Promise<SmsVerifyResult> {
  const record = await prisma.smsCode.findFirst({
    where: {
      phone,
      scene: toDbScene(scene),
      consumedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!record) {
    await recordLogin(phone, false, "SMS_CODE_NOT_FOUND");
    return { ok: false, error: "SMS_CODE_NOT_FOUND" };
  }
  if (record.expiresAt.getTime() <= Date.now()) {
    await prisma.smsCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    await recordLogin(phone, false, "SMS_CODE_EXPIRED");
    return { ok: false, error: "SMS_CODE_EXPIRED" };
  }
  if (hashSmsCode(phone, code, record.nonce) !== record.codeHash) {
    await prisma.smsCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
    await recordLogin(phone, false, "SMS_CODE_MISMATCH");
    return { ok: false, error: "SMS_CODE_MISMATCH" };
  }

  await prisma.$transaction([
    prisma.smsCode.update({
      where: { id: record.id },
      data: {
        consumedAt: new Date(),
        attempts: { increment: 1 },
      },
    }),
    prisma.loginLog.create({
      data: {
        phone,
        success: true,
      },
    }),
  ]);

  return { ok: true, phone, scene };
}

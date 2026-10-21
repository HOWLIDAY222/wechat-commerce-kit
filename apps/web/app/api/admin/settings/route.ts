import { NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { normalizeXProfileUrl } from "@/lib/international-market";
import { listAdminSettings, upsertAdminSettings } from "@/lib/services/admin-ops-service";

const singleLine = (max: number) => z.string().trim().max(max).refine((value) => !/[\r\n]/.test(value), "MULTILINE_SETTING_FORBIDDEN");
const editableSettingsSchema = z.object({
  siteName: singleLine(80).min(2),
  supportPhone: singleLine(40),
  supportEmail: z.string().trim().email().max(160).refine((value) => !/[\r\n]/.test(value), "MULTILINE_SETTING_FORBIDDEN"),
  xProfileUrl: singleLine(240).refine((value) => !value || Boolean(normalizeXProfileUrl(value)), "INVALID_X_PROFILE_URL"),
  shippingFeeCents: z.number().int().min(0).max(99900),
  shippingRemoteFeeCents: z.number().int().min(0).max(99900),
  shippingFarRemoteFeeCents: z.number().int().min(0).max(99900),
});
const batchSchema = z.object({ settings: editableSettingsSchema });
const legacySingleSchema = z.object({ key: z.string().trim().min(1), value: z.unknown() });

const blockedSettingKeys = new Set([
  "commerceMode",
  "DATABASE_URL",
  "SESSION_SECRET",
  "WECHAT_MINIPROGRAM_APP_ID",
  "WECHAT_MINIPROGRAM_APP_SECRET",
  "WECHAT_API_BASE_URL",
  "WECHAT_PAY_MCH_ID",
  "WECHAT_PAY_MERCHANT_SERIAL_NO",
  "WECHAT_PAY_PRIVATE_KEY",
  "WECHAT_PAY_PRIVATE_KEY_PATH",
  "WECHAT_PAY_API_V3_KEY",
  "WECHAT_PAY_PLATFORM_KEY_ID",
  "WECHAT_PAY_PLATFORM_PUBLIC_KEY",
  "WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH",
  "WECHAT_PAY_NOTIFY_URL",
  "WECHAT_PAY_API_BASE_URL",
  "COMMERCE_STORAGE",
  "PAYMENT_PROVIDER",
  "SMS_PROVIDER",
  "EMAIL_PROVIDER",
  "ALIPAY_APP_ID",
  "ALIPAY_SELLER_ID",
  "ALIPAY_MERCHANT_ID",
  "ALIPAY_GATEWAY",
  "ALIPAY_NOTIFY_URL",
  "ALIPAY_RETURN_URL",
  "ALIPAY_PRIVATE_KEY",
  "ALIPAY_PRIVATE_KEY_PATH",
  "ALIPAY_PUBLIC_KEY",
  "ALIPAY_PUBLIC_KEY_PATH",
  "ALIYUN_ACCESS_KEY_ID",
  "ALIYUN_ACCESS_KEY_SECRET",
  "ALIYUN_SMS_ACCESS_KEY_ID",
  "ALIYUN_SMS_ACCESS_KEY_SECRET",
  "ALIYUN_SMS_SIGN_NAME",
  "ALIYUN_SMS_TEMPLATE_CODE",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM",
  "paymentProvider",
  "smsProvider",
]);
const sensitiveSystemSettingPattern = /(?:database|session|secret|private|public[_-]?key|access[_-]?key|token|provider|payment|sms|smtp|alipay|aliyun)/i;

export async function GET() {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  return NextResponse.json({ ok: true, settings: await listAdminSettings() });
}

export async function PUT(request: Request) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  const payload = await request.json().catch(() => ({}));
  const batch = batchSchema.safeParse(payload);
  if (batch.success) {
    const normalizedSettings = { ...batch.data.settings, xProfileUrl: normalizeXProfileUrl(batch.data.settings.xProfileUrl) };
    const settings = await upsertAdminSettings(
      Object.entries(normalizedSettings).map(([key, value]) => ({ key, value })),
      session.userId,
    );
    return NextResponse.json({ ok: true, settings });
  }

  const single = legacySingleSchema.safeParse(payload);
  if (!single.success) return NextResponse.json({ ok: false, error: "INVALID_SETTING_REQUEST" }, { status: 400 });
  if (single.data.key === "commerceMode") {
    return NextResponse.json({ ok: false, error: "COMMERCE_MODE_REQUIRES_OWNER_RELEASE_ENDPOINT" }, { status: 403 });
  }
  if (blockedSettingKeys.has(single.data.key) || sensitiveSystemSettingPattern.test(single.data.key)) {
    return NextResponse.json({ ok: false, error: "SENSITIVE_SYSTEM_SETTING_READONLY" }, { status: 403 });
  }
  const parsedValue = editableSettingsSchema.shape[single.data.key as keyof z.infer<typeof editableSettingsSchema>]?.safeParse(single.data.value);
  if (!parsedValue?.success) return NextResponse.json({ ok: false, error: "SETTING_VALUE_INVALID" }, { status: 400 });
  const normalizedValue = single.data.key === "xProfileUrl" ? normalizeXProfileUrl(String(parsedValue.data)) : parsedValue.data;
  const [setting] = await upsertAdminSettings([{ key: single.data.key, value: normalizedValue }], session.userId);
  return NextResponse.json({ ok: true, setting });
}

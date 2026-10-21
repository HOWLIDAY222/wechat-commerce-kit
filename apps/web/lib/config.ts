import { z } from "zod";

if (process.env.NODE_ENV === "production" && process.env.COMMUNITY_BUILD_ONLY !== "true") {
  const secret = process.env.SESSION_SECRET || "";
  if (secret.length < 32 || /GENERATE_A_|local-session-secret|development-only/.test(secret)) {
    throw new Error("Configure a unique SESSION_SECRET of at least 32 characters before serving production traffic");
  }
  if (process.env.ENABLE_MOCK_ADMIN_LOGIN === "true") throw new Error("Mock administrator login is forbidden in production");
}

const envSchema = z.object({
  APP_BASE_URL: z.string().url().default("http://127.0.0.1:3000"),
  SESSION_SECRET: z.string().min(16).default("merchantkit-local-session-secret"),
  WECHAT_MINIPROGRAM_APP_ID: z.string().min(1).optional(),
  WECHAT_MINIPROGRAM_APP_SECRET: z.string().min(1).optional(),
  WECHAT_API_BASE_URL: z.string().url().default("https://api.weixin.qq.com"),
  WECHAT_PAY_MCH_ID: z.string().min(1).optional(),
  WECHAT_PAY_MERCHANT_SERIAL_NO: z.string().min(1).optional(),
  WECHAT_PAY_PRIVATE_KEY: z.string().min(1).optional(),
  WECHAT_PAY_PRIVATE_KEY_PATH: z.string().min(1).optional(),
  WECHAT_PAY_API_V3_KEY: z.string().min(1).optional(),
  WECHAT_PAY_API_V2_KEY: z.string().refine((value) => Buffer.byteLength(value, "utf8") === 32, "APIv2 key must contain exactly 32 bytes").optional(),
  WECHAT_PAY_PLATFORM_KEY_ID: z.string().min(1).optional(),
  WECHAT_PAY_PLATFORM_PUBLIC_KEY: z.string().min(1).optional(),
  WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH: z.string().min(1).optional(),
  WECHAT_PAY_NOTIFY_URL: z.string().url().optional(),
  WECHAT_PAY_API_BASE_URL: z.string().url().default("https://api.mch.weixin.qq.com"),
  SMS_PROVIDER: z.enum(["mock", "aliyun"]).default("mock"),
  SMS_CODE_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  SMS_SEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),
  SMS_MAX_SENDS_PER_HOUR: z.coerce.number().int().positive().default(5),
  SMS_MAX_SENDS_PER_DAY: z.coerce.number().int().positive().default(10),
  SMS_MAX_IP_SENDS_PER_HOUR: z.coerce.number().int().positive().default(20),
  PAYMENT_PROVIDER: z.enum(["mock", "alipay"]).default("mock"),
  EMAIL_PROVIDER: z.enum(["disabled", "smtp"]).default("disabled"),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z
    .string()
    .optional()
    .transform((value) => value !== "false"),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_FROM: z.string().email().optional(),
  MOCK_PAYMENT_APP_ID: z.string().min(1).default("mock-merchantkit-app"),
  MOCK_PAYMENT_SELLER_ID: z.string().min(1).default("mock-merchantkit-seller"),
  MOCK_PAYMENT_MERCHANT_ID: z.string().min(1).default("mock-merchantkit-merchant"),
  COMMERCE_STORAGE: z.enum(["runtime", "prisma"]).default("runtime"),
  UPLOAD_DIR: z.string().min(1).optional(),
  MEMBER_PRIVATE_STORAGE_DIR: z.string().min(1).optional(),
  UPLOAD_PUBLIC_PATH: z.string().min(1).default("/uploads"),
  ADMIN_PHONE_ALLOWLIST: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return [];
      return value
        .split(",")
        .map((item) => item.replace(/\D/g, "").replace(/^86/, ""))
        .filter(Boolean);
    }),
  ENABLE_MOCK_ADMIN_LOGIN: z
    .string()
    .optional()
    .transform((value) => value === "true"),
});

export const appConfig = envSchema.parse({
  APP_BASE_URL: process.env.APP_BASE_URL,
  SESSION_SECRET: process.env.SESSION_SECRET,
  WECHAT_MINIPROGRAM_APP_ID: process.env.WECHAT_MINIPROGRAM_APP_ID,
  WECHAT_MINIPROGRAM_APP_SECRET: process.env.WECHAT_MINIPROGRAM_APP_SECRET,
  WECHAT_API_BASE_URL: process.env.WECHAT_API_BASE_URL,
  WECHAT_PAY_MCH_ID: process.env.WECHAT_PAY_MCH_ID,
  WECHAT_PAY_MERCHANT_SERIAL_NO: process.env.WECHAT_PAY_MERCHANT_SERIAL_NO,
  WECHAT_PAY_PRIVATE_KEY: process.env.WECHAT_PAY_PRIVATE_KEY,
  WECHAT_PAY_PRIVATE_KEY_PATH: process.env.WECHAT_PAY_PRIVATE_KEY_PATH,
  WECHAT_PAY_API_V3_KEY: process.env.WECHAT_PAY_API_V3_KEY,
  WECHAT_PAY_API_V2_KEY: process.env.WECHAT_PAY_API_V2_KEY,
  WECHAT_PAY_PLATFORM_KEY_ID: process.env.WECHAT_PAY_PLATFORM_KEY_ID,
  WECHAT_PAY_PLATFORM_PUBLIC_KEY: process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY,
  WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH: process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH,
  WECHAT_PAY_NOTIFY_URL: process.env.WECHAT_PAY_NOTIFY_URL,
  WECHAT_PAY_API_BASE_URL: process.env.WECHAT_PAY_API_BASE_URL,
  SMS_PROVIDER: process.env.SMS_PROVIDER,
  SMS_CODE_TTL_SECONDS: process.env.SMS_CODE_TTL_SECONDS,
  SMS_SEND_COOLDOWN_SECONDS: process.env.SMS_SEND_COOLDOWN_SECONDS,
  SMS_MAX_SENDS_PER_HOUR: process.env.SMS_MAX_SENDS_PER_HOUR,
  SMS_MAX_SENDS_PER_DAY: process.env.SMS_MAX_SENDS_PER_DAY,
  SMS_MAX_IP_SENDS_PER_HOUR: process.env.SMS_MAX_IP_SENDS_PER_HOUR,
  PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_SECURE: process.env.SMTP_SECURE,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASSWORD: process.env.SMTP_PASSWORD,
  SMTP_FROM: process.env.SMTP_FROM,
  MOCK_PAYMENT_APP_ID: process.env.MOCK_PAYMENT_APP_ID,
  MOCK_PAYMENT_SELLER_ID: process.env.MOCK_PAYMENT_SELLER_ID,
  MOCK_PAYMENT_MERCHANT_ID: process.env.MOCK_PAYMENT_MERCHANT_ID,
  COMMERCE_STORAGE: process.env.COMMERCE_STORAGE,
  UPLOAD_DIR: process.env.UPLOAD_DIR,
  MEMBER_PRIVATE_STORAGE_DIR: process.env.MEMBER_PRIVATE_STORAGE_DIR,
  UPLOAD_PUBLIC_PATH: process.env.UPLOAD_PUBLIC_PATH,
  ADMIN_PHONE_ALLOWLIST: process.env.ADMIN_PHONE_ALLOWLIST,
  ENABLE_MOCK_ADMIN_LOGIN: process.env.ENABLE_MOCK_ADMIN_LOGIN,
});

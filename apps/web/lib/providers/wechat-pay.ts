import {
  createDecipheriv,
  randomBytes,
  sign as signSignature,
  verify as verifySignature,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { appConfig } from "@/lib/config";

const prepayResponseSchema = z.object({ prepay_id: z.string().min(1) });
const queryResponseSchema = z.object({
  appid: z.string().min(1),
  mchid: z.string().min(1),
  out_trade_no: z.string().min(1),
  transaction_id: z.string().min(1).optional(),
  trade_state: z.string().min(1),
  trade_state_desc: z.string().optional(),
  success_time: z.string().optional(),
  payer: z.object({ openid: z.string().min(1) }).optional(),
  amount: z.object({
    total: z.number().int().positive(),
    payer_total: z.number().int().positive().optional(),
    currency: z.string().min(1),
    payer_currency: z.string().optional(),
  }),
});
const notificationSchema = z.object({
  id: z.string().min(1),
  create_time: z.string().min(1),
  event_type: z.string().min(1),
  resource_type: z.string().min(1),
  summary: z.string().optional(),
  resource: z.object({
    algorithm: z.literal("AEAD_AES_256_GCM"),
    associated_data: z.string().optional().default(""),
    ciphertext: z.string().min(1),
    nonce: z.string().min(1),
    original_type: z.string().min(1),
  }),
});
const refundResponseSchema = z.object({
  refund_id: z.string().min(1),
  out_refund_no: z.string().min(1),
  out_trade_no: z.string().min(1).optional(),
  transaction_id: z.string().min(1).optional(),
  status: z.string().min(1),
  success_time: z.string().optional(),
  create_time: z.string().optional(),
  amount: z.object({
    total: z.number().int().positive(),
    refund: z.number().int().positive(),
    currency: z.string().min(1).default("CNY"),
  }),
});
const refundNotificationResourceSchema = z.object({
  mchid: z.string().min(1),
  out_trade_no: z.string().min(1),
  transaction_id: z.string().min(1),
  out_refund_no: z.string().min(1),
  refund_id: z.string().min(1),
  refund_status: z.string().min(1),
  success_time: z.string().optional(),
  amount: z.object({
    total: z.number().int().positive(),
    refund: z.number().int().positive(),
    payer_total: z.number().int().positive().optional(),
    payer_refund: z.number().int().positive().optional(),
  }),
});

export type WeChatPayTransaction = z.infer<typeof queryResponseSchema>;
export type WeChatPayRefundResult = z.infer<typeof refundResponseSchema>;
export type WeChatPayRefundNotification = z.infer<typeof refundNotificationResourceSchema>;

type JsapiOrderInput = {
  amountCents: number;
  currency: "CNY";
  description: string;
  expiresAt: Date;
  merchantOrderNo: string;
  openId: string;
};

type RefundInput = {
  amountCents: number;
  merchantOrderNo: string;
  reason: string;
  refundNo: string;
  totalAmountCents: number;
};

export function getWeChatPayProviderStatus() {
  const required = {
    WECHAT_MINIPROGRAM_APP_ID: appConfig.WECHAT_MINIPROGRAM_APP_ID,
    WECHAT_PAY_API_V3_KEY: appConfig.WECHAT_PAY_API_V3_KEY,
    WECHAT_PAY_MCH_ID: appConfig.WECHAT_PAY_MCH_ID,
    WECHAT_PAY_MERCHANT_SERIAL_NO: appConfig.WECHAT_PAY_MERCHANT_SERIAL_NO,
    WECHAT_PAY_PLATFORM_KEY_ID: appConfig.WECHAT_PAY_PLATFORM_KEY_ID,
  };
  const missingKeys = Object.entries(required).filter(([, value]) => !value).map(([key]) => key);
  if (!appConfig.WECHAT_PAY_PRIVATE_KEY && !appConfig.WECHAT_PAY_PRIVATE_KEY_PATH) {
    missingKeys.push("WECHAT_PAY_PRIVATE_KEY_OR_PATH");
  }
  if (!appConfig.WECHAT_PAY_PLATFORM_PUBLIC_KEY && !appConfig.WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH) {
    missingKeys.push("WECHAT_PAY_PLATFORM_PUBLIC_KEY_OR_PATH");
  }
  if (appConfig.WECHAT_PAY_API_V3_KEY && Buffer.byteLength(appConfig.WECHAT_PAY_API_V3_KEY) !== 32) {
    missingKeys.push("WECHAT_PAY_API_V3_KEY_LENGTH");
  }
  return { configured: missingKeys.length === 0, missingKeys };
}

export async function createWeChatPayJsapiOrder(input: JsapiOrderInput) {
  assertProviderConfigured();
  const response = await requestWeChatPayApi("POST", "/v3/pay/transactions/jsapi", {
    appid: appConfig.WECHAT_MINIPROGRAM_APP_ID,
    mchid: appConfig.WECHAT_PAY_MCH_ID,
    description: input.description.slice(0, 127),
    out_trade_no: input.merchantOrderNo,
    time_expire: toRfc3339(input.expiresAt),
    notify_url: getPaymentNotifyUrl(),
    amount: { total: input.amountCents, currency: input.currency },
    payer: { openid: input.openId },
  });
  const parsed = prepayResponseSchema.safeParse(response);
  if (!parsed.success) throw new Error("WECHAT_PAY_PREPAY_RESPONSE_INVALID");
  return {
    prepayId: parsed.data.prepay_id,
    paymentParams: await createWeChatPayClientParams(parsed.data.prepay_id),
  };
}

export async function createWeChatPayClientParams(prepayId: string) {
  assertProviderConfigured();
  const appId = appConfig.WECHAT_MINIPROGRAM_APP_ID!;
  const timeStamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = randomBytes(16).toString("hex");
  const packageValue = `prepay_id=${prepayId}`;
  const message = `${appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`;
  return {
    timeStamp,
    nonceStr,
    package: packageValue,
    signType: "RSA" as const,
    paySign: await signWithMerchantKey(message),
  };
}

export async function queryWeChatPayOrder(merchantOrderNo: string) {
  assertProviderConfigured();
  const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(merchantOrderNo)}?mchid=${encodeURIComponent(appConfig.WECHAT_PAY_MCH_ID!)}`;
  const response = await requestWeChatPayApi("GET", path);
  const parsed = queryResponseSchema.safeParse(response);
  if (!parsed.success) throw new Error("WECHAT_PAY_QUERY_RESPONSE_INVALID");
  assertTransactionIdentity(parsed.data);
  return parsed.data;
}

export async function closeWeChatPayOrder(merchantOrderNo: string) {
  assertProviderConfigured();
  await requestWeChatPayApi(
    "POST",
    `/v3/pay/transactions/out-trade-no/${encodeURIComponent(merchantOrderNo)}/close`,
    { mchid: appConfig.WECHAT_PAY_MCH_ID },
  );
}

export async function requestWeChatPayRefund(input: RefundInput) {
  assertProviderConfigured();
  const response = await requestWeChatPayApi("POST", "/v3/refund/domestic/refunds", {
    out_trade_no: input.merchantOrderNo,
    out_refund_no: input.refundNo,
    reason: input.reason.slice(0, 80),
    notify_url: getRefundNotifyUrl(),
    amount: {
      refund: input.amountCents,
      total: input.totalAmountCents,
      currency: "CNY",
    },
  });
  const parsed = refundResponseSchema.safeParse(response);
  if (!parsed.success) throw new Error("WECHAT_PAY_REFUND_RESPONSE_INVALID");
  assertRefundIdentity(parsed.data, input);
  return parsed.data;
}

export async function queryWeChatPayRefund(refundNo: string) {
  assertProviderConfigured();
  const response = await requestWeChatPayApi("GET", `/v3/refund/domestic/refunds/${encodeURIComponent(refundNo)}`);
  const parsed = refundResponseSchema.safeParse(response);
  if (!parsed.success) throw new Error("WECHAT_PAY_REFUND_QUERY_RESPONSE_INVALID");
  if (parsed.data.out_refund_no !== refundNo) throw new Error("WECHAT_PAY_REFUND_NO_MISMATCH");
  return parsed.data;
}

export async function parseWeChatPayNotification(rawBody: string, headers: Headers) {
  assertProviderConfigured();
  await assertPlatformSignature(rawBody, headers);
  const parsed = notificationSchema.safeParse(JSON.parse(rawBody));
  if (!parsed.success) throw new Error("WECHAT_PAY_NOTIFICATION_INVALID");
  const decrypted = decryptWeChatPayResource(parsed.data.resource, appConfig.WECHAT_PAY_API_V3_KEY!);
  const transaction = queryResponseSchema.safeParse(JSON.parse(decrypted));
  if (!transaction.success) throw new Error("WECHAT_PAY_TRANSACTION_INVALID");
  assertTransactionIdentity(transaction.data);
  return {
    event: parsed.data,
    transaction: transaction.data,
  };
}

export async function parseWeChatPayRefundNotification(rawBody: string, headers: Headers) {
  assertProviderConfigured();
  await assertPlatformSignature(rawBody, headers);
  const parsed = notificationSchema.safeParse(JSON.parse(rawBody));
  if (!parsed.success) throw new Error("WECHAT_PAY_REFUND_NOTIFICATION_INVALID");
  const decrypted = decryptWeChatPayResource(parsed.data.resource, appConfig.WECHAT_PAY_API_V3_KEY!);
  const refund = refundNotificationResourceSchema.safeParse(JSON.parse(decrypted));
  if (!refund.success) throw new Error("WECHAT_PAY_REFUND_RESOURCE_INVALID");
  if (refund.data.mchid !== appConfig.WECHAT_PAY_MCH_ID) throw new Error("WECHAT_PAY_MCH_ID_MISMATCH");
  return { event: parsed.data, refund: refund.data };
}

export function decryptWeChatPayResource(
  resource: { associated_data?: string; ciphertext: string; nonce: string },
  apiV3Key: string,
) {
  if (Buffer.byteLength(apiV3Key) !== 32) throw new Error("WECHAT_PAY_API_V3_KEY_INVALID");
  const encrypted = Buffer.from(resource.ciphertext, "base64");
  if (encrypted.length <= 16) throw new Error("WECHAT_PAY_CIPHERTEXT_INVALID");
  const data = encrypted.subarray(0, -16);
  const authenticationTag = encrypted.subarray(-16);
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(apiV3Key), Buffer.from(resource.nonce));
  decipher.setAAD(Buffer.from(resource.associated_data ?? ""));
  decipher.setAuthTag(authenticationTag);
  try {
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("WECHAT_PAY_RESOURCE_DECRYPT_FAILED");
  }
}

export function verifyWeChatPayRsaSignature(message: string, signature: string, publicKey: string) {
  try {
    return verifySignature("RSA-SHA256", Buffer.from(message), normalizePem(publicKey), Buffer.from(signature, "base64"));
  } catch {
    return false;
  }
}

async function requestWeChatPayApi(method: "GET" | "POST", path: string, body?: unknown) {
  const bodyText = typeof body === "undefined" ? "" : JSON.stringify(body);
  const url = new URL(path, appConfig.WECHAT_PAY_API_BASE_URL);
  const requestPath = `${url.pathname}${url.search}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString("hex");
  const signature = await signWithMerchantKey(`${method}\n${requestPath}\n${timestamp}\n${nonce}\n${bodyText}\n`);
  const authorization = [
    `mchid="${appConfig.WECHAT_PAY_MCH_ID}"`,
    `nonce_str="${nonce}"`,
    `timestamp="${timestamp}"`,
    `serial_no="${appConfig.WECHAT_PAY_MERCHANT_SERIAL_NO}"`,
    `signature="${signature}"`,
  ].join(",");

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Wechatpay-Serial": appConfig.WECHAT_PAY_PLATFORM_KEY_ID!,
        Authorization: `WECHATPAY2-SHA256-RSA2048 ${authorization}`,
        ...(bodyText ? { "Content-Type": "application/json" } : {}),
      },
      ...(bodyText ? { body: bodyText } : {}),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("WECHAT_PAY_API_UNAVAILABLE");
  }

  const raw = await response.text();
  await assertPlatformSignature(raw, response.headers);
  const payload = JSON.parse(raw || "{}") as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof payload.code === "string" && /^[A-Z0-9_]+$/.test(payload.code)
      ? payload.code
      : "REQUEST_FAILED";
    throw new Error(`WECHAT_PAY_API_${code}`);
  }
  return payload;
}

async function assertPlatformSignature(rawBody: string, headers: Headers) {
  const timestamp = headers.get("wechatpay-timestamp") ?? "";
  const nonce = headers.get("wechatpay-nonce") ?? "";
  const signature = headers.get("wechatpay-signature") ?? "";
  const serial = headers.get("wechatpay-serial") ?? "";
  if (!timestamp || !nonce || !signature || !serial) throw new Error("WECHAT_PAY_SIGNATURE_HEADERS_MISSING");
  if (appConfig.WECHAT_PAY_PLATFORM_KEY_ID && serial !== appConfig.WECHAT_PAY_PLATFORM_KEY_ID) {
    throw new Error("WECHAT_PAY_PLATFORM_KEY_ID_MISMATCH");
  }
  const timestampNumber = Number(timestamp);
  if (!Number.isInteger(timestampNumber) || Math.abs(Date.now() / 1000 - timestampNumber) > 300) {
    throw new Error("WECHAT_PAY_SIGNATURE_TIMESTAMP_INVALID");
  }
  const publicKey = await loadPlatformPublicKey();
  const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
  if (!verifyWeChatPayRsaSignature(message, signature, publicKey)) {
    throw new Error("WECHAT_PAY_SIGNATURE_INVALID");
  }
}

async function signWithMerchantKey(message: string) {
  const privateKey = await loadMerchantPrivateKey();
  return signSignature("RSA-SHA256", Buffer.from(message), normalizePem(privateKey)).toString("base64");
}

async function loadMerchantPrivateKey() {
  if (appConfig.WECHAT_PAY_PRIVATE_KEY) return appConfig.WECHAT_PAY_PRIVATE_KEY;
  if (appConfig.WECHAT_PAY_PRIVATE_KEY_PATH) {
    return readFile(appConfig.WECHAT_PAY_PRIVATE_KEY_PATH, "utf8");
  }
  throw new Error("WECHAT_PAY_PRIVATE_KEY_MISSING");
}

async function loadPlatformPublicKey() {
  if (appConfig.WECHAT_PAY_PLATFORM_PUBLIC_KEY) return appConfig.WECHAT_PAY_PLATFORM_PUBLIC_KEY;
  if (appConfig.WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH) {
    return readFile(appConfig.WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH, "utf8");
  }
  throw new Error("WECHAT_PAY_PLATFORM_PUBLIC_KEY_MISSING");
}

function assertProviderConfigured() {
  if (!getWeChatPayProviderStatus().configured) throw new Error("WECHAT_PAY_NOT_CONFIGURED");
}

function assertTransactionIdentity(transaction: WeChatPayTransaction) {
  if (transaction.appid !== appConfig.WECHAT_MINIPROGRAM_APP_ID) throw new Error("WECHAT_PAY_APP_ID_MISMATCH");
  if (transaction.mchid !== appConfig.WECHAT_PAY_MCH_ID) throw new Error("WECHAT_PAY_MCH_ID_MISMATCH");
  if (transaction.amount.currency !== "CNY") throw new Error("WECHAT_PAY_CURRENCY_MISMATCH");
}

function assertRefundIdentity(result: WeChatPayRefundResult, input: RefundInput) {
  if (result.out_refund_no !== input.refundNo) throw new Error("WECHAT_PAY_REFUND_NO_MISMATCH");
  if (result.amount.total !== input.totalAmountCents || result.amount.refund !== input.amountCents) {
    throw new Error("WECHAT_PAY_REFUND_AMOUNT_MISMATCH");
  }
  if (result.amount.currency !== "CNY") throw new Error("WECHAT_PAY_CURRENCY_MISMATCH");
}

function getPaymentNotifyUrl() {
  const url = appConfig.WECHAT_PAY_NOTIFY_URL
    ?? new URL("/api/payments/wechat/notify", appConfig.APP_BASE_URL).toString();
  if (!url.startsWith("https://")) throw new Error("WECHAT_PAY_NOTIFY_URL_HTTPS_REQUIRED");
  return url;
}

function getRefundNotifyUrl() {
  return new URL("/api/payments/wechat/refund-notify", getPaymentNotifyUrl()).toString();
}

function normalizePem(value: string) {
  return value.replace(/\\n/g, "\n").trim();
}

function toRfc3339(value: Date) {
  if (!Number.isFinite(value.getTime()) || value.getTime() <= Date.now() + 60_000) {
    throw new Error("WECHAT_PAY_EXPIRY_INVALID");
  }
  return value.toISOString().replace(/\.\d{3}Z$/, "Z");
}

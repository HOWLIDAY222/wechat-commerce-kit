import { createSign, createVerify } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";

const requiredAlipayNotifyEnvKeys = [
  "ALIPAY_APP_ID",
  "ALIPAY_NOTIFY_URL",
] as const;

const requiredAlipayH5EnvKeys = [
  "ALIPAY_APP_ID",
  "ALIPAY_GATEWAY",
  "ALIPAY_NOTIFY_URL",
  "ALIPAY_RETURN_URL",
] as const;

type AlipayEnv = Record<string, string | undefined>;

export type AlipayProviderStatus = {
  configured: boolean;
  missingKeys: string[];
};

export type AlipayH5PaymentInput = {
  orderNo: string;
  amountCents: number;
  subject: string;
};

export type AlipayH5PaymentRequest = {
  gateway: string;
  method: "alipay.trade.wap.pay";
  params: Record<string, string>;
  signedUrl: string;
  bizContent: {
    out_trade_no: string;
    total_amount: string;
    subject: string;
    product_code: "QUICK_WAP_WAY";
  };
};

export type AlipayNotifyPayload = {
  appId: string;
  sellerId: string;
  orderNo: string;
  tradeNo: string;
  tradeStatus: string;
  totalAmount: string;
  sign?: string;
  raw: Record<string, string>;
};

export type AlipayTradeQueryResult = {
  code: string;
  msg?: string;
  subCode?: string;
  subMsg?: string;
  orderNo: string;
  tradeNo?: string;
  tradeStatus?: string;
  totalAmount?: string;
  signatureValid: boolean;
  raw: Record<string, unknown>;
};

export type AlipayRefundInput = {
  orderNo: string;
  tradeNo?: string | null;
  refundNo: string;
  refundAmountCents: number;
  reason: string;
};

export type AlipayRefundResult = {
  code: string;
  msg?: string;
  subCode?: string;
  subMsg?: string;
  orderNo: string;
  tradeNo?: string;
  refundFee?: string;
  fundChange?: string;
  signatureValid: boolean;
  raw: Record<string, unknown>;
};

export function getAlipayProviderStatus(env: AlipayEnv = process.env): AlipayProviderStatus {
  const missingKeys = unique([
    ...getAlipayNotifyProviderStatus(env).missingKeys,
    ...getAlipayH5ProviderStatus(env).missingKeys,
  ]);

  return {
    configured: missingKeys.length === 0,
    missingKeys,
  };
}

export function getAlipayNotifyProviderStatus(env: AlipayEnv = process.env): AlipayProviderStatus {
  const missingKeys = [
    ...requiredAlipayNotifyEnvKeys.filter((key) => !env[key]?.trim()),
    ...missingSellerKeys(env),
    ...missingSecretValueOrPath(env, "ALIPAY_PUBLIC_KEY", "ALIPAY_PUBLIC_KEY_PATH"),
  ];

  return {
    configured: missingKeys.length === 0,
    missingKeys,
  };
}

export function getAlipayH5ProviderStatus(env: AlipayEnv = process.env): AlipayProviderStatus {
  const missingKeys = [
    ...requiredAlipayH5EnvKeys.filter((key) => !env[key]?.trim()),
    ...missingSellerKeys(env),
    ...missingSecretValueOrPath(env, "ALIPAY_PRIVATE_KEY", "ALIPAY_PRIVATE_KEY_PATH"),
  ];

  return {
    configured: missingKeys.length === 0,
    missingKeys,
  };
}

export function buildAlipayH5PaymentRequest(input: AlipayH5PaymentInput, env: AlipayEnv = process.env): AlipayH5PaymentRequest {
  const status = getAlipayH5ProviderStatus(env);
  if (!status.configured) {
    throw new Error("ALIPAY_H5_PROVIDER_NOT_CONFIGURED");
  }
  if (!input.orderNo) throw new Error("ALIPAY_H5_ORDER_MISSING");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new Error("ALIPAY_H5_AMOUNT_INVALID");
  if (!input.subject.trim()) throw new Error("ALIPAY_H5_SUBJECT_MISSING");

  const bizContent = {
    out_trade_no: input.orderNo,
    total_amount: formatYuanAmount(input.amountCents),
    subject: input.subject,
    product_code: "QUICK_WAP_WAY" as const,
  };
  const params = {
    app_id: env.ALIPAY_APP_ID?.trim() ?? "",
    method: "alipay.trade.wap.pay",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: formatAlipayTimestamp(new Date()),
    version: "1.0",
    notify_url: env.ALIPAY_NOTIFY_URL?.trim() ?? "",
    return_url: env.ALIPAY_RETURN_URL?.trim() ?? "",
    biz_content: JSON.stringify(bizContent),
  };

  const signContent = buildAlipaySignContent(params, { excludeSignType: false });
  const sign = signAlipayContent(signContent, readSecretValueOrPath(env, "ALIPAY_PRIVATE_KEY", "ALIPAY_PRIVATE_KEY_PATH"));
  const signedParams = { ...params, sign };

  return {
    gateway: env.ALIPAY_GATEWAY?.trim() ?? "",
    method: "alipay.trade.wap.pay",
    params: signedParams,
    signedUrl: `${env.ALIPAY_GATEWAY?.trim() ?? ""}?${new URLSearchParams(signedParams).toString()}`,
    bizContent,
  };
}

export function assertAlipayH5PaymentRequestShape(request: AlipayH5PaymentRequest, env: AlipayEnv = process.env) {
  if (!request.gateway.startsWith("https://")) throw new Error("ALIPAY_H5_GATEWAY_INVALID");
  if (request.params.app_id !== env.ALIPAY_APP_ID) throw new Error("ALIPAY_H5_APP_ID_MISMATCH");
  if (request.params.notify_url !== env.ALIPAY_NOTIFY_URL) throw new Error("ALIPAY_H5_NOTIFY_URL_MISMATCH");
  if (request.params.return_url !== env.ALIPAY_RETURN_URL) throw new Error("ALIPAY_H5_RETURN_URL_MISMATCH");
  if (!request.params.sign) throw new Error("ALIPAY_H5_SIGNATURE_MISSING");
  if (request.bizContent.product_code !== "QUICK_WAP_WAY") throw new Error("ALIPAY_H5_PRODUCT_CODE_INVALID");
  if (!/^\d+\.\d{2}$/.test(request.bizContent.total_amount)) throw new Error("ALIPAY_H5_AMOUNT_INVALID");
}

export function parseAlipayNotifyPayload(form: FormData): AlipayNotifyPayload {
  const raw = Object.fromEntries(
    Array.from(form.entries()).map(([key, value]) => {
      return [key, typeof value === "string" ? value : value.name];
    }),
  );

  return {
    appId: raw.app_id ?? "",
    sellerId: raw.seller_id ?? "",
    orderNo: raw.out_trade_no ?? "",
    tradeNo: raw.trade_no ?? "",
    tradeStatus: raw.trade_status ?? "",
    totalAmount: raw.total_amount ?? "",
    sign: raw.sign,
    raw,
  };
}

export function assertAlipayNotifyShape(payload: AlipayNotifyPayload, env: AlipayEnv = process.env) {
  if (!payload.sign) throw new Error("ALIPAY_NOTIFY_SIGNATURE_MISSING");
  if (!["TRADE_SUCCESS", "TRADE_FINISHED"].includes(payload.tradeStatus)) throw new Error("ALIPAY_TRADE_STATUS_UNSUPPORTED");
  if (!payload.orderNo || !payload.tradeNo) throw new Error("ALIPAY_NOTIFY_ORDER_MISSING");
  if (!/^\d+(\.\d{1,2})?$/.test(payload.totalAmount)) throw new Error("ALIPAY_NOTIFY_AMOUNT_INVALID");
  if (payload.appId !== env.ALIPAY_APP_ID) throw new Error("ALIPAY_APP_ID_MISMATCH");
}

export function isAlipayNotifySellerMatched(payload: AlipayNotifyPayload, env: AlipayEnv = process.env) {
  const expectedSellerId = getAlipaySellerId(env);
  if (!expectedSellerId || !payload.sellerId) return true;
  return payload.sellerId === expectedSellerId;
}

export async function queryAlipayTrade(orderNo: string, env: AlipayEnv = process.env): Promise<AlipayTradeQueryResult> {
  const status = getAlipayH5ProviderStatus(env);
  if (!status.configured) {
    throw new Error("ALIPAY_QUERY_PROVIDER_NOT_CONFIGURED");
  }
  if (!orderNo) throw new Error("ALIPAY_QUERY_ORDER_MISSING");

  const params = {
    app_id: env.ALIPAY_APP_ID?.trim() ?? "",
    method: "alipay.trade.query",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: formatAlipayTimestamp(new Date()),
    version: "1.0",
    biz_content: JSON.stringify({ out_trade_no: orderNo }),
  };
  const signContent = buildAlipaySignContent(params, { excludeSignType: false });
  const signedParams = {
    ...params,
    sign: signAlipayContent(signContent, readSecretValueOrPath(env, "ALIPAY_PRIVATE_KEY", "ALIPAY_PRIVATE_KEY_PATH")),
  };

  const response = await fetch(`${env.ALIPAY_GATEWAY?.trim() ?? ""}?${new URLSearchParams(signedParams).toString()}`);
  const text = await response.text();
  const body = JSON.parse(text) as {
    alipay_trade_query_response?: {
      code?: string;
      msg?: string;
      sub_code?: string;
      sub_msg?: string;
      out_trade_no?: string;
      trade_no?: string;
      trade_status?: string;
      total_amount?: string;
    };
    sign?: string;
  };
  const payload = body.alipay_trade_query_response;
  if (!payload) throw new Error("ALIPAY_QUERY_RESPONSE_INVALID");

  return {
    code: payload.code ?? "",
    msg: payload.msg,
    subCode: payload.sub_code,
    subMsg: payload.sub_msg,
    orderNo: payload.out_trade_no ?? orderNo,
    tradeNo: payload.trade_no,
    tradeStatus: payload.trade_status,
    totalAmount: payload.total_amount,
    signatureValid: verifyAlipayJsonResponseSignature(text, "alipay_trade_query_response", body.sign, env),
    raw: payload,
  };
}

export async function requestAlipayRefund(input: AlipayRefundInput, env: AlipayEnv = process.env): Promise<AlipayRefundResult> {
  const status = getAlipayProviderStatus(env);
  if (!status.configured) {
    throw new Error("ALIPAY_REFUND_PROVIDER_NOT_CONFIGURED");
  }
  if (!input.orderNo) throw new Error("ALIPAY_REFUND_ORDER_MISSING");
  if (!input.refundNo) throw new Error("ALIPAY_REFUND_REQUEST_NO_MISSING");
  if (!Number.isInteger(input.refundAmountCents) || input.refundAmountCents <= 0) throw new Error("ALIPAY_REFUND_AMOUNT_INVALID");
  if (!input.reason.trim()) throw new Error("ALIPAY_REFUND_REASON_MISSING");

  const bizContent: Record<string, string> = {
    out_trade_no: input.orderNo,
    refund_amount: formatYuanAmount(input.refundAmountCents),
    refund_reason: input.reason,
    out_request_no: input.refundNo,
  };
  if (input.tradeNo) {
    bizContent.trade_no = input.tradeNo;
  }

  const params = {
    app_id: env.ALIPAY_APP_ID?.trim() ?? "",
    method: "alipay.trade.refund",
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: formatAlipayTimestamp(new Date()),
    version: "1.0",
    biz_content: JSON.stringify(bizContent),
  };
  const signContent = buildAlipaySignContent(params, { excludeSignType: false });
  const signedParams = {
    ...params,
    sign: signAlipayContent(signContent, readSecretValueOrPath(env, "ALIPAY_PRIVATE_KEY", "ALIPAY_PRIVATE_KEY_PATH")),
  };

  const response = await fetch(`${env.ALIPAY_GATEWAY?.trim() ?? ""}?${new URLSearchParams(signedParams).toString()}`);
  const text = await response.text();
  const body = JSON.parse(text) as {
    alipay_trade_refund_response?: {
      code?: string;
      msg?: string;
      sub_code?: string;
      sub_msg?: string;
      out_trade_no?: string;
      trade_no?: string;
      refund_fee?: string;
      fund_change?: string;
    };
    sign?: string;
  };
  const payload = body.alipay_trade_refund_response;
  if (!payload) throw new Error("ALIPAY_REFUND_RESPONSE_INVALID");

  return {
    code: payload.code ?? "",
    msg: payload.msg,
    subCode: payload.sub_code,
    subMsg: payload.sub_msg,
    orderNo: payload.out_trade_no ?? input.orderNo,
    tradeNo: payload.trade_no,
    refundFee: payload.refund_fee,
    fundChange: payload.fund_change,
    signatureValid: verifyAlipayJsonResponseSignature(text, "alipay_trade_refund_response", body.sign, env),
    raw: payload,
  };
}

export function verifyAlipayNotifySignature(payload: AlipayNotifyPayload, env: AlipayEnv = process.env) {
  if (!payload.sign) return false;
  const signContent = buildAlipaySignContent(payload.raw, { excludeSignType: true });
  const publicKey = readSecretValueOrPath(env, "ALIPAY_PUBLIC_KEY", "ALIPAY_PUBLIC_KEY_PATH");
  return createVerify("RSA-SHA256").update(signContent, "utf8").verify(publicKey, payload.sign, "base64");
}

export function isAlipayH5SigningEnabled() {
  return true;
}

function formatYuanAmount(amountCents: number) {
  return (amountCents / 100).toFixed(2);
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function getAlipaySellerId(env: AlipayEnv) {
  return env.ALIPAY_SELLER_ID?.trim() || env.ALIPAY_MERCHANT_ID?.trim() || "";
}

function missingSellerKeys(env: AlipayEnv) {
  return getAlipaySellerId(env) ? [] : ["ALIPAY_SELLER_ID"];
}

function missingSecretValueOrPath(env: AlipayEnv, valueKey: string, pathKey: string) {
  if (env[valueKey]?.trim()) return [];
  const path = env[pathKey]?.trim();
  if (path && existsSync(path)) {
    const info = statSync(path);
    if (info.isFile() && info.size > 0) return [];
  }
  return [pathKey];
}

function readSecretValueOrPath(env: AlipayEnv, valueKey: string, pathKey: string) {
  const value = env[valueKey]?.trim();
  if (value) return value;
  const path = env[pathKey]?.trim();
  if (!path) throw new Error(`${pathKey}_MISSING`);
  return readFileSync(path, "utf8");
}

function signAlipayContent(content: string, privateKey: string) {
  return createSign("RSA-SHA256").update(content, "utf8").sign(privateKey, "base64");
}

function verifyAlipayJsonResponseSignature(text: string, responseKey: string, sign: string | undefined, env: AlipayEnv) {
  if (!sign) return false;
  const signContent = extractAlipayJsonResponseNode(text, responseKey);
  if (!signContent) return false;
  const publicKey = readSecretValueOrPath(env, "ALIPAY_PUBLIC_KEY", "ALIPAY_PUBLIC_KEY_PATH");
  return createVerify("RSA-SHA256").update(signContent, "utf8").verify(publicKey, sign, "base64");
}

function extractAlipayJsonResponseNode(text: string, responseKey: string) {
  const responseMarker = `"${responseKey}":`;
  const start = text.indexOf(responseMarker);
  if (start < 0) return "";
  const contentStart = start + responseMarker.length;
  const signMarker = ',"sign"';
  const contentEnd = text.indexOf(signMarker, contentStart);
  if (contentEnd < 0) return "";
  return text.slice(contentStart, contentEnd);
}

function buildAlipaySignContent(params: Record<string, string>, options: { excludeSignType: boolean }) {
  return Object.keys(params)
    .filter((key) => {
      if (key === "sign") return false;
      if (options.excludeSignType && key === "sign_type") return false;
      return params[key] !== undefined && params[key] !== "";
    })
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

function formatAlipayTimestamp(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

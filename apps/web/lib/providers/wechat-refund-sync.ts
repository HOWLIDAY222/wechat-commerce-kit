import { createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { appConfig } from "@/lib/config";
import { queryWeChatPayRefund, type WeChatPayRefundResult } from "@/lib/providers/wechat-pay";

const MAX_XML_BYTES = 64 * 1024;
const MAX_REFUNDS_PER_ORDER = 20;
const refundStatuses = ["SUCCESS", "PROCESSING", "CLOSED", "ABNORMAL"] as const;
type RefundStatus = (typeof refundStatuses)[number];
type XmlFields = Record<string, string>;

// Discovery only: neither legacy decryption nor a legacy status settles a refund.
export type LegacyWeChatRefundCandidate = {
  outRefundNo: string;
  refundId: string;
  merchantOrderNo: string;
  transactionId: string;
  totalAmountCents: number;
  refundAmountCents: number;
  providerStatus: RefundStatus;
  source: "API" | "VENDOR_PLATFORM" | "LEGACY_QUERY";
};

export type LegacyWeChatRefundPage = {
  candidates: LegacyWeChatRefundCandidate[];
  totalRefundCount: number;
  offset: number;
  nextOffset: number | null;
  complete: boolean;
};

export function isLegacyRefundSyncConfigured() {
  return Boolean(appConfig.WECHAT_MINIPROGRAM_APP_ID && appConfig.WECHAT_PAY_MCH_ID
    && appConfig.WECHAT_PAY_API_V2_KEY && Buffer.byteLength(appConfig.WECHAT_PAY_API_V2_KEY, "utf8") === 32);
}

export function parseLegacyWeChatRefundNotification(rawBody: string): LegacyWeChatRefundCandidate {
  assertConfigured();
  const outer = parseFlatXml(rawBody, "xml");
  if (outer.return_code !== "SUCCESS") throw new Error("WECHAT_PAY_LEGACY_NOTIFICATION_INVALID");
  assertMerchant(outer);
  const encoded = outer.req_info;
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("WECHAT_PAY_LEGACY_CIPHERTEXT_INVALID");
  }
  const encrypted = Buffer.from(encoded, "base64");
  if (!encrypted.length || encrypted.length % 16 !== 0 || encrypted.toString("base64") !== encoded) {
    throw new Error("WECHAT_PAY_LEGACY_CIPHERTEXT_INVALID");
  }
  let plaintext: string;
  try {
    const key = createHash("md5").update(appConfig.WECHAT_PAY_API_V2_KEY!, "utf8").digest("hex");
    const decipher = createDecipheriv("aes-256-ecb", Buffer.from(key, "utf8"), null);
    const bytes = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    plaintext = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("WECHAT_PAY_LEGACY_DECRYPT_FAILED");
  }
  const fields = parseFlatXml(plaintext, "root");
  if (fields.refund_request_source !== "API" && fields.refund_request_source !== "VENDOR_PLATFORM") {
    throw new Error("WECHAT_PAY_LEGACY_NOTIFICATION_INVALID");
  }
  return makeCandidate(fields, fields.refund_request_source);
}

export async function listWeChatRefundCandidatesForPayment(input: {
  merchantOrderNo: string;
  transactionId?: string;
  offset?: number;
}): Promise<LegacyWeChatRefundPage> {
  assertConfigured();
  merchantOrderNo(input.merchantOrderNo);
  if (input.transactionId !== undefined) gatewayId(input.transactionId);
  const offset = input.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset >= MAX_REFUNDS_PER_ORDER) {
    throw new Error("WECHAT_PAY_LEGACY_REFUND_OFFSET_INVALID");
  }
  const fields: XmlFields = {
    appid: appConfig.WECHAT_MINIPROGRAM_APP_ID!,
    mch_id: appConfig.WECHAT_PAY_MCH_ID!,
    nonce_str: randomBytes(16).toString("hex"),
    sign_type: "HMAC-SHA256",
    offset: String(offset),
    ...(input.transactionId ? { transaction_id: input.transactionId } : { out_trade_no: input.merchantOrderNo }),
  };
  fields.sign = signLegacyFields(fields, "HMAC-SHA256");
  const url = new URL("/pay/refundquery", appConfig.WECHAT_PAY_API_BASE_URL);
  if (url.protocol !== "https:" || !["api.mch.weixin.qq.com", "api2.mch.weixin.qq.com"].includes(url.hostname) // gitleaks:allow -- official gateway hostnames, not a credential
    || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("WECHAT_PAY_LEGACY_API_ORIGIN_INVALID");
  }
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "Content-Type": "application/xml; charset=utf-8", Accept: "application/xml" },
      body: serializeFlatXml(fields),
    });
  } catch {
    throw new Error("WECHAT_PAY_LEGACY_API_UNAVAILABLE");
  }
  if (!response.ok) throw new Error("WECHAT_PAY_LEGACY_REFUND_QUERY_FAILED");
  const result = parseFlatXml(await readBoundedResponse(response), "xml");
  if (result.return_code !== "SUCCESS") throw new Error("WECHAT_PAY_LEGACY_REFUND_QUERY_FAILED");
  verifyLegacyResponse(result);
  assertMerchant(result);
  if (result.result_code !== "SUCCESS") {
    const code = /^[A-Z0-9_]{1,64}$/.test(result.err_code ?? "") ? result.err_code : "FAILED";
    throw new Error(`WECHAT_PAY_LEGACY_REFUND_QUERY_${code}`);
  }
  if (result.out_trade_no !== input.merchantOrderNo
    || (input.transactionId && result.transaction_id !== input.transactionId)) {
    throw new Error("WECHAT_PAY_LEGACY_ORDER_IDENTITY_MISMATCH");
  }
  merchantOrderNo(result.out_trade_no);
  gatewayId(result.transaction_id);
  const count = integerField(result.refund_count, true);
  const total = integerField(result.total_refund_count, true);
  if (total > MAX_REFUNDS_PER_ORDER) throw new Error("WECHAT_PAY_LEGACY_REFUND_DISCOVERY_LIMIT");
  if (count > 10 || offset + count > total || (offset < total && count === 0) || (offset >= total && total !== 0)) {
    throw new Error("WECHAT_PAY_LEGACY_REFUND_PAGINATION_INVALID");
  }
  const candidates = Array.from({ length: count }, (_, index) => makeCandidate({
    out_trade_no: result.out_trade_no,
    transaction_id: result.transaction_id,
    out_refund_no: result[`out_refund_no_${index}`],
    refund_id: result[`refund_id_${index}`],
    total_fee: result.total_fee,
    refund_fee: result[`refund_fee_${index}`],
    refund_status: result[`refund_status_${index}`],
    fee_type: result.fee_type,
  }, "LEGACY_QUERY"));
  if (new Set(candidates.map(row => row.outRefundNo)).size !== candidates.length
    || new Set(candidates.map(row => row.refundId)).size !== candidates.length) {
    throw new Error("WECHAT_PAY_LEGACY_REFUND_DUPLICATE");
  }
  const complete = offset + count === total;
  return { candidates, totalRefundCount: total, offset, nextOffset: complete ? null : offset + count, complete };
}

export async function queryVerifiedWeChatRefundCandidate(candidate: LegacyWeChatRefundCandidate): Promise<WeChatPayRefundResult> {
  refundNo(candidate.outRefundNo);
  gatewayId(candidate.refundId);
  merchantOrderNo(candidate.merchantOrderNo);
  gatewayId(candidate.transactionId);
  const result = await queryWeChatPayRefund(candidate.outRefundNo);
  if (result.out_refund_no !== candidate.outRefundNo || result.refund_id !== candidate.refundId
    || result.out_trade_no !== candidate.merchantOrderNo || result.transaction_id !== candidate.transactionId) {
    throw new Error("WECHAT_PAY_LEGACY_REFUND_V3_IDENTITY_MISMATCH");
  }
  if (!Number.isSafeInteger(result.amount.total) || !Number.isSafeInteger(result.amount.refund)
    || result.amount.total <= 0 || result.amount.refund <= 0 || result.amount.refund > result.amount.total
    || result.amount.total !== candidate.totalAmountCents || result.amount.refund !== candidate.refundAmountCents
    || result.amount.currency !== "CNY") {
    throw new Error("WECHAT_PAY_LEGACY_REFUND_V3_AMOUNT_MISMATCH");
  }
  if (!refundStatuses.includes(result.status as RefundStatus)) throw new Error("WECHAT_PAY_LEGACY_REFUND_V3_STATUS_INVALID");
  return result;
}

function assertConfigured() {
  if (!isLegacyRefundSyncConfigured()) throw new Error("WECHAT_PAY_LEGACY_REFUND_NOT_CONFIGURED");
}

function assertMerchant(fields: XmlFields) {
  if (fields.mch_id !== appConfig.WECHAT_PAY_MCH_ID || fields.appid !== appConfig.WECHAT_MINIPROGRAM_APP_ID) {
    throw new Error("WECHAT_PAY_LEGACY_MERCHANT_MISMATCH");
  }
}

function makeCandidate(fields: XmlFields, source: LegacyWeChatRefundCandidate["source"]): LegacyWeChatRefundCandidate {
  merchantOrderNo(fields.out_trade_no); gatewayId(fields.transaction_id); refundNo(fields.out_refund_no); gatewayId(fields.refund_id);
  const total = integerField(fields.total_fee); const refund = integerField(fields.refund_fee);
  if (refund > total || (fields.fee_type && fields.fee_type !== "CNY")) throw new Error("WECHAT_PAY_LEGACY_REFUND_AMOUNT_INVALID");
  const normalized = fields.refund_status === "REFUNDCLOSE" ? "CLOSED" : fields.refund_status === "CHANGE" ? "ABNORMAL" : fields.refund_status;
  if (!refundStatuses.includes(normalized as RefundStatus)) throw new Error("WECHAT_PAY_LEGACY_REFUND_STATUS_INVALID");
  return { outRefundNo: fields.out_refund_no, refundId: fields.refund_id, merchantOrderNo: fields.out_trade_no,
    transactionId: fields.transaction_id, totalAmountCents: total, refundAmountCents: refund,
    providerStatus: normalized as RefundStatus, source };
}

function integerField(value: string, allowZero = false) {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) throw new Error("WECHAT_PAY_LEGACY_INTEGER_INVALID");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1)) throw new Error("WECHAT_PAY_LEGACY_INTEGER_INVALID");
  return parsed;
}
function merchantOrderNo(value: string) { if (typeof value !== "string" || !/^[A-Za-z0-9_|*@-]{1,32}$/.test(value)) throw new Error("WECHAT_PAY_LEGACY_ORDER_NO_INVALID"); }
function refundNo(value: string) { if (typeof value !== "string" || !/^[A-Za-z0-9_|*@-]{1,64}$/.test(value)) throw new Error("WECHAT_PAY_LEGACY_REFUND_NO_INVALID"); }
function gatewayId(value: string) { if (typeof value !== "string" || !/^[0-9]{1,64}$/.test(value)) throw new Error("WECHAT_PAY_LEGACY_GATEWAY_ID_INVALID"); }

function signLegacyFields(fields: XmlFields, algorithm: "MD5" | "HMAC-SHA256") {
  const value = Object.keys(fields).filter(key => key !== "sign" && fields[key] !== "").sort().map(key => `${key}=${fields[key]}`).join("&")
    + `&key=${appConfig.WECHAT_PAY_API_V2_KEY!}`;
  return (algorithm === "HMAC-SHA256" ? createHmac("sha256", appConfig.WECHAT_PAY_API_V2_KEY!).update(value) : createHash("md5").update(value)).digest("hex").toUpperCase();
}

function verifyLegacyResponse(fields: XmlFields) {
  const signature = fields.sign;
  // APIv2 responses may omit sign_type; the signed digest length identifies the supported algorithm.
  const algorithm = fields.sign_type || (signature?.length === 64 ? "HMAC-SHA256" : "MD5");
  if ((algorithm !== "HMAC-SHA256" && algorithm !== "MD5") || !signature
    || !(algorithm === "MD5" ? /^[A-Fa-f0-9]{32}$/ : /^[A-Fa-f0-9]{64}$/).test(signature)) {
    throw new Error("WECHAT_PAY_LEGACY_SIGNATURE_INVALID");
  }
  const expected = Buffer.from(signLegacyFields(fields, algorithm), "hex");
  const actual = Buffer.from(signature, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("WECHAT_PAY_LEGACY_SIGNATURE_INVALID");
}

function serializeFlatXml(fields: XmlFields) {
  const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
  return `<xml>${Object.entries(fields).map(([key, value]) => `<${key}>${escape(value)}</${key}>`).join("")}</xml>`;
}

function parseFlatXml(input: string, root: "xml" | "root"): XmlFields {
  if (typeof input !== "string" || Buffer.byteLength(input, "utf8") > MAX_XML_BYTES
    || /<!DOCTYPE|<!ENTITY|\u0000/i.test(input)) throw new Error("WECHAT_PAY_LEGACY_XML_INVALID");
  const text = input.replace(/^\uFEFF/, "").trim().replace(/^<\?xml\s+version=["']1\.0["'](?:\s+encoding=["']UTF-8["'])?\s*\?>\s*/i, "");
  const start = `<${root}>`; const end = `</${root}>`;
  if (!text.startsWith(start) || !text.endsWith(end)) throw new Error("WECHAT_PAY_LEGACY_XML_INVALID");
  const body = text.slice(start.length, -end.length);
  const field = /\s*<([A-Za-z_][A-Za-z0-9_]*)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<&]*))<\/\1>/y;
  const fields: XmlFields = Object.create(null);
  let offset = 0; let count = 0;
  while (body.slice(offset).trim()) {
    field.lastIndex = offset; const match = field.exec(body);
    if (!match || Object.hasOwn(fields, match[1]) || ++count > 1024
      || (match[2] !== undefined && /\]\]>|<!\[CDATA\[/.test(match[2]))) throw new Error("WECHAT_PAY_LEGACY_XML_INVALID");
    // Preserve field bytes for APIv2 signature verification; never trim signed values.
    fields[match[1]] = match[2] ?? match[3]; offset = field.lastIndex;
  }
  return fields;
}

async function readBoundedResponse(response: Response) {
  if (Number(response.headers.get("content-length") ?? "0") > MAX_XML_BYTES) throw new Error("WECHAT_PAY_LEGACY_XML_INVALID");
  if (!response.body) throw new Error("WECHAT_PAY_LEGACY_XML_INVALID");
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_XML_BYTES) { await reader.cancel(); throw new Error("WECHAT_PAY_LEGACY_XML_INVALID"); }
      chunks.push(value);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } finally { reader.releaseLock(); }
}

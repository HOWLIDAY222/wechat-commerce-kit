import { createHmac, randomUUID } from "node:crypto";
import type { SmsScene } from "@/lib/providers/sms";

const requiredAliyunSmsEnvKeys = [
  "ALIYUN_SMS_ACCESS_KEY_ID",
  "ALIYUN_SMS_ACCESS_KEY_SECRET",
  "ALIYUN_SMS_SIGN_NAME",
  "ALIYUN_SMS_TEMPLATE_CODE",
] as const;

type AliyunSmsEnv = Record<string, string | undefined>;

export type AliyunSmsProviderStatus = {
  configured: boolean;
  missingKeys: string[];
};

export type AliyunSmsRequest = {
  accessKeyId: string;
  accessKeySecret: string;
  phone: string;
  scene: SmsScene;
  code: string;
  signName: string;
  templateCode: string;
  templateParam: string;
};

export function getAliyunSmsProviderStatus(env: AliyunSmsEnv = process.env): AliyunSmsProviderStatus {
  const missingKeys = requiredAliyunSmsEnvKeys.filter((key) => {
    return !env[key]?.trim();
  });

  return {
    configured: missingKeys.length === 0,
    missingKeys,
  };
}

export function buildAliyunSmsRequest(phone: string, scene: SmsScene, code: string, env: AliyunSmsEnv = process.env): AliyunSmsRequest {
  const status = getAliyunSmsProviderStatus(env);
  if (!status.configured) {
    throw new Error("ALIYUN_SMS_PROVIDER_NOT_CONFIGURED");
  }

  const signName = env.ALIYUN_SMS_SIGN_NAME?.trim() ?? "";
  const templateCode = env.ALIYUN_SMS_TEMPLATE_CODE?.trim() ?? "";
  const templateParam = JSON.stringify({
    code,
  });

  return {
    accessKeyId: env.ALIYUN_SMS_ACCESS_KEY_ID?.trim() ?? "",
    accessKeySecret: env.ALIYUN_SMS_ACCESS_KEY_SECRET?.trim() ?? "",
    phone,
    scene,
    code,
    signName,
    templateCode,
    templateParam,
  };
}

export function assertAliyunSmsRequestShape(request: AliyunSmsRequest) {
  if (!/^1[3-9]\d{9}$/.test(request.phone)) throw new Error("ALIYUN_SMS_PHONE_INVALID");
  if (!/^\d{6}$/.test(request.code)) throw new Error("ALIYUN_SMS_CODE_INVALID");
  if (!request.signName) throw new Error("ALIYUN_SMS_SIGN_NAME_MISSING");
  if (!request.templateCode) throw new Error("ALIYUN_SMS_TEMPLATE_CODE_MISSING");
  if (!request.templateParam.includes(request.code)) throw new Error("ALIYUN_SMS_TEMPLATE_PARAM_INVALID");
}

export async function sendAliyunSms(request: AliyunSmsRequest) {
  assertAliyunSmsRequestShape(request);
  const endpoint = "https://dysmsapi.aliyuncs.com/";
  const params: Record<string, string> = {
    AccessKeyId: request.accessKeyId,
    Action: "SendSms",
    Format: "JSON",
    PhoneNumbers: request.phone,
    RegionId: "cn-hangzhou",
    SignName: request.signName,
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: randomUUID(),
    SignatureVersion: "1.0",
    TemplateCode: request.templateCode,
    TemplateParam: request.templateParam,
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
    Version: "2017-05-25",
  };
  const signedParams = { ...params, Signature: signAliyunRpcParams(params, request.accessKeySecret) };
  const response = await fetch(`${endpoint}?${new URLSearchParams(signedParams).toString()}`, {
    method: "GET",
  });
  const body = (await response.json().catch(() => ({}))) as { Code?: string; Message?: string; RequestId?: string };
  if (!response.ok || body.Code !== "OK") {
    const code = body.Code ?? String(response.status);
    console.error("aliyun.sms.send.failed", {
      code,
      message: body.Message,
      requestId: body.RequestId,
      phone: maskPhone(request.phone),
      scene: request.scene,
      templateCode: maskTemplateCode(request.templateCode),
      httpStatus: response.status,
    });
    throw new Error(`ALIYUN_SMS_SEND_FAILED:${code}`);
  }
  return body;
}

function signAliyunRpcParams(params: Record<string, string>, secret: string) {
  const canonicalized = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join("&");
  const stringToSign = `GET&%2F&${percentEncode(canonicalized)}`;
  return createHmac("sha1", `${secret}&`).update(stringToSign).digest("base64");
}

function percentEncode(value: string) {
  return encodeURIComponent(value).replace(/\+/g, "%20").replace(/\*/g, "%2A").replace(/%7E/g, "~");
}

function maskPhone(phone: string) {
  return phone.replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}

function maskTemplateCode(templateCode: string) {
  if (templateCode.length <= 6) return "***";
  return `${templateCode.slice(0, 3)}***${templateCode.slice(-3)}`;
}

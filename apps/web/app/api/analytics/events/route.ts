import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentUserSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import {
  analyticsEventNames,
  analyticsSessionCookieName,
  analyticsVisitorCookieName,
  decodeConsentCookie,
  privacyConsentCookieName,
  recordAnalyticsEvent,
} from "@/lib/services/analytics-service";

const eventSchema = z.object({
  name: z.enum(analyticsEventNames),
  path: z.string().trim().startsWith("/").max(500),
  locale: z.enum(["zh-CN", "en"]).optional(),
  productId: z.string().trim().max(160).optional(),
  durationSeconds: z.number().nonnegative().max(86_400).optional(),
  referrer: z.string().url().max(1000).optional().or(z.literal("")),
  source: z.string().trim().max(80).optional(),
  medium: z.string().trim().max(80).optional(),
  campaign: z.string().trim().max(120).optional(),
  properties: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
  deviceSignal: z.string().max(1000).optional(),
});

export async function POST(request: NextRequest) {
  const consent = decodeConsentCookie(request.cookies.get(privacyConsentCookieName)?.value);
  if (!consent?.analytics) return NextResponse.json({ ok: false, error: "ANALYTICS_CONSENT_REQUIRED" }, { status: 403 });
  const parsed = eventSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_ANALYTICS_EVENT" }, { status: 400 });
  const anonymousId = request.cookies.get(analyticsVisitorCookieName)?.value || randomUUID();
  const sessionKey = request.cookies.get(analyticsSessionCookieName)?.value || randomUUID();
  const userSession = await readCurrentUserSession();
  const referrerHost = getReferrerHost(parsed.data.referrer);
  const userAgent = request.headers.get("user-agent") ?? "";
  const source = classifySource(parsed.data.source, referrerHost);
  await recordAnalyticsEvent({
    anonymousId,
    context: {
      browser: detectBrowser(userAgent),
      campaign: parsed.data.campaign,
      countryCode: request.headers.get("cf-ipcountry") ?? request.headers.get("x-vercel-ip-country") ?? undefined,
      deviceType: /mobile|android|iphone|ipad/i.test(userAgent) ? "mobile" : "desktop",
      language: request.headers.get("accept-language")?.split(",")[0],
      locale: parsed.data.locale,
      medium: parsed.data.medium,
      operatingSystem: detectOperatingSystem(userAgent),
      referrerHost,
      region: request.headers.get("x-vercel-ip-country-region") ?? undefined,
      source,
    },
    deviceSignal: consent.device ? parsed.data.deviceSignal : undefined,
    durationSeconds: parsed.data.durationSeconds,
    eventName: parsed.data.name,
    path: parsed.data.path,
    productId: parsed.data.productId,
    properties: parsed.data.properties,
    sessionKey,
    userId: userSession?.userId,
  });
  const response = NextResponse.json({ ok: true }, { status: 202 });
  response.cookies.set(analyticsVisitorCookieName, anonymousId, cookieOptions(365));
  response.cookies.set(analyticsSessionCookieName, sessionKey, cookieOptions(1 / 48));
  return response;
}

function classifySource(explicit: string | undefined, referrerHost: string | undefined) {
  if (explicit) return explicit.toLowerCase();
  if (!referrerHost) return "direct";
  if (referrerHost.includes("x.com") || referrerHost.includes("twitter.com")) return "x";
  if (referrerHost.includes("xiaohongshu.com") || referrerHost.includes("xhslink.cn")) return "xiaohongshu";
  if (/google|bing|baidu|yahoo|duckduckgo/.test(referrerHost)) return "search";
  return "referral";
}

function getReferrerHost(value: string | undefined) {
  if (!value) return undefined;
  try { return new URL(value).hostname.toLowerCase(); } catch { return undefined; }
}

function cookieOptions(days: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: appConfig.APP_BASE_URL.startsWith("https://"), path: "/", maxAge: Math.round(days * 86_400) };
}

function detectBrowser(value: string) {
  if (/Edg\//i.test(value)) return "Edge";
  if (/Firefox\//i.test(value)) return "Firefox";
  if (/Chrome\//i.test(value)) return "Chrome";
  if (/Safari\//i.test(value)) return "Safari";
  return "Other";
}

function detectOperatingSystem(value: string) {
  if (/Windows/i.test(value)) return "Windows";
  if (/Android/i.test(value)) return "Android";
  if (/iPhone|iPad|iOS/i.test(value)) return "iOS";
  if (/Mac OS/i.test(value)) return "macOS";
  if (/Linux/i.test(value)) return "Linux";
  return "Other";
}

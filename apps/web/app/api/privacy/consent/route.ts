import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentUserSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import {
  analyticsVisitorCookieName,
  decodeConsentCookie,
  encodeConsentCookie,
  privacyConsentCookieName,
  recordPrivacyConsent,
} from "@/lib/services/analytics-service";

const consentSchema = z.object({
  analytics: z.boolean(),
  personalization: z.boolean(),
  device: z.boolean(),
  marketing: z.boolean(),
  locale: z.enum(["zh-CN", "en"]).optional(),
});

export async function GET(request: NextRequest) {
  return NextResponse.json({ ok: true, preferences: decodeConsentCookie(request.cookies.get(privacyConsentCookieName)?.value) });
}

export async function POST(request: NextRequest) {
  const parsed = consentSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_PRIVACY_PREFERENCES" }, { status: 400 });
  const anonymousId = request.cookies.get(analyticsVisitorCookieName)?.value || randomUUID();
  const session = await readCurrentUserSession();
  const preferences = {
    analytics: parsed.data.analytics,
    personalization: parsed.data.personalization,
    device: parsed.data.device,
    marketing: parsed.data.marketing,
  };
  await recordPrivacyConsent({
    anonymousId,
    context: requestContext(request, parsed.data.locale),
    locale: parsed.data.locale,
    preferences,
    userId: session?.userId,
  });
  const response = NextResponse.json({ ok: true, preferences });
  response.cookies.set(privacyConsentCookieName, encodeConsentCookie(preferences), cookieOptions(365));
  response.cookies.set(analyticsVisitorCookieName, anonymousId, cookieOptions(365));
  return response;
}

function requestContext(request: NextRequest, locale?: string) {
  const userAgent = request.headers.get("user-agent") ?? "";
  return {
    browser: detectBrowser(userAgent),
    countryCode: request.headers.get("cf-ipcountry") ?? request.headers.get("x-vercel-ip-country") ?? undefined,
    deviceType: /mobile|android|iphone|ipad/i.test(userAgent) ? "mobile" : "desktop",
    language: request.headers.get("accept-language")?.split(",")[0],
    locale,
    operatingSystem: detectOperatingSystem(userAgent),
    region: request.headers.get("x-vercel-ip-country-region") ?? undefined,
    source: "consent",
  };
}

function cookieOptions(days: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: appConfig.APP_BASE_URL.startsWith("https://"), path: "/", maxAge: days * 86_400 };
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

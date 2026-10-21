import { createHmac, randomUUID } from "node:crypto";
import type { Prisma, PrivacyConsentCategory } from "@prisma/client";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import type { AnalyticsEventName, ConsentPreferences } from "@/lib/analytics-contract";

export { analyticsEventNames } from "@/lib/analytics-contract";
export type { AnalyticsEventName, ConsentPreferences } from "@/lib/analytics-contract";

export const analyticsVisitorCookieName = "vk_analytics_visitor";
export const analyticsSessionCookieName = "vk_analytics_session";
export const privacyConsentCookieName = "vk_privacy_consent";
export const privacyPolicyVersion = "2026-08-19";

export type AnalyticsRequestContext = {
  browser: string;
  campaign?: string;
  countryCode?: string;
  deviceType: string;
  language?: string;
  locale?: string;
  medium?: string;
  operatingSystem: string;
  referrerHost?: string;
  region?: string;
  source: string;
};

export type AnalyticsEventInput = {
  anonymousId: string;
  context: AnalyticsRequestContext;
  deviceSignal?: string;
  durationSeconds?: number;
  eventName: AnalyticsEventName;
  path: string;
  productId?: string;
  properties?: Record<string, string | number | boolean>;
  sessionKey: string;
  userId?: string;
};

type RuntimeVisitor = {
  id: string;
  anonymousId: string;
  userId?: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  context: AnalyticsRequestContext;
  entryPath?: string;
  lastPath?: string;
};
type RuntimeSession = {
  id: string;
  visitorId: string;
  userId?: string;
  sessionKey: string;
  startedAt: Date;
  lastSeenAt: Date;
  entryPath: string;
  lastPath: string;
  source: string;
  locale?: string;
  pageViews: number;
  durationSeconds: number;
};
type RuntimeEvent = {
  id: string;
  visitorId: string;
  sessionId: string;
  userId?: string;
  name: AnalyticsEventName;
  path: string;
  locale?: string;
  productId?: string;
  properties?: Record<string, string | number | boolean>;
  occurredAt: Date;
};
type RuntimeConsent = { id: string; anonymousId: string; userId?: string; preferences: ConsentPreferences; recordedAt: Date };
type RuntimeDevice = { visitorId: string; userId?: string; fingerprintHash: string; deviceType: string; browser: string; lastSeenAt: Date; expiresAt: Date };
type DashboardEvent = {
  name: string;
  path: string;
  locale?: string | null;
  productId?: string | null;
  properties?: unknown;
  occurredAt: Date;
  visitorId: string;
  sessionId: string;
};
type DashboardSession = {
  id: string;
  visitorId: string;
  startedAt: Date;
  lastSeenAt: Date;
  source?: string | null;
  locale?: string | null;
  pageViews: number;
  durationSeconds: number;
};
type DashboardVisitor = {
  id: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  locale?: string | null;
  source?: string | null;
  countryCode?: string | null;
  region?: string | null;
  deviceType?: string | null;
  browser?: string | null;
  context?: AnalyticsRequestContext;
};
type DashboardConsent = {
  category?: string;
  granted?: boolean;
  recordedAt: Date;
  preferences?: ConsentPreferences;
};

const runtimeGlobal = globalThis as typeof globalThis & {
  __merchantkitAnalyticsVisitors?: Map<string, RuntimeVisitor>;
  __merchantkitAnalyticsSessions?: Map<string, RuntimeSession>;
  __merchantkitAnalyticsEvents?: RuntimeEvent[];
  __merchantkitPrivacyConsents?: RuntimeConsent[];
  __merchantkitDeviceIdentities?: Map<string, RuntimeDevice>;
};
const runtimeVisitors = runtimeGlobal.__merchantkitAnalyticsVisitors ?? new Map<string, RuntimeVisitor>();
const runtimeSessions = runtimeGlobal.__merchantkitAnalyticsSessions ?? new Map<string, RuntimeSession>();
const runtimeEvents = runtimeGlobal.__merchantkitAnalyticsEvents ?? [];
const runtimeConsents = runtimeGlobal.__merchantkitPrivacyConsents ?? [];
const runtimeDevices = runtimeGlobal.__merchantkitDeviceIdentities ?? new Map<string, RuntimeDevice>();
runtimeGlobal.__merchantkitAnalyticsVisitors = runtimeVisitors;
runtimeGlobal.__merchantkitAnalyticsSessions = runtimeSessions;
runtimeGlobal.__merchantkitAnalyticsEvents = runtimeEvents;
runtimeGlobal.__merchantkitPrivacyConsents = runtimeConsents;
runtimeGlobal.__merchantkitDeviceIdentities = runtimeDevices;

export function encodeConsentCookie(preferences: ConsentPreferences) {
  return Buffer.from(JSON.stringify({ ...preferences, version: privacyPolicyVersion }), "utf8").toString("base64url");
}

export function decodeConsentCookie(value: string | undefined): ConsentPreferences | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ConsentPreferences> & { version?: string };
    if (parsed.version !== privacyPolicyVersion) return null;
    return {
      analytics: parsed.analytics === true,
      personalization: parsed.personalization === true,
      device: parsed.device === true,
      marketing: parsed.marketing === true,
    };
  } catch {
    return null;
  }
}

export async function recordPrivacyConsent(input: {
  anonymousId: string;
  context: AnalyticsRequestContext;
  locale?: string;
  preferences: ConsentPreferences;
  source?: string;
  userId?: string;
}) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    if (input.preferences.analytics) ensureRuntimeVisitor(input.anonymousId, input.context, input.userId);
    runtimeConsents.unshift({ id: randomUUID(), anonymousId: input.anonymousId, userId: input.userId, preferences: input.preferences, recordedAt: new Date() });
    return;
  }

  const visitor = input.preferences.analytics ? await prisma.analyticsVisitor.upsert({
      where: { anonymousId: input.anonymousId },
      create: {
        anonymousId: input.anonymousId,
        userId: input.userId,
        locale: input.locale,
        language: input.context.language,
        countryCode: input.context.countryCode,
        region: input.context.region,
        deviceType: input.context.deviceType,
        browser: input.context.browser,
        operatingSystem: input.context.operatingSystem,
        source: input.context.source,
      },
      update: { userId: input.userId, lastSeenAt: new Date(), locale: input.locale },
      select: { id: true },
    }) : null;
  const categories: Array<[PrivacyConsentCategory, boolean]> = [
    ["ANALYTICS", input.preferences.analytics],
    ["PERSONALIZATION", input.preferences.personalization],
    ["DEVICE", input.preferences.device],
    ["MARKETING", input.preferences.marketing],
  ];
  await prisma.privacyConsent.createMany({
    data: categories.map(([category, granted]) => ({
      visitorId: visitor?.id,
      userId: input.userId,
      category,
      granted,
      policyVersion: privacyPolicyVersion,
      locale: input.locale,
      source: input.source ?? "consent-banner",
      withdrawnAt: granted ? null : new Date(),
    })),
  });
}

export async function recordAnalyticsEvent(input: AnalyticsEventInput) {
  if (input.path.startsWith("/admin") || input.path.startsWith("/preview")) return;
  const durationSeconds = Math.min(Math.max(Math.round(input.durationSeconds ?? 0), 0), 86_400);
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const visitor = ensureRuntimeVisitor(input.anonymousId, input.context, input.userId, input.path);
    const session = ensureRuntimeSession(input.sessionKey, visitor, input);
    visitor.lastSeenAt = new Date();
    visitor.lastPath = input.path;
    if (input.eventName === "page_view") session.pageViews += 1;
    if (input.eventName === "page_leave") session.durationSeconds += durationSeconds;
    session.lastPath = input.path;
    session.lastSeenAt = new Date();
    runtimeEvents.unshift({
      id: randomUUID(), visitorId: visitor.id, sessionId: session.id, userId: input.userId, name: input.eventName,
      path: input.path, locale: input.context.locale, productId: input.productId, properties: input.properties, occurredAt: new Date(),
    });
    if (input.deviceSignal) recordRuntimeDevice(visitor.id, input);
    trimRuntimeAnalytics();
    return;
  }

  const visitor = await prisma.analyticsVisitor.upsert({
    where: { anonymousId: input.anonymousId },
    create: {
      anonymousId: input.anonymousId,
      userId: input.userId,
      locale: input.context.locale,
      language: input.context.language,
      countryCode: input.context.countryCode,
      region: input.context.region,
      deviceType: input.context.deviceType,
      browser: input.context.browser,
      operatingSystem: input.context.operatingSystem,
      source: input.context.source,
      medium: input.context.medium,
      campaign: input.context.campaign,
      referrerHost: input.context.referrerHost,
      entryPath: input.path,
      lastPath: input.path,
    },
    update: {
      userId: input.userId,
      lastSeenAt: new Date(),
      locale: input.context.locale,
      language: input.context.language,
      countryCode: input.context.countryCode,
      region: input.context.region,
      deviceType: input.context.deviceType,
      browser: input.context.browser,
      operatingSystem: input.context.operatingSystem,
      lastPath: input.path,
    },
    select: { id: true },
  });
  const session = await prisma.analyticsSession.upsert({
    where: { sessionKey: input.sessionKey },
    create: {
      visitorId: visitor.id,
      userId: input.userId,
      sessionKey: input.sessionKey,
      entryPath: input.path,
      lastPath: input.path,
      source: input.context.source,
      medium: input.context.medium,
      campaign: input.context.campaign,
      locale: input.context.locale,
      referrerHost: input.context.referrerHost,
      pageViews: input.eventName === "page_view" ? 1 : 0,
      durationSeconds: input.eventName === "page_leave" ? durationSeconds : 0,
    },
    update: {
      userId: input.userId,
      lastSeenAt: new Date(),
      lastPath: input.path,
      ...(input.eventName === "page_leave" && durationSeconds > 0 ? { durationSeconds: { increment: durationSeconds } } : {}),
      ...(input.eventName === "page_view" ? { pageViews: { increment: 1 } } : {}),
    },
    select: { id: true },
  });
  await prisma.analyticsEvent.create({
    data: {
      visitorId: visitor.id,
      sessionId: session.id,
      userId: input.userId,
      name: input.eventName,
      path: input.path,
      locale: input.context.locale,
      productId: input.productId,
      properties: input.properties as Prisma.InputJsonValue | undefined,
    },
  });
  if (input.deviceSignal) await upsertDeviceIdentity(visitor.id, input);
}

export async function getAnalyticsDashboard(days = 30) {
  const boundedDays = Math.min(Math.max(days, 1), 365);
  const since = new Date(Date.now() - boundedDays * 86_400_000);
  const liveSince = new Date(Date.now() - 5 * 60_000);
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return buildDashboard(
      runtimeEvents.filter((event) => event.occurredAt >= since),
      [...runtimeSessions.values()].filter((session) => session.startedAt >= since),
      [...runtimeVisitors.values()].filter((visitor) => visitor.lastSeenAt >= since),
      liveSince,
      boundedDays,
      runtimeConsents.filter((consent) => consent.recordedAt >= since),
    );
  }

  const [events, sessions, visitors, consentRows] = await Promise.all([
    prisma.analyticsEvent.findMany({ where: { occurredAt: { gte: since } }, select: { name: true, path: true, locale: true, productId: true, properties: true, occurredAt: true, visitorId: true, sessionId: true } }),
    prisma.analyticsSession.findMany({ where: { startedAt: { gte: since } }, select: { id: true, visitorId: true, startedAt: true, lastSeenAt: true, source: true, locale: true, pageViews: true, durationSeconds: true } }),
    prisma.analyticsVisitor.findMany({ where: { lastSeenAt: { gte: since } }, select: { id: true, firstSeenAt: true, lastSeenAt: true, locale: true, source: true, countryCode: true, region: true, deviceType: true, browser: true } }),
    prisma.privacyConsent.findMany({ where: { recordedAt: { gte: since } }, select: { category: true, granted: true, recordedAt: true } }),
  ]);
  return buildDashboard(events, sessions, visitors, liveSince, boundedDays, consentRows);
}

export async function getCustomerAnalyticsProfile(userId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const visitors = [...runtimeVisitors.values()].filter((visitor) => visitor.userId === userId);
    const visitorIds = new Set(visitors.map((visitor) => visitor.id));
    const events = runtimeEvents.filter((event) => visitorIds.has(event.visitorId));
    return {
      firstSeenAt: minDate(visitors.map((item) => item.firstSeenAt)),
      lastSeenAt: maxDate(visitors.map((item) => item.lastSeenAt)),
      sessions: [...runtimeSessions.values()].filter((session) => visitorIds.has(session.visitorId)).length,
      pageViews: events.filter((event) => event.name === "page_view").length,
      topPaths: countBy(events, (event) => event.path).slice(0, 5),
      devices: [...runtimeDevices.values()].filter((device) => device.userId === userId).length,
    };
  }
  const [visitors, sessions, events, devices] = await Promise.all([
    prisma.analyticsVisitor.findMany({ where: { userId }, select: { firstSeenAt: true, lastSeenAt: true } }),
    prisma.analyticsSession.count({ where: { userId } }),
    prisma.analyticsEvent.findMany({ where: { userId }, select: { name: true, path: true } }),
    prisma.deviceIdentity.count({ where: { userId, expiresAt: { gt: new Date() } } }),
  ]);
  return {
    firstSeenAt: minDate(visitors.map((item) => item.firstSeenAt)),
    lastSeenAt: maxDate(visitors.map((item) => item.lastSeenAt)),
    sessions,
    pageViews: events.filter((event) => event.name === "page_view").length,
    topPaths: countBy(events, (event) => event.path).slice(0, 5),
    devices,
  };
}

function ensureRuntimeVisitor(anonymousId: string, context: AnalyticsRequestContext, userId?: string, path?: string) {
  const existing = runtimeVisitors.get(anonymousId);
  if (existing) {
    existing.userId = userId ?? existing.userId;
    existing.context = { ...existing.context, ...context };
    existing.lastSeenAt = new Date();
    if (path) existing.lastPath = path;
    return existing;
  }
  const visitor: RuntimeVisitor = { id: randomUUID(), anonymousId, userId, firstSeenAt: new Date(), lastSeenAt: new Date(), context, entryPath: path, lastPath: path };
  runtimeVisitors.set(anonymousId, visitor);
  return visitor;
}

function ensureRuntimeSession(sessionKey: string, visitor: RuntimeVisitor, input: AnalyticsEventInput) {
  const existing = runtimeSessions.get(sessionKey);
  if (existing) return existing;
  const session: RuntimeSession = { id: randomUUID(), visitorId: visitor.id, userId: input.userId, sessionKey, startedAt: new Date(), lastSeenAt: new Date(), entryPath: input.path, lastPath: input.path, source: input.context.source, locale: input.context.locale, pageViews: 0, durationSeconds: 0 };
  runtimeSessions.set(sessionKey, session);
  return session;
}

function recordRuntimeDevice(visitorId: string, input: AnalyticsEventInput) {
  const fingerprintHash = hashDeviceSignal(input.deviceSignal ?? "");
  runtimeDevices.set(`${visitorId}:${fingerprintHash}`, { visitorId, userId: input.userId, fingerprintHash, deviceType: input.context.deviceType, browser: input.context.browser, lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 90 * 86_400_000) });
}

async function upsertDeviceIdentity(visitorId: string, input: AnalyticsEventInput) {
  const fingerprintHash = hashDeviceSignal(input.deviceSignal ?? "");
  await prisma.deviceIdentity.upsert({
    where: { visitorId_fingerprintHash: { visitorId, fingerprintHash } },
    create: { visitorId, userId: input.userId, fingerprintHash, purpose: "fraud-prevention-and-device-recognition", deviceType: input.context.deviceType, browser: input.context.browser, expiresAt: new Date(Date.now() + 90 * 86_400_000) },
    update: { userId: input.userId, deviceType: input.context.deviceType, browser: input.context.browser, lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 90 * 86_400_000) },
  });
}

function hashDeviceSignal(signal: string) {
  return createHmac("sha256", appConfig.SESSION_SECRET).update(signal.slice(0, 1000)).digest("hex");
}

function buildDashboard(events: DashboardEvent[], sessions: DashboardSession[], visitors: DashboardVisitor[], liveSince: Date, days: number, consentRows: DashboardConsent[]) {
  const pageViews = events.filter((event) => event.name === "page_view");
  const visitorFirstSeen = visitors.map((visitor) => new Date(visitor.firstSeenAt));
  const periodStart = new Date(Date.now() - days * 86_400_000);
  const newVisitors = visitorFirstSeen.filter((date) => date >= periodStart).length;
  const returningVisitors = Math.max(visitors.length - newVisitors, 0);
  const bounced = sessions.filter((session) => Number(session.pageViews) <= 1).length;
  const averageDurationSeconds = sessions.length ? Math.round(sessions.reduce((sum, session) => sum + Number(session.durationSeconds || 0), 0) / sessions.length) : 0;
  const funnelNames: AnalyticsEventName[] = ["product_view", "select_pack", "add_to_bag", "begin_checkout", "order_created", "payment_success"];
  const consentLatest = new Map<string, boolean>();
  for (const row of consentRows.sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime())) {
    if (row.preferences) {
      for (const [key, granted] of Object.entries(row.preferences)) consentLatest.set(key, granted === true);
    } else consentLatest.set(String(row.category).toLowerCase(), row.granted === true);
  }
  return {
    periodDays: days,
    generatedAt: new Date().toISOString(),
    totals: {
      liveVisitors: visitors.filter((visitor) => new Date(visitor.lastSeenAt) >= liveSince).length,
      visitors: visitors.length,
      pageViews: pageViews.length,
      sessions: sessions.length,
      newVisitors,
      returningVisitors,
      averageDurationSeconds,
      bounceRate: sessions.length ? Math.round((bounced / sessions.length) * 1000) / 10 : 0,
    },
    sources: countBy(visitors, (visitor) => visitor.source || visitor.context?.source || "direct").slice(0, 10),
    locales: countBy(visitors, (visitor) => visitor.locale || visitor.context?.locale || "unknown").slice(0, 10),
    countries: countBy(visitors, (visitor) => visitor.countryCode || visitor.context?.countryCode || "unknown").slice(0, 10),
    devices: countBy(visitors, (visitor) => visitor.deviceType || visitor.context?.deviceType || "unknown").slice(0, 10),
    browsers: countBy(visitors, (visitor) => visitor.browser || visitor.context?.browser || "unknown").slice(0, 10),
    topPages: countBy(pageViews, (event) => event.path).slice(0, 10),
    topProducts: countBy(events.filter((event) => event.productId), (event) => String(event.productId)).slice(0, 10),
    funnel: funnelNames.map((name) => ({ label: name, value: new Set(events.filter((event) => event.name === name).map((event) => event.sessionId)).size })),
    preferences: {
      packs: countProperty(events, "pack"),
      colors: countProperty(events, "color"),
      sizes: countProperty(events, "size"),
    },
    consent: Object.fromEntries(consentLatest),
  };
}

function countProperty(events: DashboardEvent[], key: string) {
  return countBy(events.filter((event) => readProperty(event.properties, key)), (event) => String(readProperty(event.properties, key))).slice(0, 10);
}

function readProperty(properties: unknown, key: string) {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return undefined;
  return (properties as Record<string, unknown>)[key];
}

function countBy<T>(items: T[], selector: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = selector(item) || "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function minDate(values: Date[]) {
  return values.length ? new Date(Math.min(...values.map((value) => value.getTime()))).toISOString() : null;
}

function maxDate(values: Date[]) {
  return values.length ? new Date(Math.max(...values.map((value) => value.getTime()))).toISOString() : null;
}

function trimRuntimeAnalytics() {
  if (runtimeEvents.length > 20_000) runtimeEvents.splice(20_000);
  const cutoff = Date.now() - 400 * 86_400_000;
  for (const [key, session] of runtimeSessions) if (session.lastSeenAt.getTime() < cutoff) runtimeSessions.delete(key);
}

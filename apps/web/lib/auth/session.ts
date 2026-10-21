import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { appConfig } from "@/lib/config";

export const sessionCookieName = "merchantkit_session";
export const adminSessionCookieName = "merchantkit_admin_session";

export type SessionRole = "customer" | "admin" | "owner";

export type SessionPayload = {
  userId: string;
  role: SessionRole;
  phone?: string;
  expiresAt: string;
};

export type SessionMetadata = {
  ip?: string;
  userAgent?: string;
};

const globalForSessions = globalThis as typeof globalThis & {
  __merchantkitRuntimeSessions?: Map<string, SessionPayload>;
};

const runtimeSessions = globalForSessions.__merchantkitRuntimeSessions ?? new Map<string, SessionPayload>();
globalForSessions.__merchantkitRuntimeSessions = runtimeSessions;

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createSessionToken() {
  return randomBytes(32).toString("hex");
}

export function registerRuntimeSession(token: string, payload: SessionPayload) {
  runtimeSessions.set(hashToken(token), payload);
}

export function readRuntimeSession(token: string) {
  if (!token) return null;
  const session = runtimeSessions.get(hashToken(token));
  if (!session) return null;
  if (new Date(session.expiresAt).getTime() <= Date.now()) {
    runtimeSessions.delete(hashToken(token));
    return null;
  }
  return session;
}

export async function persistSessionToken(
  token: string,
  expiresAt: Date,
  payload: Omit<SessionPayload, "expiresAt">,
  metadata: SessionMetadata = {},
) {
  registerRuntimeSession(token, { ...payload, expiresAt: expiresAt.toISOString() });
  if (appConfig.COMMERCE_STORAGE === "prisma") {
    const { persistPrismaSession } = await import("@/lib/services/prisma-session-store");
    await persistPrismaSession(token, expiresAt, payload, metadata);
  }
}

export async function readSessionByToken(token: string) {
  if (!token) return null;
  if (appConfig.COMMERCE_STORAGE !== "prisma") return readRuntimeSession(token);

  const { readPrismaSession } = await import("@/lib/services/prisma-session-store");
  return readPrismaSession(token);
}

export async function deleteSessionToken(token: string) {
  runtimeSessions.delete(hashToken(token));
  if (appConfig.COMMERCE_STORAGE === "prisma") {
    const { deletePrismaSession } = await import("@/lib/services/prisma-session-store");
    await deletePrismaSession(token);
  }
}

export async function setSessionCookie(token: string, expiresAt: Date, payload?: Omit<SessionPayload, "expiresAt">) {
  if (payload) {
    await persistSessionToken(token, expiresAt, payload);
  }

  const store = await cookies();
  store.set(sessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: appConfig.APP_BASE_URL.startsWith("https://"),
    path: "/",
    expires: expiresAt,
  });
}

export async function setAdminSessionCookie(token: string, expiresAt: Date, payload?: Omit<SessionPayload, "expiresAt">) {
  if (payload) {
    await persistSessionToken(token, expiresAt, payload);
  }

  const store = await cookies();
  store.set(adminSessionCookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: appConfig.APP_BASE_URL.startsWith("https://"),
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  const userToken = store.get(sessionCookieName)?.value;
  const adminToken = store.get(adminSessionCookieName)?.value;
  if (userToken) await deleteSessionToken(userToken);
  if (adminToken) await deleteSessionToken(adminToken);
  store.delete(sessionCookieName);
  store.delete(adminSessionCookieName);
}

export async function readSessionToken() {
  const store = await cookies();
  return store.get(sessionCookieName)?.value ?? "";
}

export async function readAdminSessionToken() {
  const store = await cookies();
  return store.get(adminSessionCookieName)?.value ?? "";
}

export async function readCurrentUserSession() {
  return readSessionByToken(await readSessionToken());
}

export async function readCurrentAdminSession() {
  const session = await readSessionByToken(await readAdminSessionToken());
  if (!session || (session.role !== "admin" && session.role !== "owner")) return null;
  return session;
}

export function readBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization) return "";
  const match = authorization.match(/^Bearer ([a-f0-9]{64})$/i);
  return match?.[1] ?? "";
}

export async function readRequestUserSession(request: Request) {
  if (request.headers.has("authorization")) {
    return readSessionByToken(readBearerToken(request));
  }
  return readCurrentUserSession();
}

export async function readBearerUserSession(request: Request) {
  return readSessionByToken(readBearerToken(request));
}

import { NextResponse } from "next/server";
import { readBearerUserSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import { getAccountProfile } from "@/lib/services/account-profile-service";

export async function GET(request: Request) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    return noStoreJson({ ok: false, error: "MINIPROGRAM_AUTH_REQUIRES_PRISMA" }, 503);
  }
  const session = await readBearerUserSession(request);
  if (!session) return noStoreJson({ ok: false, error: "AUTH_REQUIRED" }, 401);

  try {
    const profile = await getAccountProfile(session.userId, { phone: session.phone });
    return noStoreJson({ ok: true, user: profile });
  } catch (error) {
    return noStoreJson({
      ok: false,
      error: error instanceof Error ? error.message : "ACCOUNT_LOAD_FAILED",
    }, 404);
  }
}

function noStoreJson(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

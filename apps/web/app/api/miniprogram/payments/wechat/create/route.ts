import { NextResponse } from "next/server";
import { z } from "zod";
import { readBearerUserSession } from "@/lib/auth/session";
import { getWeChatPayProviderStatus } from "@/lib/providers/wechat-pay";
import { prepareWeChatPaymentForUser } from "@/lib/services/wechat-payment-service";

export const runtime = "nodejs";

const inputSchema = z.object({ orderNo: z.string().trim().min(3).max(40) });

export async function POST(request: Request) {
  const session = await readBearerUserSession(request);
  if (!session) return noStoreJson({ ok: false, error: "AUTH_REQUIRED" }, 401);
  if (!getWeChatPayProviderStatus().configured) {
    return noStoreJson({ ok: false, error: "WECHAT_PAY_NOT_CONFIGURED" }, 503);
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return noStoreJson({ ok: false, error: "INVALID_WECHAT_PAY_REQUEST" }, 400);

  try {
    const result = await prepareWeChatPaymentForUser(parsed.data.orderNo, session.userId);
    return noStoreJson({ ok: true, ...result });
  } catch (error) {
    return noStoreJson({
      ok: false,
      error: safePaymentError(error),
    }, 400);
  }
}

function safePaymentError(error: unknown) {
  const message = error instanceof Error ? error.message : "WECHAT_PAY_CREATE_FAILED";
  return /^[A-Z0-9_:]+$/.test(message) ? message : "WECHAT_PAY_CREATE_FAILED";
}

function noStoreJson(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

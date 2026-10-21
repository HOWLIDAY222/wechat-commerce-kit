import { NextResponse } from "next/server";
import { z } from "zod";
import { readBearerUserSession } from "@/lib/auth/session";
import { queryWeChatPaymentForUser } from "@/lib/services/wechat-payment-service";

export const runtime = "nodejs";

const inputSchema = z.object({ orderNo: z.string().trim().min(3).max(40) });

export async function POST(request: Request) {
  const session = await readBearerUserSession(request);
  if (!session) return noStoreJson({ ok: false, error: "AUTH_REQUIRED" }, 401);
  const parsed = inputSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return noStoreJson({ ok: false, error: "INVALID_WECHAT_PAY_QUERY" }, 400);

  try {
    return noStoreJson({ ok: true, ...(await queryWeChatPaymentForUser(parsed.data.orderNo, session.userId)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "WECHAT_PAY_QUERY_FAILED";
    return noStoreJson({ ok: false, error: /^[A-Z0-9_:]+$/.test(message) ? message : "WECHAT_PAY_QUERY_FAILED" }, 400);
  }
}

function noStoreJson(body: unknown, status = 200) {
  const response = NextResponse.json(body, { status });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

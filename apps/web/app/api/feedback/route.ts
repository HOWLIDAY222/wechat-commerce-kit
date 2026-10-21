import { NextResponse } from "next/server";
import { appConfig } from "@/lib/config";
import { feedbackSchema, feedbackMessage } from "@/lib/website-feedback";
import { createContactInquiry } from "@/lib/services/customer-care-service";

export const runtime = "nodejs";
const attempts = new Map<string, { count: number; expires: number }>();
const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(appConfig.APP_BASE_URL).origin) return fail("INVALID_ORIGIN", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return fail("INVALID_FEEDBACK", 400);
  const ip = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
  const now = Date.now();
  for (const [key, value] of attempts) if (value.expires < now) attempts.delete(key);
  const bucket = attempts.get(ip) ?? { count: 0, expires: now + 60_000 };
  if (bucket.count >= 10 || attempts.size >= 10_000) return fail("RATE_LIMIT", 429);
  bucket.count++; attempts.set(ip, bucket);
  if (Number(request.headers.get("content-length")) > 16384) return fail("BODY_TOO_LARGE", 413);
  try {
    if (!request.body) return fail("INVALID_FEEDBACK", 400);
    const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > 16384) { await reader.cancel(); return fail("BODY_TOO_LARGE", 413); }
      chunks.push(value);
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return fail("INVALID_FEEDBACK", 400); }
    const parsed = feedbackSchema.safeParse(body);
    if (!parsed.success) return fail("INVALID_FEEDBACK", 400);
    const data = parsed.data;
    const inquiry = await createContactInquiry({ name: "网站体验调研", contact: data.contact || "未留联系方式", message: feedbackMessage(data, request.headers.get("user-agent") || ""), ip, userAgent: request.headers.get("user-agent")?.slice(0, 500) });
    return NextResponse.json({ ok: true, id: inquiry.id }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch { return fail("FEEDBACK_UNAVAILABLE", 503); }
}

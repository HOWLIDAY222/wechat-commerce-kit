import { NextResponse } from "next/server";
import { getProductBySlug } from "@/lib/services/catalog-service";
import { miniProgramDestination, weChatLaunch } from "@/lib/providers/wechat-launch";

// A bounded process-local quota limits anonymous link generation. With multiple
// replicas this must be replaced by the shared edge/Redis rate limiter.
const requests = new Map<string, { count: number; until: number }>();
function allowed(request: Request) {
  const key = request.headers.get("x-real-ip") ?? "local";
  const now = Date.now();
  const current = requests.get(key);
  if (current && current.until > now) return ++current.count <= 30;
  if (requests.size >= 2000) {
    for (const [ip, entry] of requests) if (entry.until <= now) requests.delete(ip);
    if (requests.size >= 2000) return false;
  }
  requests.set(key, { count: 1, until: now + 60_000 });
  return true;
}
const failure = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (process.env.MINIPROGRAM_STORE_RELEASED !== "true") return failure("MINIPROGRAM_NOT_RELEASED", 503);
  const origin = request.headers.get("origin");
  if (origin) {
    try { if (new URL(origin).host !== request.headers.get("host")) return failure("INVALID_ORIGIN", 403); }
    catch { return failure("INVALID_ORIGIN", 403); }
  }
  if (!allowed(request)) return failure("TOO_MANY_REQUESTS", 429);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || (body.slug !== undefined && typeof body.slug !== "string") || ![undefined, "link", "code"].includes(body.kind)) return failure("INVALID_LAUNCH_REQUEST", 400);
  try { miniProgramDestination(body.slug); } catch { return failure("INVALID_PRODUCT_SLUG", 400); }
  if (body.slug && !await getProductBySlug(body.slug)) return failure("PRODUCT_NOT_FOUND", 404);
  try {
    if (body.kind === "code") {
      const code = await weChatLaunch.code(body.slug);
      return new Response(Buffer.from(code.bytes), { headers: { "content-type": code.contentType, "cache-control": "no-store" } });
    }
    return NextResponse.json({ ok: true, url: await weChatLaunch.link(body.slug) }, { headers: { "Cache-Control": "no-store" } });
  } catch { return failure("WECHAT_LAUNCH_UNAVAILABLE", 503); }
}

import { NextResponse } from "next/server";
import { readRequestUserSession } from "@/lib/auth/session";
import { hasSameHostDispatchEstimateOrigin } from "@/lib/commerce/order-dispatch-estimate";
import { recordSubscriptionReceipt, subscriptionOverview, updateSubscriptionPreferences } from "@/lib/services/wechat-subscription-service";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };
const safeOrigin = (request: Request) => !request.headers.has("cookie") && /^Bearer [A-Za-z0-9._~-]+$/.test(request.headers.get("authorization") || "") || hasSameHostDispatchEstimateOrigin(request);
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "SUBSCRIPTION_UNAVAILABLE";
  const code = /^(?:SUBSCRIPTION_[A-Z_]+|AUTH_REQUIRED)$/.test(message) ? message : "SUBSCRIPTION_UNAVAILABLE";
  const status = code === "AUTH_REQUIRED" ? 401 : code === "SUBSCRIPTION_RATE_LIMITED" ? 429 : code === "SUBSCRIPTION_INPUT_INVALID" ? 400 : /(?:CONFLICT|CHANGED|LINK_REQUIRED)$/.test(code) ? 409 : 503;
  return NextResponse.json({ ok: false, error: code }, { status, headers });
}
export async function GET(request: Request) {
  const session = await readRequestUserSession(request);
  try { return NextResponse.json({ ok: true, ...await subscriptionOverview(session?.userId) }, { headers }); } catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401, headers });
  if (!safeOrigin(request)) return NextResponse.json({ ok: false, error: "INVALID_ORIGIN" }, { status: 403, headers });
  const body = await request.json().catch(() => null);
  try { return NextResponse.json({ ok: true, ...await updateSubscriptionPreferences(session.userId, body?.enabledChannels, body?.expectedRevision) }, { headers }); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401, headers });
  if (!safeOrigin(request)) return NextResponse.json({ ok: false, error: "INVALID_ORIGIN" }, { status: 403, headers });
  try { return NextResponse.json({ ok: true, ...await recordSubscriptionReceipt(session.userId, await request.json().catch(() => null)) }, { headers }); } catch (error) { return failure(error); }
}

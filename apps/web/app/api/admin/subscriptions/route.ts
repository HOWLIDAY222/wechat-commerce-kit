import { NextResponse } from "next/server";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { hasSameHostDispatchEstimateOrigin } from "@/lib/commerce/order-dispatch-estimate";
import { adminSubscriptionOverview, createSubscriptionCampaign, queueSubscriptionCampaign, saveSubscriptionSettings } from "@/lib/services/wechat-subscription-service";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "SUBSCRIPTION_UNAVAILABLE";
  const code = /^(?:SUBSCRIPTION_[A-Z_]+|OWNER_REQUIRED|ADMIN_REQUIRED)$/.test(message) ? message : "SUBSCRIPTION_UNAVAILABLE";
  return NextResponse.json({ ok: false, error: code }, { status: ["OWNER_REQUIRED", "ADMIN_REQUIRED"].includes(code) ? 403 : /(?:INVALID|REQUIRED|NOT_OWNED)$/.test(code) && !/(?:DATABASE|SCHEMA)_REQUIRED$/.test(code) ? 400 : /(?:CONFLICT|NOT_DRAFT|DISABLED)$/.test(code) ? 409 : /NOT_FOUND$/.test(code) ? 404 : 503, headers });
}
export async function GET(request: Request) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401, headers });
  try { return NextResponse.json({ ok: true, ...await adminSubscriptionOverview(session.userId, new URL(request.url).searchParams.get("refresh") === "1") }, { headers }); } catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401, headers });
  if (!hasSameHostDispatchEstimateOrigin(request)) return NextResponse.json({ ok: false, error: "INVALID_ORIGIN" }, { status: 403, headers });
  try { return NextResponse.json({ ok: true, settings: await saveSubscriptionSettings(session.userId, await request.json().catch(() => null)) }, { headers }); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401, headers });
  if (!hasSameHostDispatchEstimateOrigin(request)) return NextResponse.json({ ok: false, error: "INVALID_ORIGIN" }, { status: 403, headers });
  const body = await request.json().catch(() => null);
  try {
    if (body?.action === "create_campaign") return NextResponse.json({ ok: true, campaign: await createSubscriptionCampaign(session.userId, body) }, { headers });
    if (body?.action === "queue_campaign" && typeof body.id === "string") return NextResponse.json({ ok: true, campaign: await queueSubscriptionCampaign(session.userId, body.id, body.confirmation) }, { headers });
    return NextResponse.json({ ok: false, error: "SUBSCRIPTION_INPUT_INVALID" }, { status: 400, headers });
  } catch (error) { return failure(error); }
}

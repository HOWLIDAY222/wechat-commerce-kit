import { NextResponse } from "next/server";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { getLogisticsRule, setLogisticsRule } from "@/lib/services/wechat-logistics-service";

const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401, headers });
  if (session.role !== "owner") return NextResponse.json({ ok: false, error: "OWNER_REQUIRED" }, { status: 403, headers });
  try { return NextResponse.json({ ok: true, rule: await getLogisticsRule() }, { headers }); }
  catch { return NextResponse.json({ ok: false, error: "LOGISTICS_SETTINGS_UNAVAILABLE" }, { status: 503, headers }); }
}

export async function POST(request: Request) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401, headers });
  if (session.role !== "owner") return NextResponse.json({ ok: false, error: "OWNER_REQUIRED" }, { status: 403, headers });
  const origin = request.headers.get("origin");
  if (origin) {
    let sameHost = false;
    try {
      const parsed = new URL(origin);
      sameHost = ["https:", "http:"].includes(parsed.protocol) && parsed.host === request.headers.get("host");
    } catch { /* Invalid or opaque browser origins are rejected. */ }
    if (!sameHost) return NextResponse.json({ ok: false, error: "INVALID_ORIGIN" }, { status: 403, headers });
  }
  const input = await request.json().catch(() => null);
  if (!input || typeof input.enabled !== "boolean" || Object.keys(input).some(key => key !== "enabled")) {
    return NextResponse.json({ ok: false, error: "INVALID_LOGISTICS_SETTING" }, { status: 400, headers });
  }
  try { return NextResponse.json({ ok: true, rule: await setLogisticsRule(input.enabled, session.userId) }, { headers }); }
  catch (error) {
    const code = error instanceof Error && error.message === "WECHAT_LOGISTICS_SCHEMA_REQUIRED" ? error.message : "LOGISTICS_SETTINGS_SAVE_FAILED";
    return NextResponse.json({ ok: false, error: code }, { status: 503, headers });
  }
}

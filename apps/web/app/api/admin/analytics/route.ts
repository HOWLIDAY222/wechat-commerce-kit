import { NextRequest, NextResponse } from "next/server";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { getAnalyticsDashboard } from "@/lib/services/analytics-service";

export async function GET(request: NextRequest) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  const days = Number(request.nextUrl.searchParams.get("days") ?? 30);
  return NextResponse.json({ ok: true, report: await getAnalyticsDashboard(days) });
}

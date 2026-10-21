import { NextResponse } from "next/server";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { listSiteBuilderPages } from "@/lib/services/site-builder-service";

export async function GET() {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  return NextResponse.json({ ok: true, pages: await listSiteBuilderPages() });
}

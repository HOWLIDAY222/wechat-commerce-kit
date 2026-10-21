import { NextResponse } from "next/server";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { publishSiteBuilderDraft } from "@/lib/services/site-builder-service";
import { revalidateStorefront } from "@/lib/storefront-revalidation";

type PageRouteProps = { params: Promise<{ pageKey: string }> };

export async function POST(_request: Request, { params }: PageRouteProps) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  try {
    const { pageKey } = await params;
    const result = await publishSiteBuilderDraft(pageKey, session.userId);
    revalidateStorefront();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "SITE_PUBLISH_FAILED" }, { status: 400 });
  }
}

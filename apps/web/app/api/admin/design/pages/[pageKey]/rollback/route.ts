import { NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { rollbackSiteBuilderDraft } from "@/lib/services/site-builder-service";

const rollbackSchema = z.object({ versionId: z.string().min(1).max(160) });
type PageRouteProps = { params: Promise<{ pageKey: string }> };

export async function POST(request: Request, { params }: PageRouteProps) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  const parsed = rollbackSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_ROLLBACK_REQUEST" }, { status: 400 });
  try {
    const { pageKey } = await params;
    return NextResponse.json({ ok: true, draft: await rollbackSiteBuilderDraft(pageKey, parsed.data.versionId, session.userId) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "SITE_ROLLBACK_FAILED" }, { status: 400 });
  }
}

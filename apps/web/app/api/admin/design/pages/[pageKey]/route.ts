import { NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { getSiteBuilderPage, saveSiteBuilderDraft } from "@/lib/services/site-builder-service";

const draftSchema = z.object({
  document: z.unknown(),
  seoTitle: z.string().max(160).optional(),
  seoDescription: z.string().max(360).optional(),
  ogImageUrl: z.string().max(500).optional(),
  changeNote: z.string().max(240).optional(),
});

type PageRouteProps = { params: Promise<{ pageKey: string }> };

export async function GET(_request: Request, { params }: PageRouteProps) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  const { pageKey } = await params;
  const page = await getSiteBuilderPage(pageKey);
  if (!page) return NextResponse.json({ ok: false, error: "SITE_PAGE_NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ ok: true, page });
}

export async function PUT(request: Request, { params }: PageRouteProps) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  const parsed = draftSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_SITE_DRAFT" }, { status: 400 });
  try {
    const { pageKey } = await params;
    return NextResponse.json({ ok: true, draft: await saveSiteBuilderDraft(pageKey, parsed.data, session.userId) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "SITE_DRAFT_SAVE_FAILED" }, { status: 400 });
  }
}

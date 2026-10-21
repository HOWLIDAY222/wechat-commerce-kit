import { NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { updateMediaAsset } from "@/lib/services/site-builder-service";

const mediaSchema = z.object({
  name: z.string().max(120).optional(),
  altText: z.string().max(200).optional(),
  action: z.enum(["archive", "restore"]).optional(),
});
type MediaRouteProps = { params: Promise<{ assetId: string }> };

export async function PATCH(request: Request, { params }: MediaRouteProps) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  const parsed = mediaSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_MEDIA_UPDATE" }, { status: 400 });
  try {
    const { assetId } = await params;
    return NextResponse.json({ ok: true, asset: await updateMediaAsset(assetId, parsed.data, session.userId) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "MEDIA_UPDATE_FAILED" }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { createMediaAssetFromFile, listMediaAssets } from "@/lib/services/site-builder-service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  const includeArchived = new URL(request.url).searchParams.get("archived") === "1";
  return NextResponse.json({ ok: true, assets: await listMediaAssets({ includeArchived }) });
}

export async function POST(request: Request) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return NextResponse.json({ ok: false, error: "MEDIA_FILE_REQUIRED" }, { status: 400 });
  try {
    const asset = await createMediaAssetFromFile(file, {
      name: String(form.get("name") ?? ""),
      altText: String(form.get("altText") ?? ""),
    }, session.userId);
    return NextResponse.json({ ok: true, asset });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "MEDIA_UPLOAD_FAILED" }, { status: 400 });
  }
}

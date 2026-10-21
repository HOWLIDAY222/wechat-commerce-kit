import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { appConfig } from "@/lib/config";
import { readRequestUserSession } from "@/lib/auth/session";
import { addAfterSalesImageUpload } from "@/lib/services/after-sales-service";
import { normalizeUploadedImage } from "@/lib/uploads/image";

export const runtime = "nodejs";

const maxImageBytes = 5 * 1024 * 1024;
type RouteProps = { params: Promise<{ afterSalesNo: string }> };

export async function POST(request: Request, { params }: RouteProps) {
  const session = await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "AFTER_SALES_IMAGE_FILE_REQUIRED" }, { status: 400 });
  }

  let normalized: Awaited<ReturnType<typeof normalizeUploadedImage>>;
  try {
    normalized = await normalizeUploadedImage(file, { maxBytes: maxImageBytes, maxDimension: 2000 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "AFTER_SALES_IMAGE_NORMALIZATION_FAILED" },
      { status: 400 },
    );
  }

  const { afterSalesNo } = await params;
  const safeFolder = afterSalesNo.replace(/[^A-Za-z0-9_-]/g, "_");
  const uploadRoot = appConfig.UPLOAD_DIR || join(process.cwd(), "public", "uploads");
  const publicRoot = normalizePublicPath(appConfig.UPLOAD_PUBLIC_PATH);
  const uploadDir = join(uploadRoot, "after-sales", safeFolder);
  const filename = `${Date.now()}-${randomUUID()}${normalized.extension}`;
  const filePath = join(uploadDir, filename);
  const imageUrl = `${publicRoot}/after-sales/${safeFolder}/${filename}`;

  try {
    await mkdir(uploadDir, { recursive: true });
    await writeFile(filePath, normalized.buffer, { flag: "wx" });
    const afterSales = await addAfterSalesImageUpload(session.userId, afterSalesNo, {
      checksum: normalized.checksum,
      imageUrl,
      mimeType: normalized.mimeType,
      sizeBytes: normalized.sizeBytes,
    });
    return NextResponse.json({ ok: true, afterSales });
  } catch (error) {
    await rm(filePath, { force: true }).catch(() => undefined);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "AFTER_SALES_IMAGE_UPLOAD_FAILED" },
      { status: 400 },
    );
  }
}

function normalizePublicPath(value: string) {
  const trimmed = value.trim() || "/uploads";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

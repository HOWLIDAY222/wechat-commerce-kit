import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { appConfig } from "@/lib/config";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { addAdminProductImage } from "@/lib/services/admin-catalog-service";
import { deleteOrphanedMediaAsset, listMediaAssets, registerMediaAsset } from "@/lib/services/site-builder-service";
import { normalizeUploadedImage } from "@/lib/uploads/image";
import { revalidateStorefront } from "@/lib/storefront-revalidation";

export const runtime = "nodejs";

const maxImageBytes = 5 * 1024 * 1024;
type ProductImageRouteProps = {
  params: Promise<{ productId: string }>;
};

export async function POST(request: Request, { params }: ProductImageRouteProps) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });

  const { productId } = await params;
  if (request.headers.get("content-type")?.includes("application/json")) {
    const payload = await request.json().catch(() => ({})) as { assetId?: string; alt?: string; sortOrder?: number };
    const asset = payload.assetId ? (await listMediaAssets()).find((item) => item.id === payload.assetId) : null;
    if (!asset) return NextResponse.json({ ok: false, error: "MEDIA_ASSET_NOT_FOUND" }, { status: 404 });
    try {
      const image = await addAdminProductImage(productId, {
        assetId: asset.id,
        imageUrl: asset.url,
        alt: payload.alt || asset.altText || undefined,
        sortOrder: Number.isInteger(payload.sortOrder) ? payload.sortOrder : 0,
      }, session.userId);
      revalidateStorefront();
      return NextResponse.json({ ok: true, image });
    } catch (error) {
      return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "PRODUCT_IMAGE_BIND_FAILED" }, { status: 400 });
    }
  }

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ ok: false, error: "INVALID_PRODUCT_IMAGE_REQUEST" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "PRODUCT_IMAGE_FILE_REQUIRED" }, { status: 400 });
  }
  let normalized: Awaited<ReturnType<typeof normalizeUploadedImage>>;
  try {
    normalized = await normalizeUploadedImage(file, { maxBytes: maxImageBytes });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "PRODUCT_IMAGE_NORMALIZATION_FAILED" },
      { status: 400 },
    );
  }

  const safeProductFolder = productId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const uploadRoot = appConfig.UPLOAD_DIR || join(process.cwd(), "public", "uploads");
  const publicRoot = normalizePublicPath(appConfig.UPLOAD_PUBLIC_PATH);
  const productUploadDir = join(uploadRoot, "products", safeProductFolder);
  const filename = `${Date.now()}-${randomUUID()}${normalized.extension}`;
  const filePath = join(productUploadDir, filename);
  const imageUrl = `${publicRoot}/products/${safeProductFolder}/${filename}`;
  let assetId: string | null = null;

  try {
    await mkdir(productUploadDir, { recursive: true });
    await writeFile(filePath, normalized.buffer, { flag: "wx" });
    const asset = await registerMediaAsset({
      name: getOptionalString(form, "name") || file.name,
      url: imageUrl,
      altText: getOptionalString(form, "alt"),
      mimeType: normalized.mimeType,
      sizeBytes: normalized.sizeBytes,
      checksum: normalized.checksum,
      width: normalized.width,
      height: normalized.height,
    }, session.userId);
    assetId = asset.id;
    const image = await addAdminProductImage(
      productId,
      {
        assetId: asset.id,
        imageUrl,
        alt: getOptionalString(form, "alt"),
        sortOrder: getOptionalInt(form, "sortOrder") ?? 0,
        mimeType: normalized.mimeType,
        sizeBytes: normalized.sizeBytes,
        checksum: normalized.checksum,
      },
      session.userId,
    );

    revalidateStorefront();

    return NextResponse.json({ ok: true, image });
  } catch (error) {
    if (assetId) await deleteOrphanedMediaAsset(assetId, imageUrl).catch(() => undefined);
    await rm(filePath, { force: true }).catch(() => undefined);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "PRODUCT_IMAGE_UPLOAD_FAILED" },
      { status: 400 },
    );
  }
}

function normalizePublicPath(value: string) {
  const trimmed = value.trim() || "/uploads";
  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function getOptionalString(form: FormData, name: string) {
  const value = String(form.get(name) ?? "").trim();
  return value || undefined;
}

function getOptionalInt(form: FormData, name: string) {
  const raw = String(form.get(name) ?? "").trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) throw new Error("INVALID_PRODUCT_IMAGE_SORT_ORDER");
  return value;
}

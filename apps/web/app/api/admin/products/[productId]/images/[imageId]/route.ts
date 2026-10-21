import { NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { deleteAdminProductImage, updateAdminProductImage } from "@/lib/services/admin-catalog-service";
import { revalidateStorefront } from "@/lib/storefront-revalidation";

const productImagePatchSchema = z.object({
  alt: z.string().optional(),
  sortOrder: z.number().int().min(0).optional(),
  makePrimary: z.boolean().optional(),
});
type ProductImageItemRouteProps = { params: Promise<{ productId: string; imageId: string }> };

export async function PATCH(request: Request, { params }: ProductImageItemRouteProps) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  const parsed = productImagePatchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_PRODUCT_IMAGE_UPDATE" }, { status: 400 });
  try {
    const { imageId, productId } = await params;
    const image = await updateAdminProductImage(productId, imageId, parsed.data, session.userId);
    revalidateStorefront();
    return NextResponse.json({ ok: true, image });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "PRODUCT_IMAGE_UPDATE_FAILED" }, { status: 400 });
  }
}

export async function DELETE(_request: Request, { params }: ProductImageItemRouteProps) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  try {
    const { imageId, productId } = await params;
    const image = await deleteAdminProductImage(productId, imageId, session.userId);
    revalidateStorefront();
    return NextResponse.json({ ok: true, image });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "PRODUCT_IMAGE_DELETE_FAILED" }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { createAdminSku } from "@/lib/services/admin-catalog-service";
import { revalidateStorefront } from "@/lib/storefront-revalidation";

const skuSchema = z.object({
  skuCode: z.string().min(1),
  color: z.string().min(1),
  size: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
  stockQuantity: z.number().int().nonnegative(),
  reservedQuantity: z.number().int().nonnegative().optional(),
  status: z.enum(["ACTIVE", "HIDDEN"]).optional(),
});

type ProductSkuRouteProps = {
  params: Promise<{ productId: string }>;
};

export async function POST(request: Request, { params }: ProductSkuRouteProps) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });

  const parsed = skuSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_SKU_REQUEST" }, { status: 400 });

  try {
    const { productId } = await params;
    const sku = await createAdminSku(productId, parsed.data, session.userId);
    revalidateStorefront();
    return NextResponse.json({ ok: true, sku });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "SKU_CREATE_FAILED" },
      { status: 400 },
    );
  }
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { updateAdminProduct } from "@/lib/services/admin-catalog-service";
import { revalidateStorefront } from "@/lib/storefront-revalidation";

const productPatchSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  scene: z.string().optional(),
  summary: z.string().trim().max(300).optional(),
  description: z.string().trim().max(5000).optional(),
  silhouette: z.string().trim().max(40).optional(),
  rise: z.string().trim().max(40).optional(),
  coverage: z.string().trim().max(80).optional(),
  supportLevel: z.string().trim().max(80).optional(),
  fabricComposition: z.string().trim().max(300).optional(),
  features: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  fitNote: z.string().trim().max(300).optional(),
  careInstructions: z.string().trim().max(500).optional(),
  packSize: z.number().int().min(1).max(20).nullable().optional(),
  status: z.enum(["ACTIVE", "HIDDEN"]).optional(),
  saleMode: z.enum(["SHOWCASE", "PREORDER", "IN_STOCK", "PAUSED"]).optional(),
  saleStartsAt: z.string().datetime().nullable().optional(),
  estimatedShipAt: z.string().datetime().nullable().optional(),
  countdownEnabled: z.boolean().optional(),
  showPrice: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

type ProductRouteProps = {
  params: Promise<{ productId: string }>;
};

export async function PATCH(request: Request, { params }: ProductRouteProps) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });

  const parsed = productPatchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_PRODUCT_UPDATE" }, { status: 400 });

  try {
    const { productId } = await params;
    const product = await updateAdminProduct(productId, parsed.data, session.userId);
    revalidateStorefront();
    return NextResponse.json({ ok: true, product });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "PRODUCT_UPDATE_FAILED" },
      { status: 400 },
    );
  }
}

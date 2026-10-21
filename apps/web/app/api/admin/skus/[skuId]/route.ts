import { NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { updateAdminSku } from "@/lib/services/admin-catalog-service";
import { revalidateStorefront } from "@/lib/storefront-revalidation";

const skuPatchSchema = z.object({
  color: z.string().min(1).optional(),
  size: z.string().min(1).optional(),
  priceCents: z.number().int().nonnegative().optional(),
  status: z.enum(["ACTIVE", "HIDDEN"]).optional(),
}).strict();

type SkuRouteProps = {
  params: Promise<{ skuId: string }>;
};

export async function PATCH(request: Request, { params }: SkuRouteProps) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });

  const parsed = skuPatchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_SKU_UPDATE" }, { status: 400 });

  try {
    const { skuId } = await params;
    const sku = await updateAdminSku(skuId, parsed.data, session.userId);
    revalidateStorefront();
    return NextResponse.json({ ok: true, sku });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "SKU_UPDATE_FAILED" },
      { status: 400 },
    );
  }
}

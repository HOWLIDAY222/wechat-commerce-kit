import { NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { adjustAdminInventory } from "@/lib/services/admin-catalog-service";
import { revalidateStorefront } from "@/lib/storefront-revalidation";

const inventorySchema = z.object({
  action: z.enum(["ADJUST", "RESTOCK", "DAMAGE"]),
  quantity: z.number().int().nonnegative(),
  requestId: z.string().uuid(),
  expectedStock: z.number().int().nonnegative(),
  note: z.string().optional(),
});

type SkuInventoryRouteProps = {
  params: Promise<{ skuId: string }>;
};

export async function POST(request: Request, { params }: SkuInventoryRouteProps) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });

  const parsed = inventorySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_INVENTORY_REQUEST" }, { status: 400 });

  try {
    const { skuId } = await params;
    const result = await adjustAdminInventory(skuId, { ...parsed.data, actorId: session.userId });
    revalidateStorefront();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "INVENTORY_ADJUST_FAILED" },
      { status: 400 },
    );
  }
}

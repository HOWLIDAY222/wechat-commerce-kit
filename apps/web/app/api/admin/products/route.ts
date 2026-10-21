import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { createAdminProduct, listAdminProducts } from "@/lib/services/admin-catalog-service";

const productSchema = z.object({
  requestId: z.string().uuid().optional(),
  initialSku: z.object({skuCode:z.string().min(1),color:z.string().min(1),size:z.string().min(1),priceCents:z.number().int().nonnegative(),stockQuantity:z.number().int().nonnegative(),status:z.literal("HIDDEN")}).optional(),
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.string().min(1),
  scene: z.string().optional(),
  summary: z.string().trim().max(300).default(""),
  description: z.string().trim().max(5000).default(""),
  silhouette: z.string().trim().max(40).optional(),
  rise: z.string().trim().max(40).optional(),
  coverage: z.string().trim().max(80).optional(),
  supportLevel: z.string().trim().max(80).optional(),
  fabricComposition: z.string().trim().max(300).optional(),
  features: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
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

export async function GET() {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });

  return NextResponse.json({
    ok: true,
    products: await listAdminProducts(),
    audit: {
      actorId: session.userId,
      action: "admin.products.list",
      createdAt: new Date().toISOString(),
    },
  });
}

export async function POST(request: Request) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });

  const parsed = productSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_PRODUCT_REQUEST" }, { status: 400 });

  try {
    const product = {
      ...parsed.data,
      slug: buildProductSlug(parsed.data.code),
      status: "HIDDEN" as const,
      saleMode: "SHOWCASE" as const,
    };
    return NextResponse.json({
      ok: true,
      product: await createAdminProduct(product, session.userId),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "PRODUCT_CREATE_FAILED" },
      { status: 400 },
    );
  }
}

function buildProductSlug(code: string) {
  const normalized = code
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || `product-${createHash("sha256").update(code).digest("hex").slice(0, 16)}`;
}

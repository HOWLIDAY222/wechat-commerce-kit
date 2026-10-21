import { NextResponse } from "next/server";
import { z } from "zod";
import { readRequestUserSession } from "@/lib/auth/session";
import { addFavoriteProduct, listFavoriteProducts } from "@/lib/services/favorite-service";
import { toPublicProductJson } from "@/lib/services/catalog-service";

const favoriteSchema = z.object({
  productSlug: z.string().trim().min(1).max(120),
});

export async function GET(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    favorites: (await listFavoriteProducts(session.userId)).map((product) => ({
      ...toPublicProductJson(product),
      favoriteCreatedAt: product.favoriteCreatedAt,
    })),
  });
}

export async function POST(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const parsed = favoriteSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_FAVORITE_REQUEST" }, { status: 400 });
  }

  try {
    return NextResponse.json({
      ok: true,
      favorite: await addFavoriteProduct(session.userId, parsed.data.productSlug),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "FAVORITE_CREATE_FAILED" },
      { status: 400 },
    );
  }
}

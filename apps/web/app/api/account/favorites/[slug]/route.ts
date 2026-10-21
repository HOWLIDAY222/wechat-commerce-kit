import { NextResponse } from "next/server";
import { readRequestUserSession } from "@/lib/auth/session";
import { removeFavoriteProduct } from "@/lib/services/favorite-service";

type FavoriteRouteProps = {
  params: Promise<{ slug: string }>;
};

export async function DELETE(request: Request, { params }: FavoriteRouteProps) {
  const session = await readRequestUserSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const { slug } = await params;
  if (!slug) {
    return NextResponse.json({ ok: false, error: "INVALID_FAVORITE_REQUEST" }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    favorite: await removeFavoriteProduct(session.userId, decodeURIComponent(slug)),
  });
}

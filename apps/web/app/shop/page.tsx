import { ShopCatalog } from "@/app/shop/shop-catalog";
import { generateManagedPageMetadata } from "@/components/site-builder/managed-page";
import { StorefrontPage } from "@/components/storefront/storefront-ui";
import { readCurrentUserSession } from "@/lib/auth/session";
import { listFavoriteProducts } from "@/lib/services/favorite-service";
import { listProducts } from "@/lib/services/catalog-service";
import { isPubliclyOfferedProduct, isUnreleasedProduct } from "@/lib/storefront-visibility";
import Link from "next/link";
import { isDomesticStorefront } from "@/lib/server/storefront-market";
import { MiniProgramStore } from "@/components/storefront/mini-program-store";

export const dynamic = "force-dynamic";
export const generateMetadata = () => generateManagedPageMetadata("shop");

export default async function ShopPage({ searchParams }: { searchParams: Promise<{ q?: string; release?: string; silhouette?: string }> }) {
  if (await isDomesticStorefront()) return <MiniProgramStore />;
  const params = await searchParams;
  const initialSilhouette = params.silhouette?.trim() ?? "ALL";
  const initialQuery = params.q?.trim() ?? "";
  const showingUnreleased = params.release === "unreleased";
  const session = await readCurrentUserSession();
  const [products, favorites] = await Promise.all([
    listProducts(),
    session ? listFavoriteProducts(session.userId) : Promise.resolve([]),
  ]);
  const favoriteSlugs = new Set(favorites.map((product) => product.slug));
  const offeredProducts = products.filter(isPubliclyOfferedProduct);
  const unreleasedProducts = products.filter(isUnreleasedProduct);
  const visibleProducts = showingUnreleased ? unreleasedProducts : offeredProducts;

  return (
    <StorefrontPage fullBleed>
      <header className="px-5 pb-7 pt-9 md:px-8 md:pb-9 md:pt-12">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-black/55">X-Series</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <h1 className="text-[32px] font-semibold leading-tight md:text-[42px]">{showingUnreleased ? "未发售产品" : "男士内裤"}</h1>
          <p className="max-w-lg text-sm leading-6 text-black/60">{showingUnreleased ? "在这里查看尚未开放预售或发售的 X-Series。" : "白色 · S / M / L"}</p>
        </div>
        {unreleasedProducts.length > 0 ? <nav aria-label="商品发售状态" className="mt-7 flex flex-wrap gap-2">
          <ReleaseLink active={!showingUnreleased} count={offeredProducts.length} href="/shop" label="预售与发售" />
          <ReleaseLink active={showingUnreleased} count={unreleasedProducts.length} href="/shop?release=unreleased" label="未发售产品" />
        </nav> : null}
      </header>

      <ShopCatalog favoriteSlugs={[...favoriteSlugs]} initialQuery={initialQuery} initialSilhouette={initialSilhouette} products={visibleProducts} />
    </StorefrontPage>
  );
}

function ReleaseLink({ active, count, href, label }: { active: boolean; count: number; href: string; label: string }) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition ${active ? "border-black bg-black !text-white" : "border-black/20 hover:border-black"}`}
      href={href}
    >
      {label}
      <span className={active ? "text-white/60" : "text-black/45"}>{count}</span>
    </Link>
  );
}

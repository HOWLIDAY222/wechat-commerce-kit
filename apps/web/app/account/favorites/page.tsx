import { FavoriteList } from "@/app/account/favorites/favorite-list";
import { fetchAccountJson } from "@/app/account/_lib/account-page-fetch";
import { AccountShell } from "@/components/storefront/account-shell";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "我的收藏",
  description: "管理 MerchantKit 账户收藏的商品。",
};

type FavoriteProduct = {
  category: string;
  favoriteCreatedAt: Date | string;
  image: string;
  maxPriceCents: number;
  minPriceCents: number;
  name: string;
  slug: string;
  summary: string;
};

export default async function AccountFavoritesPage() {
  const { favorites } = await fetchAccountJson<{ ok: boolean; favorites: FavoriteProduct[] }>("/api/account/favorites");

  return (
    <AccountShell
      active="favorites"
      description="收藏喜欢的商品，方便下次选购。"
      eyebrow="收藏夹"
      title="我的收藏"
    >
      <FavoriteList initialFavorites={favorites} />
    </AccountShell>
  );
}

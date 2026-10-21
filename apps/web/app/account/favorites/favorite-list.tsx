"use client";

import Image from "next/image";
import Link from "next/link";
import { Heart, ShoppingCart } from "lucide-react";
import { useState } from "react";

type FavoriteItem = {
  category: string;
  favoriteCreatedAt: Date | string;
  image: string;
  maxPriceCents: number;
  minPriceCents: number;
  name: string;
  slug: string;
  summary: string;
};

export function FavoriteList({ initialFavorites }: { initialFavorites: FavoriteItem[] }) {
  const [favorites, setFavorites] = useState(initialFavorites);
  const [busySlug, setBusySlug] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  async function removeFavorite(slug: string) {
    setBusySlug(slug);
    setMessage("正在移除收藏...");
    try {
    const response = await fetch(`/api/account/favorites/${encodeURIComponent(slug)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setBusySlug(null);

    if (!response.ok || !result.ok) {
      setMessage(result.error === "AUTH_REQUIRED" ? "请先登录。" : "移除收藏失败，请稍后重试。");
      return;
    }

    setFavorites((current) => current.filter((item) => item.slug !== slug));
    setMessage("已移除收藏。");
    } catch { setMessage("连接失败，请重试。"); }
    finally { setBusySlug(null); }
  }

  return (
    <div className="grid gap-5">
      {message ? <p className="py-3 text-sm text-muted" role="status">{message}</p> : null}
      {favorites.length ? (
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          {favorites.map((product, index) => (
            <article className="grid overflow-hidden rounded-[8px] border border-line bg-white" key={product.slug}>
              <Link className="relative aspect-[5/4] bg-[#f5f6f8]" href={`/products/${product.slug}`}>
                <Image
                  src={product.image || "/assets/brand/product-placeholder.webp"}
                  alt={product.name}
                  fill
                  priority={index === 0}
                  sizes="(min-width: 1280px) 280px, (min-width: 640px) 50vw, 100vw"
                  className="object-contain p-4"
                />
              </Link>
              <div className="grid gap-3 p-4">
                <div>
                  <p className="text-xs font-black text-muted">{product.category}</p>
                  <Link className="mt-1 line-clamp-1 text-base font-black hover:text-brand" href={`/products/${product.slug}`}>
                    {product.name}
                  </Link>
                  <p className="mt-1 line-clamp-2 text-xs font-bold leading-5 text-muted">{product.summary}</p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <strong>{formatPrice(product)}</strong>
                  <span className="text-xs font-bold text-muted">收藏于 {formatDate(product.favoriteCreatedAt)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Link className="vk-button vk-button-dark h-10 min-h-10 px-3 text-sm" href={`/products/${product.slug}`}>
                    <ShoppingCart className="h-4 w-4" />
                    查看商品
                  </Link>
                  <button
                    className="vk-button vk-button-light h-10 min-h-10 px-3 text-sm"
                    disabled={busySlug === product.slug}
                    onClick={() => void removeFavorite(product.slug)}
                    type="button"
                  >
                    <Heart className="h-4 w-4 fill-current" />
                    移除
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="py-12 text-center">
          <Heart className="mx-auto h-9 w-9" />
          <p className="mt-3 font-black">还没有收藏商品</p>
          <p className="mx-auto mt-2 max-w-md text-sm font-bold leading-6 text-muted">浏览商品时点击心形按钮，喜欢的商品会集中保存到这里。</p>
          <Link className="vk-button vk-button-dark mt-5" href="/shop">去选购</Link>
        </div>
      )}
    </div>
  );
}

function formatPrice(product: Pick<FavoriteItem, "maxPriceCents" | "minPriceCents">) {
  const formatter = new Intl.NumberFormat("zh-CN", { currency: "CNY", style: "currency" });
  if (product.minPriceCents <= 0 || product.maxPriceCents <= 0) return "未定价";
  if (product.maxPriceCents > product.minPriceCents) {
    return `${formatter.format(product.minPriceCents / 100)} - ${formatter.format(product.maxPriceCents / 100)}`;
  }
  return formatter.format(product.minPriceCents / 100);
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value));
}

"use client";

import { Heart } from "lucide-react";
import { useState } from "react";

type FavoriteButtonProps = {
  className?: string;
  initialFavorited?: boolean;
  productName: string;
  productSlug: string;
  showLabel?: boolean;
};

export function FavoriteButton({
  className = "",
  initialFavorited = false,
  productName,
  productSlug,
  showLabel = false,
}: FavoriteButtonProps) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function toggleFavorite() {
    setSubmitting(true);
    setMessage("");
    const response = await fetch(favorited ? `/api/account/favorites/${encodeURIComponent(productSlug)}` : "/api/account/favorites", {
      method: favorited ? "DELETE" : "POST",
      credentials: "same-origin",
      headers: favorited ? undefined : { "Content-Type": "application/json" },
      body: favorited ? undefined : JSON.stringify({ productSlug }),
    });
    const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setSubmitting(false);

    if (response.status === 401 || payload.error === "AUTH_REQUIRED") {
      window.location.href = `/auth/login?next=${encodeURIComponent(window.location.pathname)}`;
      return;
    }

    if (!response.ok || !payload.ok) {
      setMessage(formatFavoriteError(payload.error));
      return;
    }

    setFavorited((value) => !value);
    setMessage(favorited ? "已取消收藏" : "已加入收藏");
  }

  return (
    <span className={`inline-grid gap-1 ${className}`}>
      <button
        aria-label={`${favorited ? "取消收藏" : "收藏"} ${productName}`}
        className={`vk-focus-ring inline-flex h-10 items-center justify-center gap-2 rounded-full border px-3 text-sm font-black transition ${
          favorited ? "border-brand bg-[#eef4ff] text-brand" : "border-line bg-white text-[#344054] hover:border-brand hover:text-brand"
        }`}
        disabled={submitting}
        onClick={toggleFavorite}
        type="button"
      >
        <Heart className={`h-4 w-4 ${favorited ? "fill-current" : ""}`} />
        {showLabel ? <span>{favorited ? "已收藏" : "收藏"}</span> : null}
      </button>
      {showLabel && message ? <span className="text-xs font-bold text-muted">{message}</span> : null}
    </span>
  );
}

function formatFavoriteError(error: string | undefined) {
  const messages: Record<string, string> = {
    INVALID_FAVORITE_REQUEST: "收藏请求不完整。",
    PRODUCT_NOT_FOUND: "商品不存在或暂不可收藏。",
  };
  return error ? messages[error] ?? error : "收藏操作失败。";
}

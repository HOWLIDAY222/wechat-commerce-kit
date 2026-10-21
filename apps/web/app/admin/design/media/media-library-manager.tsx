"use client";

import Image from "next/image";
import { Archive, ImagePlus, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type Asset = {
  id: string;
  name: string;
  url: string;
  altText: string | null;
  mimeType: string;
  sizeBytes: number;
  status: "ACTIVE" | "ARCHIVED";
  createdAt: string;
  updatedAt: string;
};

export function MediaLibraryManager({ assets }: { assets: Asset[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"ACTIVE" | "ARCHIVED">("ACTIVE");
  const [message, setMessage] = useState("支持 JPG、PNG、WebP、AVIF，单张不超过 8MB。");
  const [busy, setBusy] = useState(false);
  const visibleAssets = assets.filter((asset) => asset.status === filter);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("正在上传素材...");
    const response = await fetch("/api/admin/design/media", { method: "POST", body: new FormData(event.currentTarget) });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok || !result.ok) {
      setMessage(getErrorMessage(result.error));
      return;
    }
    setMessage("素材已上传，可在页面装修和商品图片中选择。");
    event.currentTarget.reset();
    router.refresh();
  }

  async function updateAsset(asset: Asset, action: "archive" | "restore") {
    if (action === "archive" && !window.confirm(`归档素材“${asset.name}”？已发布页面仍会保留该图片，但新编辑时不可再选择。`)) return;
    setBusy(true);
    const response = await fetch(`/api/admin/design/media/${encodeURIComponent(asset.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(false);
    setMessage(response.ok && result.ok ? (action === "archive" ? "素材已归档。" : "素材已恢复。") : getErrorMessage(result.error));
    if (response.ok && result.ok) router.refresh();
  }

  return (
    <div className="grid gap-5">
      <form className="grid gap-4 border border-[#d8dde5] bg-white p-5 lg:grid-cols-[1fr_1fr_1.2fr_auto] lg:items-end" onSubmit={upload}>
        <label className="vk-field"><span>素材名称</span><input maxLength={120} name="name" placeholder="例如：首页夏季主图" /></label>
        <label className="vk-field"><span>图片说明</span><input maxLength={200} name="altText" placeholder="描述图片内容" /></label>
        <label className="vk-field"><span>选择图片</span><input accept="image/jpeg,image/png,image/webp,image/avif" name="file" required type="file" /></label>
        <button className="vk-button vk-button-dark gap-2" disabled={busy} type="submit"><ImagePlus className="h-4 w-4" />{busy ? "处理中" : "上传素材"}</button>
        <p className="text-xs font-bold text-[#697386] lg:col-span-full" role="status">{message}</p>
      </form>

      <section className="border border-[#d8dde5] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e4e7ec] px-5 py-4">
          <div><h2 className="text-lg font-black">图片素材</h2><p className="mt-1 text-xs font-bold text-[#697386]">共 {assets.length} 项</p></div>
          <div className="flex rounded-[8px] bg-[#f2f4f7] p-1">
            <button className={filter === "ACTIVE" ? "rounded-[6px] bg-white px-4 py-2 text-xs font-black shadow-sm" : "px-4 py-2 text-xs font-bold text-[#667085]"} onClick={() => setFilter("ACTIVE")} type="button">可用</button>
            <button className={filter === "ARCHIVED" ? "rounded-[6px] bg-white px-4 py-2 text-xs font-black shadow-sm" : "px-4 py-2 text-xs font-bold text-[#667085]"} onClick={() => setFilter("ARCHIVED")} type="button">已归档</button>
          </div>
        </div>
        <div className="grid gap-px bg-[#e4e7ec] sm:grid-cols-2 xl:grid-cols-4">
          {visibleAssets.map((asset) => (
            <article className="min-w-0 bg-white p-4" key={asset.id}>
              <div className="relative aspect-[4/3] overflow-hidden bg-[#f2f4f7]">
                <Image alt={asset.altText || asset.name} className="object-contain" fill sizes="(max-width: 640px) 100vw, 25vw" src={asset.url} />
              </div>
              <h3 className="mt-3 truncate text-sm font-black" title={asset.name}>{asset.name}</h3>
              <p className="mt-1 truncate text-xs font-bold text-[#697386]" title={asset.altText ?? ""}>{asset.altText || "未填写图片说明"}</p>
              <p className="mt-2 text-[11px] font-bold text-[#98a2b3]">{asset.sizeBytes ? formatBytes(asset.sizeBytes) : "内置素材"} · {asset.mimeType.replace("image/", "").toUpperCase()}</p>
              <button className="vk-button vk-button-light mt-3 w-full gap-2" disabled={busy} onClick={() => updateAsset(asset, asset.status === "ACTIVE" ? "archive" : "restore")} type="button">
                {asset.status === "ACTIVE" ? <Archive className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                {asset.status === "ACTIVE" ? "归档" : "恢复"}
              </button>
            </article>
          ))}
          {!visibleAssets.length ? <p className="bg-white px-5 py-12 text-sm font-bold text-[#697386] sm:col-span-2 xl:col-span-4">当前分类没有素材。</p> : null}
        </div>
      </section>
    </div>
  );
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function getErrorMessage(code?: string) {
  const messages: Record<string, string> = {
    ADMIN_UNAUTHORIZED: "后台登录已失效，请重新登录。",
    MEDIA_FILE_REQUIRED: "请选择要上传的图片。",
    MEDIA_TYPE_NOT_SUPPORTED: "仅支持 JPG、PNG、WebP 和 AVIF。",
    MEDIA_FILE_TOO_LARGE: "图片不能超过 8MB。",
  };
  return messages[code ?? ""] ?? "操作失败，请稍后重试。";
}

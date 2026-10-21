import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { listMediaAssets } from "@/lib/services/site-builder-service";
import { MediaLibraryManager } from "./media-library-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "素材库 | MerchantKit 后台" };

export default async function MediaLibraryPage() {
  const assets = await listMediaAssets({ includeArchived: true });
  const activeAssets = assets.filter((asset) => asset.status === "ACTIVE");
  return (
    <AdminFrame active="design-media" metrics={[
      { label: "可用素材", value: activeAssets.length.toString(), hint: "页面和商品选择范围" },
      { label: "已归档", value: (assets.length - activeAssets.length).toString(), hint: "不会出现在新选择中" },
    ]} title="素材库" subtitle="统一管理网站与商品图片。上传一次后从素材库选择，不再手填图片路径。">
      <MediaLibraryManager assets={assets.map((asset) => ({ ...asset, createdAt: asset.createdAt.toISOString(), updatedAt: asset.updatedAt.toISOString() }))} />
    </AdminFrame>
  );
}

import { notFound } from "next/navigation";
import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { fetchAdminJson } from "@/app/admin/_lib/admin-page-fetch";
import { ProductImageManager } from "@/app/admin/products/product-workflow-forms";
import { formatStatusLabel } from "@/lib/display-labels";
import { listMediaAssets } from "@/lib/services/site-builder-service";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "图片管理 | MerchantKit Admin",
  description: "MerchantKit 后台商品图片管理入口，用于上传产品图、排序、设置主图和删除错误图片。",
};

type PageProps = {
  params: Promise<{ productId: string }>;
};

type AdminSku = {
  id: string;
  skuCode: string;
  color: string;
  size: string;
  priceCents: number;
  stockQuantity: number;
  reservedQuantity: number;
  status: string;
};

type AdminProduct = {
  id: string;
  slug: string;
  code: string;
  name: string;
  image?: string | null;
  category: string;
  scene?: string | null;
  summary: string;
  description?: string | null;
  status: string;
  sortOrder: number;
  skus: AdminSku[];
  images?: {
    id?: string;
    imageUrl?: string;
    alt?: string | null;
    sortOrder?: number;
  }[];
};

type ProductsResponse = {
  ok: boolean;
  products: AdminProduct[];
};

export default async function AdminProductImagesPage({ params }: PageProps) {
  const { productId } = await params;
  const [{ products }, assets] = await Promise.all([
    fetchAdminJson<ProductsResponse>("/api/admin/products"),
    listMediaAssets(),
  ]);
  const product = products.find((item) => item.id === productId || item.slug === productId || item.code === productId);
  if (!product) notFound();

  const frameMetrics = [
    { label: "图片", value: String(product.images?.length ?? 0) },
    { label: "SKU", value: String(product.skus.length) },
    { label: "状态", value: formatStatusLabel(product.status) },
    { label: "商品", value: product.code },
  ];

  return (
    <AdminFrame active="products" metrics={frameMetrics} title="图片管理" subtitle="上传、排序、设主图和删除错误图片集中在这里处理。">
      <section className="border border-[#d8dde5] bg-white px-4 py-4">
        <p className="text-xs font-black text-[#697386]">商品图片</p>
        <h1 className="mt-1 text-2xl font-black">{product.name}</h1>
        <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-[#697386]">
          第 1 张用于商品列表默认陈列图；第 2–9 张同时组成首页当前预售轮播；全部图片按当前顺序进入商品详情。上传、排序、设主图或删除后，前台直接读取这里的结果。
        </p>
      </section>
      <ProductImageManager assets={assets.map((asset) => ({ id: asset.id, name: asset.name, url: asset.url, altText: asset.altText }))} product={product} />
    </AdminFrame>
  );
}

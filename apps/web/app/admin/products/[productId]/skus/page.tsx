import { ProductPricingForm } from "@/app/admin/products/pricing-form";
import { notFound } from "next/navigation";
import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { fetchAdminJson } from "@/app/admin/_lib/admin-page-fetch";
import { ProductSkuManager } from "@/app/admin/products/product-workflow-forms";
import { formatStatusLabel } from "@/lib/display-labels";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "维护 SKU | MerchantKit Admin",
  description: "MerchantKit 后台商品 SKU 维护入口，集中处理颜色尺码、售价和库存。",
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
  quantityPricing?: unknown;
  id: string;
  slug: string;
  code: string;
  name: string;
  image?: string | null;
  category: string;
  scene?: string | null;
  summary: string;
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

export default async function AdminProductSkusPage({ params }: PageProps) {
  const { productId } = await params;
  const { products } = await fetchAdminJson<ProductsResponse>("/api/admin/products");
  const product = products.find((item) => item.id === productId || item.slug === productId || item.code === productId);
  if (!product) notFound();
  const stock = product.skus.reduce(
    (summary, sku) => {
      summary.total += sku.stockQuantity;
      summary.reserved += sku.reservedQuantity;
      if(sku.status === "ACTIVE") summary.available += Math.max(0, sku.stockQuantity - sku.reservedQuantity);
      return summary;
    },
    { available: 0, reserved: 0, total: 0 },
  );
  const frameMetrics = [
    { label: "SKU", value: product.skus.length.toString() },
    { label: "可售库存", value: stock.available.toString() },
    { label: "锁定库存", value: stock.reserved.toString() },
    { label: "商品状态", value: formatStatusLabel(product.status) },
  ];

  return (
    <AdminFrame active="products" metrics={frameMetrics} title="维护 SKU" subtitle="款式价格在上方维护；下方 SKU 按尺码管理共用库存。">
      <section className="border border-[#d8dde5] bg-white px-4 py-4">
        <p className="text-xs font-black text-[#697386]">商品 SKU</p>
        <h1 className="mt-1 text-2xl font-black">{product.name}</h1>
        <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-[#697386]">
          {product.code} / {product.category} / {formatStatusLabel(product.status)}。选择具体 SKU 后可以调整销售价格或库存。
        </p>
      </section>
      <ProductPricingForm product={product} />
      <ProductSkuManager product={toProductOption(product)} />
    </AdminFrame>
  );
}

function toProductOption(product: AdminProduct) {
  return {
    id: product.id,
    code: product.code,
    name: product.name,
    image: product.image,
    category: product.category,
    scene: product.scene,
    summary: product.summary,
    status: product.status,
    sortOrder: product.sortOrder,
    images: product.images,
    skus: product.skus.map((sku) => ({
      id: sku.id,
      skuCode: sku.skuCode,
      color: sku.color,
      size: sku.size,
      priceCents: sku.priceCents,
      stockQuantity: sku.stockQuantity,
      reservedQuantity: sku.reservedQuantity,
      status: sku.status,
    })),
  };
}

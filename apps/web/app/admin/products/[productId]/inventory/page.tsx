import { notFound } from "next/navigation";
import Link from "next/link";
import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { fetchAdminJson } from "@/app/admin/_lib/admin-page-fetch";
import { ProductInventoryAdjust } from "@/app/admin/products/product-workflow-forms";
import { formatStatusLabel } from "@/lib/display-labels";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "库存调整 | MerchantKit Admin",
  description: "MerchantKit 后台商品库存调整入口，用于到货入库和盘点修正。",
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
  images?: Array<{
    id?: string;
    imageUrl?: string;
    alt?: string | null;
    sortOrder?: number;
  }>;
};

type ProductsResponse = {
  ok: boolean;
  products: AdminProduct[];
};

export default async function AdminProductInventoryPage({ params }: PageProps) {
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
    { label: "SKU", value: String(product.skus.length) },
    { label: "总库存", value: String(stock.total) },
    { label: "锁定", value: String(stock.reserved) },
    { label: "可售", value: String(stock.available) },
  ];

  return (
    <AdminFrame active="products" metrics={frameMetrics} title="库存调整" subtitle="库存只能通过到货入库或盘点修正动作变更，并记录流水。">
      <section className="border border-[#d8dde5] bg-white px-4 py-4">
        <p className="text-xs font-black text-[#697386]">商品库存</p>
        <h1 className="mt-1 text-2xl font-black">{product.name}</h1>
        <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-[#697386]">
          {product.code} / {product.category} / {formatStatusLabel(product.status)}。价格和 SKU 状态不在库存页面修改。
        </p>
      </section>
      <ProductInventoryAdjust product={product} />
      <section className="mt-4 rounded border bg-white p-5"><h2 className="font-black">真实库存流水</h2><p className="my-3">隐藏规格库存 {product.skus.filter(s=>s.status!=="ACTIVE").reduce((n,s)=>n+s.stockQuantity,0)}；在售可用 {stock.available}；订单锁定 {stock.reserved}。</p><Link className="vk-button vk-button-dark" href={'/admin/inventory/logs?productId='+encodeURIComponent(product.id)}>查看此商品流水与操作者</Link></section>
    </AdminFrame>
  );
}

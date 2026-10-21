import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { fetchAdminJson } from "@/app/admin/_lib/admin-page-fetch";
import { ProductAdminTable } from "@/app/admin/products/product-admin-table";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "商品管理 | MerchantKit Admin",
  description: "MerchantKit 后台商品管理，维护商品、SKU、售价、库存和上下架状态。",
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
  createdAt?: string;
  updatedAt?: string;
};

type AdminProductImage = {
  id?: string;
  imageUrl?: string;
  alt?: string | null;
  sortOrder?: number;
};

type AdminProduct = {
  id: string;
  slug: string;
  code: string;
  name: string;
  category: string;
  scene?: string | null;
  summary: string;
  description?: string | null;
  image?: string | null;
  status: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  skus: AdminSku[];
  images?: AdminProductImage[];
};

type ProductsResponse = {
  ok: boolean;
  products: AdminProduct[];
  audit: {
    actorId: string;
    action: string;
    createdAt: string;
  };
};

export default async function AdminProductsPage() {
  const { products } = await fetchAdminJson<ProductsResponse>("/api/admin/products");
  const skuCount = products.reduce((sum, product) => sum + product.skus.length, 0);
  const activeProductCount = products.filter((product) => product.status === "ACTIVE").length;
  const availableStock = products.reduce((sum, product) => {
    return sum + (product.status === "ACTIVE" ? product.skus.reduce((skuSum, sku) => skuSum + getAvailableStock(sku), 0) : 0);
  }, 0);
  const lowStockCount = products.reduce((sum, product) => {
    return sum + (product.status === "ACTIVE" ? product.skus.filter((sku) => sku.status === "ACTIVE" && getAvailableStock(sku) <= 5).length : 0);
  }, 0);
  const frameMetrics = [
    { label: "在售商品数", value: activeProductCount.toString(), hint: `全部商品 ${products.length}`, tone: "blue" as const },
    { label: "草稿数", value: products.filter((product) => product.status === "HIDDEN").length.toString(), hint: "未展示到商城", tone: "green" as const },
    { label: "低库存 SKU", value: lowStockCount.toString(), hint: "可用库存不高于 5", tone: "orange" as const },
    { label: "SKU 总数", value: skuCount.toString(), hint: `可售库存 ${availableStock}`, tone: "purple" as const },
  ];

  return (
    <AdminFrame
      active="products"
      metrics={frameMetrics}
      title="商品管理"
      subtitle="按状态管理商品，快速处理上下架、改价和改库存。"
    >
      <ProductAdminTable heading="商品列表" products={products} />
    </AdminFrame>
  );
}

function getAvailableStock(sku: AdminSku) {
  return sku.status === "ACTIVE" ? Math.max(0, sku.stockQuantity - sku.reservedQuantity) : 0;
}

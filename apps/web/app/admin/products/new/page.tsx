import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { fetchAdminJson } from "@/app/admin/_lib/admin-page-fetch";
import { ProductCreateForm } from "./product-create-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "创建商品 | MerchantKit Admin",
  description: "MerchantKit 后台商品创建入口，按主图、标题、类目、规格、价格、库存、详情和配送售后分区处理。",
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
  code: string;
  name: string;
  image?: string | null;
  category: string;
  scene?: string | null;
  summary: string;
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

export default async function AdminNewProductPage() {
  const { products } = await fetchAdminJson<ProductsResponse>("/api/admin/products");
  const draftCount = products.filter((product) => product.status === "HIDDEN").length;
  const frameMetrics = [
    { label: "新建后状态", value: "草稿", hint: "资料完整后再上架", tone: "green" as const },
    { label: "在售商品", value: products.filter((product) => product.status === "ACTIVE").length.toString(), hint: "创建后可继续维护", tone: "blue" as const },
    { label: "SKU 总数", value: products.reduce((sum, product) => sum + product.skus.length, 0).toString(), hint: "价格库存走 SKU 页", tone: "purple" as const },
    { label: "现有草稿", value: draftCount.toString(), hint: "未发布到前台", tone: "orange" as const },
  ];

  return (
    <AdminFrame active="product-new" metrics={frameMetrics} title="创建商品" subtitle="新商品先保存为草稿，补齐图片、SKU、价格和库存并通过校验后再上架。">
      <ProductCreateForm />
    </AdminFrame>
  );
}

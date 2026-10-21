import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { fetchAdminJson } from "@/app/admin/_lib/admin-page-fetch";
import { ProductInfoForm, ProductReleaseForm } from "@/app/admin/products/product-workflow-forms";
import { formatStatusLabel } from "@/lib/display-labels";

type AdminProductDetailProps = {
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
  saleMode?: string;
  saleStartsAt?: string | null;
  estimatedShipAt?: string | null;
  countdownEnabled?: boolean;
  showPrice?: boolean;
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
  silhouette?: string | null;
  rise?: string | null;
  coverage?: string | null;
  supportLevel?: string | null;
  fabricComposition?: string | null;
  features?: string[];
  fitNote?: string | null;
  careInstructions?: string | null;
  packSize?: number | null;
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
};

export const dynamic = "force-dynamic";

export const metadata = {
  title: "商品详情 | MerchantKit Admin",
  description: "MerchantKit 后台商品详情页，用于核对商品基础信息、SKU 售价、库存和前台可见状态。",
};

export default async function AdminProductDetailPage({ params }: AdminProductDetailProps) {
  const { productId } = await params;
  const { products } = await fetchAdminJson<ProductsResponse>("/api/admin/products");
  const product = products.find((item) => item.id === productId || item.slug === productId || item.code === productId);
  if (!product) notFound();

  const stock = summarizeStock(product.status === "ACTIVE" ? product.skus : []);
  const frameMetrics = [
    { label: "SKU", value: product.skus.length.toString() },
    { label: "可售库存", value: stock.available.toString() },
    { label: "低库存", value: stock.lowStock.toString() },
    { label: "状态", value: formatStatusLabel(product.status) },
  ];

  return (
    <AdminFrame active="products" metrics={frameMetrics} title="商品详情" subtitle="先编辑资料或上下架，再核对规格、图片及操作记录。">
      <section className="border border-[#d8dde5] bg-white px-4 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <Link className="vk-admin-link" href="/admin/products">返回商品管理</Link>
            <h1 className="mt-3 text-2xl font-black">{product.name}</h1>
            <p className="mt-2 break-all text-xs font-bold text-[#697386]">
              {product.code} / {product.slug} / {product.id}
            </p>
          </div>
          <div className="flex flex-wrap gap-2"><Link className="vk-button vk-button-dark" href="#edit">编辑资料</Link><Link className="vk-button vk-button-light" href="#release">上下架</Link>
            <Link className="vk-button vk-button-light" href={`/products/${product.slug}`} target="_blank">
              查看前台页面
            </Link>
            <Link className="vk-button vk-button-dark" href={`/admin/products/${encodeURIComponent(product.id)}/skus`}>
              SKU / 调价
            </Link>
            <Link className="vk-button vk-button-light" href={`/admin/products/${encodeURIComponent(product.id)}/inventory`}>
              库存调整
            </Link>
            <Link className="vk-button vk-button-light" href={`/admin/products/${encodeURIComponent(product.id)}/images`}>
              图片管理
            </Link>
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]"><div id="edit" className="scroll-mt-24"><ProductInfoForm product={product}/></div><div id="release" className="scroll-mt-24"><ProductReleaseForm product={product}/></div></div>
        <div className="mt-5 grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <section className="rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4">
            <h2 className="text-base font-black">商品基础信息</h2>
            <dl className="mt-3 grid gap-3 text-xs font-bold">
              <Info label="分类" value={product.category} />
              <Info label="场景" value={product.scene ?? "未填写"} />
              <Info label="状态" value={formatStatusLabel(product.status)} />
              <Info label="排序" value={product.sortOrder.toString()} />
              <Info label="创建时间" value={formatDate(product.createdAt)} />
              <Info label="更新时间" value={formatDate(product.updatedAt)} />
              <Info label="主图" value={product.image ?? "未填写"} />
            </dl>
            <h3 className="mt-5 text-sm font-black">摘要</h3>
            <p className="mt-2 text-sm font-bold leading-6 text-[#697386]">{product.summary}</p>
            {product.description ? (
              <>
                <h3 className="mt-5 text-sm font-black">详情说明</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-6 text-[#697386]">{product.description}</p>
              </>
            ) : null}
          </section>

          <section className="rounded-[8px] border border-[#d8dde5] bg-white p-4">
            <h2 className="text-base font-black">SKU / 价格 / 库存</h2>
            <p className="mt-1 text-xs font-bold text-[#697386]">这里用于核对，不在详情页直接写入价格或库存，避免误点。</p>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-[820px] w-full text-left text-xs">
                <thead className="text-[#697386]">
                  <tr className="border-b border-[#d8dde5]">
                    <th className="py-2 pr-3">SKU 编码</th>
                    <th className="py-2 pr-3">颜色</th>
                    <th className="py-2 pr-3">尺码</th>
                    <th className="py-2 pr-3">售价</th>
                    <th className="py-2 pr-3">可售 / 锁定</th>
                    <th className="py-2 pr-3">状态</th>
                    <th className="py-2 pr-3">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e6eaf0]">
                  {product.skus.map((sku) => (
                    <tr key={sku.id}>
                      <td className="py-3 pr-3 break-all font-black">{sku.skuCode}</td>
                      <td className="py-3 pr-3 font-bold">{sku.color}</td>
                      <td className="py-3 pr-3 font-bold">{sku.size}</td>
                      <td className="py-3 pr-3 font-black">{formatMoney(sku.priceCents)}</td>
                      <td className="py-3 pr-3 font-bold">
                        {getAvailableStock(sku)} / {sku.reservedQuantity}
                      </td>
                      <td className="py-3 pr-3 font-bold">{formatStatusLabel(sku.status)}</td>
                      <td className="py-3 pr-3">
                        <Link
                          className="vk-admin-link"
                          href={`/admin/products/${encodeURIComponent(product.id)}/skus?skuId=${encodeURIComponent(sku.id)}`}
                        >
                          SKU / 调价
                        </Link>
                        <Link
                          className="vk-admin-link"
                          href={`/admin/products/${encodeURIComponent(product.id)}/inventory?skuId=${encodeURIComponent(sku.id)}`}
                        >
                          库存调整
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <section id="product-images" className="mt-4 rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4">
          <h2 className="text-base font-black">图片记录</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(product.images ?? []).map((image) => (
              image.imageUrl ? <a
                className="block rounded-[8px] border border-[#d8dde5] bg-white p-3"
                href={image.imageUrl}
                key={image.id ?? image.imageUrl}
                rel="noreferrer"
                target="_blank"
              >
                <Image
                  alt={image.alt ?? product.name}
                  className="aspect-[4/3] w-full rounded-[8px] object-cover"
                  height={240}
                  src={image.imageUrl}
                  width={320}
                />
                <p className="mt-2 break-all text-xs font-bold text-[#697386]">
                  {image.sortOrder ?? 0}. {image.imageUrl} {image.alt ? ` / ${image.alt}` : ""}
                </p>
              </a> : null
            ))}
            {!product.images?.length ? <p className="text-xs font-bold text-[#697386]">暂无详情图片记录。</p> : null}
          </div>
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <section className="rounded-[8px] border border-[#d8dde5] bg-white p-4">
            <h2 className="text-base font-black">状态区</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <StatusBlock label="商品状态" value={formatStatusLabel(product.status)} />
              <StatusBlock label="SKU 数" value={product.skus.length.toString()} />
              <StatusBlock label="图片数" value={(product.images?.length ?? 0).toString()} />
            </div>
            <h2 className="mt-5 text-base font-black">时间线</h2>
            <div className="mt-2 grid gap-2 text-xs font-bold text-[#697386]">
              <p>创建：{formatDate(product.createdAt)}</p>
              <p>更新：{formatDate(product.updatedAt)}</p>
            </div>
            <h2 className="mt-5 text-base font-black">审计日志</h2>
            <p className="mt-2 text-xs font-bold leading-5 text-[#697386]">
              商品创建、资料更新、SKU、图片和库存动作都由服务端写入审计日志；如需追溯操作人和 JSON 详情，请进入审计日志。
            </p>
            <Link className="vk-admin-link mt-3 w-fit" href={"/admin/audit?targetId="+encodeURIComponent(product.id)}>查看审计日志</Link>
          </section>
          <div className="grid content-start gap-4">
            <p className="text-sm text-[#697386]">资料与上下架操作位于页面顶部，可从商品列表直接进入对应操作。</p>
          </div>
        </div>
      </section>
    </AdminFrame>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-3">
      <dt className="text-[#697386]">{label}</dt>
      <dd className="break-all text-[#111827]">{value}</dd>
    </div>
  );
}

function StatusBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] bg-[#f8fafc] px-3 py-3">
      <p className="text-xs font-black text-[#697386]">{label}</p>
      <p className="mt-1 text-sm font-black">{value}</p>
    </div>
  );
}

function summarizeStock(skus: AdminSku[]) {
  return skus.reduce(
    (summary, sku) => {
      const available = getAvailableStock(sku);
      summary.available += available;
      summary.reserved += sku.reservedQuantity;
      if (sku.status === "ACTIVE" && available <= 5) summary.lowStock += 1;
      return summary;
    },
    { available: 0, reserved: 0, lowStock: 0 },
  );
}

function getAvailableStock(sku: AdminSku) {
  return sku.status === "ACTIVE" ? Math.max(0, sku.stockQuantity - sku.reservedQuantity) : 0;
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(cents / 100);
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

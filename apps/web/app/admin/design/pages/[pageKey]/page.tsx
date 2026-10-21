import { notFound, redirect } from "next/navigation";
import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { listAdminProducts } from "@/lib/services/admin-catalog-service";
import { getSiteBuilderPage, listMediaAssets, listSiteBuilderPages } from "@/lib/services/site-builder-service";
import { isActiveSaleProduct } from "@/lib/storefront-visibility";
import { SitePageComposer } from "./site-page-composer";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ pageKey: string }> };

export default async function SiteBuilderPage({ params }: PageProps) {
  const session = await readCurrentAdminSession();
  if (!session) redirect("/admin/login");
  const { pageKey } = await params;
  const [page, pages, assets, products] = await Promise.all([
    getSiteBuilderPage(pageKey),
    listSiteBuilderPages(),
    listMediaAssets(),
    listAdminProducts(),
  ]);
  if (!page || !page.draft) notFound();

  const active = page.kind === "HEADER" ? "design-navigation" : page.kind === "FOOTER" ? "design-footer" : "design-pages";
  const versions = page.versions.map((version) => ({
    ...version,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
    publishedAt: version.publishedAt?.toISOString() ?? null,
  }));

  return (
    <AdminFrame active={active} metrics={[
      { label: "当前草稿", value: `v${page.draft.versionNumber}`, hint: "保存不会自动影响前台" },
      { label: "线上版本", value: page.published ? `v${page.published.versionNumber}` : "未发布", hint: page.published?.publishedAt ? formatDate(page.published.publishedAt) : "等待首次发布" },
      { label: "历史版本", value: page.versions.filter((version) => version.status !== "DRAFT").length.toString(), hint: "可恢复到草稿后再次预览" },
    ]} title={page.name} subtitle="在画布中选择板块，再修改右侧属性。所有链接从已有页面选择，图片从素材库选择，推荐商品关联真实商品。">
      <SitePageComposer
        assets={assets.map((asset) => ({ id: asset.id, name: asset.name, url: asset.url, altText: asset.altText }))}
        page={{ id: page.id, key: page.key, name: page.name, path: page.path, kind: page.kind, template: page.template, draft: { ...page.draft, createdAt: page.draft.createdAt.toISOString(), updatedAt: page.draft.updatedAt.toISOString(), publishedAt: page.draft.publishedAt?.toISOString() ?? null }, versions }}
        pages={pages.map((item) => ({ key: item.key, name: item.name, path: item.path, kind: item.kind }))}
        products={products.filter(isActiveSaleProduct).map((product) => ({
          id: product.id,
          code: product.code,
          name: product.name,
          image: product.image ?? null,
          images: product.images.map((image) => image.imageUrl),
          saleMode: product.saleMode ?? null,
          status: product.status,
          skus: product.skus.map((sku) => ({ id: sku.id, priceCents: sku.priceCents, stockQuantity: sku.stockQuantity, reservedQuantity: sku.reservedQuantity, status: sku.status })),
        }))}
      />
    </AdminFrame>
  );
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(value);
}

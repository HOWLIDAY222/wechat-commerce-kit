"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Download, ExternalLink, Eye, EyeOff, Filter, PlusCircle, Search } from "lucide-react";
import { formatAdminActionError } from "@/lib/client/admin-error-message";
import { exportRowsAsCsv, getPageCount, getPageItems } from "@/lib/client/admin-table-actions";
import { formatStatusLabel } from "@/lib/display-labels";

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
  image?: string | null;
  status: string;
  sortOrder: number;
  updatedAt: string;
  skus: AdminSku[];
  images?: AdminProductImage[];
};

type ProductTab = "ALL" | "ACTIVE" | "HIDDEN" | "LOW_STOCK" | "INCOMPLETE";
type SortMode = "LATEST" | "STOCK_ASC" | "PRICE_ASC" | "PRICE_DESC";
type BatchTargetStatus = "ACTIVE" | "HIDDEN";

export function ProductAdminTable({ heading, products }: { heading: string; products: AdminProduct[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<ProductTab>("ALL");
  const [category, setCategory] = useState("ALL");
  const [sortMode, setSortMode] = useState<SortMode>("LATEST");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchBusy, setBatchBusy] = useState<BatchTargetStatus | null>(null);
  const [batchMessage, setBatchMessage] = useState("选择商品后可批量上架或下架；每件商品都会单独校验并写入审计日志。");
  const categories = useMemo(() => Array.from(new Set(products.map((product) => product.category))).sort(), [products]);
  const tabItems = useMemo(() => buildTabs(products), [products]);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return products
      .filter((product) => {
        if (tab === "LOW_STOCK" && !product.skus.some((sku) => sku.status === "ACTIVE" && getAvailableStock(sku) <= 5)) return false;
        if (tab === "INCOMPLETE" && !isProductIncomplete(product)) return false;
        if (!["ALL", "LOW_STOCK", "INCOMPLETE"].includes(tab) && product.status !== tab) return false;
        if (category !== "ALL" && product.category !== category) return false;
        if (!normalizedQuery) return true;
        const text = [
          product.name,
          product.code,
          product.slug,
          product.category,
          product.scene ?? "",
          product.summary,
          ...product.skus.flatMap((sku) => [sku.skuCode, sku.color, sku.size]),
        ]
          .join(" ")
          .toLowerCase();
        return text.includes(normalizedQuery);
      })
      .sort((a, b) => sortProducts(a, b, sortMode));
  }, [category, products, query, sortMode, tab]);

  const pageCount = getPageCount(filteredProducts.length);
  const currentPage = Math.min(page, pageCount);
  const visibleProducts = useMemo(() => getPageItems(filteredProducts, currentPage), [currentPage, filteredProducts]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected = visibleProducts.length > 0 && visibleProducts.every((product) => selectedIdSet.has(product.id));
  const reminders = useMemo(() => buildReminders(products), [products]);
  const analysis = useMemo(() => buildAnalysis(products), [products]);

  function resetFilters() {
    setQuery("");
    setTab("ALL");
    setCategory("ALL");
    setSortMode("LATEST");
    setPage(1);
  }

  function exportProducts() {
    exportRowsAsCsv("merchantkit-products.csv", filteredProducts, [
      { header: "商品名称", value: (product) => product.name },
      { header: "商品编码", value: (product) => product.code },
      { header: "分类", value: (product) => product.category },
      { header: "状态", value: (product) => formatStatusLabel(product.status) },
      { header: "最低售价", value: (product) => (getLowestPrice(product.skus) ?? 0) / 100 },
      { header: "可售库存", value: (product) => summarizeStock(product.skus).available },
      { header: "SKU数量", value: (product) => product.skus.length },
    ]);
  }

  function toggleProduct(productId: string, checked: boolean) {
    setSelectedIds((current) => checked ? Array.from(new Set([...current, productId])) : current.filter((id) => id !== productId));
  }

  function toggleVisibleProducts(checked: boolean) {
    const visibleIds = new Set(visibleProducts.map((product) => product.id));
    setSelectedIds((current) => checked
      ? Array.from(new Set([...current, ...visibleIds]))
      : current.filter((id) => !visibleIds.has(id)));
  }

  async function updateSelectedStatus(targetStatus: BatchTargetStatus) {
    const selectedProducts = products.filter((product) => selectedIdSet.has(product.id));
    const targets = selectedProducts.filter((product) => product.status !== targetStatus);
    const skipped = selectedProducts.length - targets.length;
    if (!targets.length) {
      setBatchMessage(`所选商品已经全部是${targetStatus === "ACTIVE" ? "在售" : "未上架"}状态，无需重复操作。`);
      return;
    }
    const actionLabel = targetStatus === "ACTIVE" ? "批量上架" : "批量下架";
    if (!window.confirm(`${actionLabel} ${targets.length} 件商品？系统会逐件校验并记录操作，失败项不会影响已成功项。`)) return;

    setBatchBusy(targetStatus);
    setBatchMessage(`正在${actionLabel}，请勿重复提交...`);
    const results = await Promise.all(targets.map(async (product) => {
      try {
        const response = await fetch(`/api/admin/products/${encodeURIComponent(product.id)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: targetStatus }),
        });
        const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        return response.ok && result.ok
          ? { id: product.id, ok: true as const, message: "" }
          : { id: product.id, ok: false as const, message: formatAdminActionError(result.error, response.status, `${product.name}状态更新`) };
      } catch {
        return { id: product.id, ok: false as const, message: `${product.name}网络请求失败，请稍后重试。` };
      }
    }));
    const failed = results.filter((result) => !result.ok);
    const succeeded = results.length - failed.length;
    setSelectedIds(failed.map((result) => result.id));
    setBatchBusy(null);
    const details = Array.from(new Set(failed.map((result) => result.message))).slice(0, 2).join("；");
    setBatchMessage(`${actionLabel}完成：成功 ${succeeded} 件，跳过 ${skipped} 件，失败 ${failed.length} 件。${failed.length ? `失败项已保留选择，可修正后重试。${details}` : ""}`);
    if (succeeded > 0) router.refresh();
  }

  return (
    <section className="mt-5 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_250px]">
      <div className="min-w-0 overflow-hidden rounded-[8px] border border-[#e4e7ec] bg-white shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
        <div className="border-b border-[#eef1f5] px-4 py-4">
          <div className="flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
            <div>
              <h2 className="text-lg font-black text-[#101828]">{heading}</h2>
              <p className="mt-1 text-xs font-bold text-[#697386]">按状态管理商品，快速处理上下架、改价和改库存。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[#d8dde5] bg-white px-3 text-sm font-black text-[#344054]" onClick={resetFilters} type="button">
                <Filter className="h-4 w-4" />
                清空筛选
              </button>
              <button className="inline-flex h-10 items-center gap-2 rounded-[8px] border border-[#d8dde5] bg-white px-3 text-sm font-black text-[#344054]" onClick={exportProducts} type="button">
                <Download className="h-4 w-4" />
                导出
              </button>
              <Link className="inline-flex h-10 items-center gap-2 rounded-[8px] bg-[#155eef] px-4 text-sm font-black text-white" href="/admin/products/new">
                <PlusCircle className="h-4 w-4" />
                创建商品
              </Link>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(260px,1fr)_minmax(420px,1.2fr)] lg:items-center">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#667085]" />
              <input
                className="vk-admin-filter h-11 pl-9"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="搜索商品名称、编码、条形码、SPU、SKU"
                type="search"
                value={query}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {tabItems.map((item) => (
                <button
                  className={
                    tab === item.key
                      ? "min-w-fit rounded-[8px] bg-[#eef4ff] px-4 py-2.5 text-sm font-black text-[#155eef] ring-1 ring-[#d6e4ff]"
                      : "min-w-fit rounded-[8px] px-4 py-2.5 text-sm font-black text-[#344054] hover:bg-[#f8fafc]"
                  }
                  key={item.key}
                  onClick={() => {
                    setTab(item.key);
                    setPage(1);
                  }}
                  type="button"
                >
                  {item.label} <span className="ml-1 text-[#667085]">{item.count}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-[160px_170px_170px]">
            <select className="vk-admin-filter h-10" onChange={(event) => {
              setCategory(event.target.value);
              setPage(1);
            }} value={category}>
              <option value="ALL">全部类目</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select className="vk-admin-filter h-10" onChange={(event) => {
              setSortMode(event.target.value as SortMode);
              setPage(1);
            }} value={sortMode}>
              <option value="LATEST">默认排序</option>
              <option value="STOCK_ASC">库存少在前</option>
              <option value="PRICE_ASC">价格低在前</option>
              <option value="PRICE_DESC">价格高在前</option>
            </select>
            <button className="h-10 rounded-[8px] border border-[#d8dde5] bg-white px-3 text-sm font-black text-[#344054]" onClick={() => {
              setTab("LOW_STOCK");
              setPage(1);
            }} type="button">
              快速筛选：低库存
            </button>
          </div>
          <div className="mt-4 flex flex-col gap-3 rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] px-3 py-3 lg:flex-row lg:items-center lg:justify-between" aria-live="polite">
            <p className="text-xs font-bold leading-5 text-[#667085]">
              {selectedIds.length ? `已选择 ${selectedIds.length} 件商品。${batchMessage}` : batchMessage}
            </p>
            <div className="flex flex-wrap gap-2">
              <button className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[#d8dde5] bg-white px-3 text-xs font-black text-[#344054] disabled:opacity-50" disabled={!selectedIds.length || batchBusy !== null} onClick={() => updateSelectedStatus("ACTIVE")} type="button">
                <Eye className="h-4 w-4" />{batchBusy === "ACTIVE" ? "处理中" : "批量上架"}
              </button>
              <button className="inline-flex h-9 items-center gap-2 rounded-[8px] border border-[#d8dde5] bg-white px-3 text-xs font-black text-[#344054] disabled:opacity-50" disabled={!selectedIds.length || batchBusy !== null} onClick={() => updateSelectedStatus("HIDDEN")} type="button">
                <EyeOff className="h-4 w-4" />{batchBusy === "HIDDEN" ? "处理中" : "批量下架"}
              </button>
              <button className="h-9 rounded-[8px] px-3 text-xs font-black text-[#667085] disabled:opacity-50" disabled={!selectedIds.length || batchBusy !== null} onClick={() => setSelectedIds([])} type="button">清除选择</button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left text-xs">
            <thead className="bg-[#f8fafc] text-[#667085]">
              <tr className="border-b border-[#eef1f5]">
                <th className="w-12 px-4 py-3">
                  <input aria-label="选择当前页商品" checked={allVisibleSelected} disabled={!visibleProducts.length || batchBusy !== null} onChange={(event) => toggleVisibleProducts(event.target.checked)} title="选择当前页商品" type="checkbox" />
                </th>
                <Th>商品信息</Th>
                <Th>商品编码</Th>
                <Th>分类</Th>
                <Th>售价</Th>
                <Th>库存</Th>
                <Th>状态</Th>
                <Th>下一步</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef1f5]">
              {visibleProducts.map((product) => (
                <ProductRow busy={batchBusy !== null} key={product.id} onSelect={(checked) => toggleProduct(product.id, checked)} product={product} selected={selectedIdSet.has(product.id)} />
              ))}
              {filteredProducts.length === 0 ? (
                <tr>
                  <td className="px-4 py-10 text-sm font-bold text-[#697386]" colSpan={8}>
                    没有匹配的商品，请调整搜索、状态或类目。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-[#eef1f5] px-4 py-3 text-xs font-bold text-[#697386] md:flex-row md:items-center md:justify-between">
          <span>共 {filteredProducts.length} / {products.length} 条</span>
          <div className="flex items-center gap-2">
            <button className="h-8 rounded-[8px] border border-[#d8dde5] px-3 disabled:cursor-not-allowed disabled:opacity-50" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">上一页</button>
            <span className="flex h-8 min-w-12 items-center justify-center rounded-[8px] bg-[#155eef] px-2 font-black text-white">{currentPage}/{pageCount}</span>
            <button className="h-8 rounded-[8px] border border-[#d8dde5] px-3 disabled:cursor-not-allowed disabled:opacity-50" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">下一页</button>
          </div>
        </div>
      </div>

      <aside className="grid gap-4 2xl:sticky 2xl:top-[112px] 2xl:self-start">
        <section className="rounded-[8px] border border-[#e4e7ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
          <h3 className="text-base font-black text-[#101828]">待处理商品提醒</h3>
          <div className="mt-4 grid gap-3">
            {reminders.map((item) => (
              <button className="flex w-full items-center justify-between gap-3 rounded-[8px] border border-[#eef1f5] px-3 py-3 text-left hover:bg-[#f8fafc]" key={item.label} onClick={() => {
                setTab(item.tab);
                setPage(1);
              }} type="button">
                <span>
                  <span className="block text-sm font-black text-[#344054]">{item.label}</span>
                  <span className="mt-1 block text-xs font-bold text-[#697386]">{item.hint}</span>
                </span>
                <span className="rounded-[6px] bg-[#f2f4f7] px-2.5 py-1 text-xs font-black text-[#475467]">{item.count}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-[8px] border border-[#e4e7ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
          <h3 className="text-base font-black text-[#101828]">当前商品完整度</h3>
          <div className="mt-4 divide-y divide-[#eef1f5]">
            {analysis.map((item) => (
              <div className="flex items-center justify-between gap-3 py-2.5" key={item.label}>
                <span className="text-xs font-bold text-[#697386]">{item.label}</span>
                <span className="text-sm font-black text-[#101828]">{item.value}</span>
              </div>
            ))}
          </div>
        </section>

        <Link className="inline-flex h-12 items-center justify-center gap-2 rounded-[8px] bg-[#155eef] text-sm font-black text-white" href="/admin/products/new">
          <PlusCircle className="h-4 w-4" />
          创建商品
        </Link>
      </aside>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#d8dde5] bg-white/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-3xl grid-cols-[1fr_1fr_2fr] gap-2">
          <button className="vk-button vk-button-light min-h-12 px-3 text-sm" onClick={() => { setTab("LOW_STOCK"); setPage(1); }} type="button">库存</button>
          <button className="vk-button vk-button-light min-h-12 px-3 text-sm" onClick={() => {
            setTab("LOW_STOCK");
            setPage(1);
          }} type="button">低库存</button>
          <Link className="vk-button vk-button-dark min-h-12 px-3 text-sm" href="/admin/products/new">创建商品</Link>
        </div>
      </div>
    </section>
  );
}

function ProductRow({ busy, onSelect, product, selected }: { busy: boolean; onSelect: (checked: boolean) => void; product: AdminProduct; selected: boolean }) {
  const stock = summarizeStock(product.skus);
  const lowestPrice = getLowestPrice(product.skus);
  const imageUrl = getPrimaryImageUrl(product);
  const active = product.status === "ACTIVE";
  const nextAction = getProductNextAction(product, stock);

  return (
    <tr className={selected ? "bg-[#f5f8ff] shadow-[inset_3px_0_0_#155eef]" : "hover:bg-[#fbfcfd]"}>
      <td className="px-4 py-3">
        <input aria-label={`选择商品 ${product.name}`} checked={selected} disabled={busy} onChange={(event) => onSelect(event.target.checked)} type="checkbox" />
      </td>
      <td className="px-4 py-3">
        <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-3">
          <div className="relative h-14 w-14 overflow-hidden rounded-[8px] border border-[#e4e7ec] bg-[#f2f4f7]">
            {imageUrl ? (
              <Image alt={product.images?.[0]?.alt ?? product.name} className="object-cover" fill sizes="56px" src={imageUrl} unoptimized />
            ) : (
              <span className="flex h-full items-center justify-center text-[11px] font-black text-[#98a2b3]">无图</span>
            )}
          </div>
          <div className="min-w-0">
            <Link className="line-clamp-2 font-black leading-5 text-[#101828] hover:text-[#155eef]" href={`/admin/products/${encodeURIComponent(product.id)}`}>
              {product.name}
            </Link>
            <p className="mt-1 truncate font-bold text-[#98a2b3]">颜色/规格：{summarizeSkuSpec(product.skus)}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 font-bold text-[#344054]">{product.code}</td>
      <td className="px-4 py-3 font-bold text-[#344054]">{product.category}</td>
      <td className="px-4 py-3 font-black text-[#101828]">{lowestPrice != null ? formatMoney(lowestPrice) : "未定价"}</td>
      <td className="px-4 py-3">
        <div className="font-black text-[#101828]">{stock.available}</div>
        {stock.lowStock > 0 ? <StatusPill tone="red" value={`低库存 ${stock.lowStock}`} /> : <p className="mt-1 text-[11px] font-bold text-[#98a2b3]">锁定 {stock.reserved}</p>}
      </td>
      <td className="px-4 py-3">
        <StatusPill tone={active ? "green" : "slate"} value={active ? "在售" : formatStatusLabel(product.status)} />
      </td>
      <td className="px-4 py-3">
        <div className="grid gap-2">
          <ActionLink href={nextAction.href}>{nextAction.label}</ActionLink>{[{path:"#edit",label:"编辑资料"},{path:"/skus#pricing",label:"改价 / 组合优惠"},{path:"/inventory",label:"调库存"},{path:"/images",label:"图片"},{path:"#release",label:"上下架"}].map(a=><ActionLink key={a.path} href={`/admin/products/${encodeURIComponent(product.id)}${a.path}`}>{a.label}</ActionLink>)}
          <Link className="inline-flex w-fit items-center gap-1 whitespace-nowrap text-xs font-black text-[#667085] hover:text-[#155eef]" href={`/products/${product.slug}`} target="_blank">
            店铺预览
            <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>
      </td>
    </tr>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-black">{children}</th>;
}

function ActionLink({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <Link className="whitespace-nowrap text-xs font-black text-[#155eef] hover:underline" href={href}>
      {children}
    </Link>
  );
}

function StatusPill({ value, tone = "slate" }: { value: string; tone?: "green" | "orange" | "red" | "slate" }) {
  const className =
    tone === "green"
      ? "bg-[#ecfdf3] text-[#079455]"
      : tone === "orange"
        ? "bg-[#fff7ed] text-[#f97316]"
        : tone === "red"
          ? "bg-[#fff1f3] text-[#d92d20]"
          : "bg-[#f2f4f7] text-[#667085]";
  return <span className={`mt-1 inline-flex w-fit whitespace-nowrap rounded-[6px] px-2 py-1 text-[11px] font-black ${className}`}>{value}</span>;
}

function buildTabs(products: AdminProduct[]): Array<{ key: ProductTab; label: string; count: number }> {
  return [
    { key: "ALL", label: "全部", count: products.length },
    { key: "ACTIVE", label: "在售", count: products.filter((product) => product.status === "ACTIVE").length },
    { key: "HIDDEN", label: "未上架", count: products.filter((product) => product.status === "HIDDEN").length },
    { key: "LOW_STOCK", label: "低库存", count: products.filter((product) => product.skus.some((sku) => sku.status === "ACTIVE" && getAvailableStock(sku) <= 5)).length },
    { key: "INCOMPLETE", label: "待完善", count: products.filter(isProductIncomplete).length },
  ];
}

function buildReminders(products: AdminProduct[]) {
  const lowStock = products.filter((product) => product.skus.some((sku) => sku.status === "ACTIVE" && getAvailableStock(sku) <= 5)).length;
  const drafts = products.filter((product) => product.status === "HIDDEN").length;
  return [
    { label: "资料待完善", hint: "缺少主图、SKU 或有效售价", count: products.filter(isProductIncomplete).length, tab: "INCOMPLETE" as const },
    { label: "低库存商品", hint: "可售库存不高于 5 件", count: lowStock, tab: "LOW_STOCK" as const },
    { label: "未上架商品", hint: "补齐资料或确认下架原因后处理", count: drafts, tab: "HIDDEN" as const },
  ];
}

function buildAnalysis(products: AdminProduct[]) {
  const skuCount = products.reduce((sum, product) => sum + product.skus.length, 0);
  const activeCount = products.filter((product) => product.status === "ACTIVE").length;
  const imageReady = products.filter((product) => getPrimaryImageUrl(product)).length;
  const skuReady = products.filter((product) => product.skus.some((sku) => sku.priceCents > 0)).length;
  const stockReady = products.filter((product) => product.skus.some((sku) => getAvailableStock(sku) > 0)).length;
  return [
    { label: "商品总数", value: products.length.toString() },
    { label: "在售商品", value: `${activeCount}/${products.length}` },
    { label: "已配置 SKU", value: `${skuReady}/${products.length}` },
    { label: "SKU 总量", value: skuCount.toString() },
    { label: "有主图商品", value: `${imageReady}/${products.length}` },
    { label: "有可售库存", value: `${stockReady}/${products.length}` },
  ];
}

function getProductNextAction(product: AdminProduct, stock: ReturnType<typeof summarizeStock>) {
  const productId = encodeURIComponent(product.id);
  if (!getPrimaryImageUrl(product)) return { href: `/admin/products/${productId}/images`, label: "补充商品图片" };
  if (!product.skus.some((sku) => sku.priceCents > 0)) return { href: `/admin/products/${productId}/skus`, label: "补充 SKU 与价格" };
  if (stock.lowStock > 0) return { href: `/admin/products/${productId}/inventory`, label: "补充库存" };
  return { href: `/admin/products/${productId}`, label: "管理商品" };
}

function isProductIncomplete(product: AdminProduct) {
  return !getPrimaryImageUrl(product) || !product.skus.some((sku) => sku.priceCents > 0);
}

function sortProducts(a: AdminProduct, b: AdminProduct, sortMode: SortMode) {
  if (sortMode === "STOCK_ASC") return summarizeStock(a.skus).available - summarizeStock(b.skus).available;
  if (sortMode === "PRICE_ASC") return (getLowestPrice(a.skus) ?? Number.MAX_SAFE_INTEGER) - (getLowestPrice(b.skus) ?? Number.MAX_SAFE_INTEGER);
  if (sortMode === "PRICE_DESC") return (getLowestPrice(b.skus) ?? 0) - (getLowestPrice(a.skus) ?? 0);
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
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

function summarizeSkuSpec(skus: AdminSku[]) {
  skus = skus.filter(sku => sku.status === "ACTIVE");
  const colors = Array.from(new Set(skus.map((sku) => sku.color).filter(Boolean))).slice(0, 3);
  const sizes = Array.from(new Set(skus.map((sku) => sku.size).filter(Boolean))).slice(0, 3);
  return `${colors.join("、") || "未填"} / ${sizes.join("、") || "未填"}`;
}

function getAvailableStock(sku: AdminSku) {
  return sku.status === "ACTIVE" ? Math.max(0, sku.stockQuantity - sku.reservedQuantity) : 0;
}

function getPrimaryImageUrl(product: AdminProduct) {
  return product.images?.find((image) => image.imageUrl)?.imageUrl ?? product.image ?? "";
}

function getLowestPrice(skus: AdminSku[]) {
  skus = skus.filter(sku => sku.status === "ACTIVE");
  if (!skus.length) return null;
  return skus.reduce((min, sku) => Math.min(min, sku.priceCents), skus[0].priceCents);
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(cents / 100);
}

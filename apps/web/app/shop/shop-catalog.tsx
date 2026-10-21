"use client";

import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { ProductCard } from "@/components/product/product-card";
import type { StorefrontProduct } from "@/lib/storefront-product";

type ShopCatalogProps = {
  favoriteSlugs: string[];
  initialQuery?: string;
  initialSilhouette?: string;
  products: StorefrontProduct[];
};

export function ShopCatalog({ favoriteSlugs, initialQuery = "", initialSilhouette = "ALL", products }: ShopCatalogProps) {
  const [query, setQuery] = useState(initialQuery);
  const [silhouette, setSilhouette] = useState(initialSilhouette);
  const [rise, setRise] = useState("ALL");
  const [feature, setFeature] = useState("ALL");
  const [sort, setSort] = useState<"recommended" | "name">("recommended");
  const silhouettes = useMemo(() => uniqueValues(products.map((product) => product.silhouette)), [products]);
  const rises = useMemo(() => uniqueValues(products.map((product) => product.rise)), [products]);
  const features = useMemo(() => uniqueValues(products.flatMap((product) => product.features)), [products]);
  const activeFilterCount = [silhouette, rise, feature].filter((value) => value !== "ALL").length;
  const favoriteSet = useMemo(() => new Set(favoriteSlugs), [favoriteSlugs]);
  const visibleProducts = useMemo(() => {
    const filtered = products.filter((product) => {
      if (query && !`${product.name} ${product.summary} ${product.silhouette} ${product.features.join(" ")}`.toLowerCase().includes(query.toLowerCase())) return false;
      if (silhouette !== "ALL" && !product.silhouette.includes(silhouette)) return false;
      if (rise !== "ALL" && product.rise !== rise) return false;
      if (feature !== "ALL" && !product.features.includes(feature)) return false;
      return true;
    });
    if (sort === "name") return [...filtered].sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
    return filtered;
  }, [feature, products, query, rise, silhouette, sort]);

  function resetFilters() {
    setSilhouette("ALL");
    setRise("ALL");
    setFeature("ALL");
    setQuery("");
    setSort("recommended");
  }

  return (
    <>
      {products.length > 1 ? <section aria-label="商品筛选" className="sticky top-16 z-20 border-y border-black/10 bg-white px-5 py-4 md:px-8">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="vk-scrollbar-none flex min-w-0 gap-2 overflow-x-auto pb-1">
            <span className="flex h-11 shrink-0 items-center gap-2 rounded-full border border-black/20 px-4 text-sm font-semibold"><SlidersHorizontal className="h-4 w-4" />筛选{activeFilterCount ? ` ${activeFilterCount}` : ""}</span>
          <FilterSelect label="全部版型" onChange={setSilhouette} options={silhouettes} value={silhouette} />
          <FilterSelect label="全部腰位" onChange={setRise} options={rises} value={rise} />
          <FilterSelect label="全部特点" onChange={setFeature} options={features} value={feature} />
            <button aria-label="重置筛选" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-black/20 transition hover:bg-black hover:text-white" onClick={resetFilters} title="重置筛选" type="button">
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center justify-between gap-4 xl:justify-end">
            <p aria-live="polite" className="whitespace-nowrap text-sm text-black/60">{visibleProducts.length} 件商品</p>
            <label className="flex items-center gap-2 whitespace-nowrap text-sm text-black/60">
              排序
              <select className="h-11 min-w-[132px] rounded-full border border-black/20 bg-white px-4 text-sm font-semibold text-black" onChange={(event) => setSort(event.target.value as "recommended" | "name")} value={sort}>
              <option value="recommended">推荐顺序</option>
              <option value="name">名称顺序</option>
            </select>
            </label>
          </div>
        </div>
      </section> : null}
      {query ? <div className="flex items-center justify-between border-b border-black/10 px-5 py-4 text-sm md:px-8"><p>“{query}” 的搜索结果</p><button className="font-semibold underline underline-offset-4" onClick={() => setQuery("")} type="button">清除搜索</button></div> : null}

      {visibleProducts.length ? (
        <section className={`catalog-grid grid gap-6 ${products.length === 1 ? "grid-cols-1 max-w-[660px]" : "grid-cols-2 md:grid-cols-3"}`}>
          {visibleProducts.map((product, index) => <ProductCard eager={index === 0} favorited={favoriteSet.has(product.slug)} key={product.slug} product={product} />)}
        </section>
      ) : (
        <section className="grid min-h-[260px] place-items-center border-y border-[#d9d9d9] text-center">
          <div>
            <h2 className="text-2xl font-semibold">没有符合条件的商品</h2>
            <p className="mt-3 text-sm font-semibold text-muted">调整版型、腰位或功能筛选后再查看。</p>
            <button className="vk-button vk-button-dark mt-6" onClick={resetFilters} type="button">清除筛选</button>
          </div>
        </section>
      )}
    </>
  );
}

function FilterSelect({ label, onChange, options, value }: { label: string; onChange: (value: string) => void; options: string[]; value: string }) {
  return (
    <label className="shrink-0">
      <span className="sr-only">{label.replace("全部", "")}</span>
      <select className="h-11 min-w-[118px] rounded-full border border-black/20 bg-white px-4 text-sm font-semibold text-black" disabled={!options.length} onChange={(event) => onChange(event.target.value)} value={value}>
        <option value="ALL">{label}</option>
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN"));
}

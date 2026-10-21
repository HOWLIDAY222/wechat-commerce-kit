"use client";

import Image from "next/image";
import { ChevronDown, ChevronUp, Eye, Monitor, Plus, RotateCcw, Save, Send, Smartphone, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { resolveProductHeroPosterImages } from "@/lib/catalog-media";
import type { FooterDocument, HeaderDocument, PageDocument, PageLink, SiteDocument, SiteSection } from "@/lib/site-builder";
import { isActiveSaleProduct } from "@/lib/storefront-visibility";

type PageOption = { key: string; name: string; path: string | null; kind: string };
type AssetOption = { id: string; name: string; url: string; altText: string | null };
type ProductOption = {
  id: string;
  code: string;
  name: string;
  image: string | null;
  images: string[];
  saleMode: string | null;
  status: string;
  skus: Array<{ id: string; priceCents: number; stockQuantity: number; reservedQuantity: number; status: string }>;
};
type VersionOption = {
  id: string;
  versionNumber: number;
  status: string;
  document: SiteDocument;
  seoTitle: string | null;
  seoDescription: string | null;
  ogImageUrl: string | null;
  changeNote: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};
type ComposerPage = {
  id: string;
  key: string;
  name: string;
  path: string | null;
  kind: string;
  template: string;
  draft: VersionOption;
  versions: VersionOption[];
};

export function SitePageComposer({ assets, page, pages, products }: { assets: AssetOption[]; page: ComposerPage; pages: PageOption[]; products: ProductOption[] }) {
  const router = useRouter();
  const [document, setDocument] = useState<SiteDocument>(() => structuredClone(page.draft.document));
  const [selectedSectionId, setSelectedSectionId] = useState(() => document.documentType === "page" ? sortedSections(document)[0]?.id ?? "" : "");
  const [seoTitle, setSeoTitle] = useState(page.draft.seoTitle ?? "");
  const [seoDescription, setSeoDescription] = useState(page.draft.seoDescription ?? "");
  const [ogImageUrl, setOgImageUrl] = useState(page.draft.ogImageUrl ?? "");
  const [changeNote, setChangeNote] = useState(page.draft.changeNote ?? "");
  const [message, setMessage] = useState("当前正在编辑草稿，前台仍显示已发布版本。");
  const [busy, setBusy] = useState<"save" | "preview" | "publish" | "rollback" | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("mobile");
  const selectedSection = document.documentType === "page" ? document.sections.find((section) => section.id === selectedSectionId) ?? null : null;
  const featuredPreorder = page.key === "home" ? products.find((product) => product.status === "ACTIVE" && product.saleMode === "PREORDER") ?? null : null;
  const selectablePages = pages.filter((item) => item.path !== null);
  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const publishedVersion = useMemo(() => page.versions.find((version) => version.status === "PUBLISHED") ?? null, [page.versions]);
  const differenceSummary = useMemo(
    () => getDifferenceSummary({ document, ogImageUrl, publishedVersion, seoDescription, seoTitle }),
    [document, ogImageUrl, publishedVersion, seoDescription, seoTitle],
  );

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [isDirty]);

  const mutationLock=useRef(false);
  async function saveDraft(mode: "save" | "preview" | "publish" = "save") {
    if(mutationLock.current)return false;
    mutationLock.current=true;
    const previewWindow = mode === "preview" ? window.open("about:blank", "_blank") : null;
    try {
    setBusy(mode);
    setMessage(mode === "publish" ? "正在保存并发布..." : "正在保存草稿...");
    const response = await fetch(`/api/admin/design/pages/${encodeURIComponent(page.key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ document, seoTitle, seoDescription, ogImageUrl, changeNote }),
    });
    const result = await response.json().catch(() => ({})) as { ok?: boolean; error?: string; draft?: VersionOption };
    if (!response.ok || !result.ok) {
      previewWindow?.close();
      setBusy(null);
      setMessage(getErrorMessage(result.error));
      return false;
    }
    setIsDirty(false);
    if (mode === "preview") {
      setBusy(null);
      setMessage("草稿已保存，已打开预览。仍需点击发布才会更新前台。");
      if (previewWindow) previewWindow.location.replace(`/preview/${encodeURIComponent(page.key)}`);
      else setMessage("草稿已保存。浏览器拦截了预览窗口，请允许弹出窗口后再次点击预览。");
      return true;
    }
    if (mode === "publish") {
      const publishResponse = await fetch(`/api/admin/design/pages/${encodeURIComponent(page.key)}/publish`, { method: "POST" });
      const publishResult = await publishResponse.json().catch(() => ({}));
      setBusy(null);
      if (!publishResponse.ok || !publishResult.ok) {
        setMessage(getErrorMessage(publishResult.error));
        return false;
      }
      setMessage("发布成功。前台现在读取这个版本，系统已自动创建下一份草稿。");
      router.refresh();
      return true;
    }
    setBusy(null);
    setMessage("草稿已保存。请预览确认后再发布。");
    router.refresh();
    return true;
    } catch {previewWindow?.close();setMessage("连接中断，请刷新核对草稿与发布版本后重试。");return false;} finally {mutationLock.current=false;setBusy(null);}
  }

  async function rollback(version: VersionOption) {
    if (!window.confirm(`把历史版本 v${version.versionNumber} 恢复到当前草稿？线上版本不会立即改变。`)) return;
    if(mutationLock.current)return;mutationLock.current=true;
    try {
    setBusy("rollback");
    const response = await fetch(`/api/admin/design/pages/${encodeURIComponent(page.key)}/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ versionId: version.id }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(null);
    if (!response.ok || !result.ok) {
      setMessage(getErrorMessage(result.error));
      return;
    }
    if (result.draft) {
      setDocument(structuredClone(result.draft.document));
      setSeoTitle(result.draft.seoTitle ?? "");
      setSeoDescription(result.draft.seoDescription ?? "");
      setOgImageUrl(result.draft.ogImageUrl ?? "");
      setChangeNote(result.draft.changeNote ?? "");
      if (result.draft.document.documentType === "page") {
        setSelectedSectionId(sortedSections(result.draft.document)[0]?.id ?? "");
      }
    }
    setIsDirty(false);
    setMessage(`v${version.versionNumber} 已恢复到草稿，请重新检查并发布。`);
    router.refresh();
    } catch {setMessage("连接中断，请刷新核对恢复结果后重试。");} finally {mutationLock.current=false;setBusy(null);}
  }

  function updateSection(next: SiteSection) {
    if (document.documentType !== "page") return;
    updateDocument({ ...document, sections: document.sections.map((section) => section.id === next.id ? next : section) });
  }

  function moveSection(sectionId: string, direction: -1 | 1) {
    if (document.documentType !== "page") return;
    const sections = sortedSections(document);
    const index = sections.findIndex((section) => section.id === sectionId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= sections.length) return;
    [sections[index], sections[target]] = [sections[target], sections[index]];
    updateDocument({ ...document, sections: sections.map((section, order) => ({ ...section, sortOrder: order * 10 })) });
  }

  function addSection(type: "cardGrid" | "productGrid") {
    if (document.documentType !== "page") return;
    const id = `section-${Date.now()}`;
    const sortOrder = document.sections.length * 10;
    const section: SiteSection = type === "productGrid"
      ? { id, type, visible: true, sortOrder, title: "商品推荐", action: { label: "查看全部", pageKey: "shop" }, productIds: [] }
      : { id, type, visible: true, sortOrder, title: "新板块", columns: 3, items: [{ id: `${id}-item-1`, title: "内容标题", body: "在右侧填写这条内容。" }] };
    updateDocument({ ...document, sections: [...document.sections, section] });
    setSelectedSectionId(id);
  }

  function removeSection(sectionId: string) {
    if (document.documentType !== "page" || !window.confirm("删除这个草稿板块？已发布版本不会受影响。")) return;
    const sections = document.sections.filter((section) => section.id !== sectionId);
    updateDocument({ ...document, sections });
    setSelectedSectionId(sections[0]?.id ?? "");
  }

  function updateDocument(next: SiteDocument) {
    setDocument(next);
    setIsDirty(true);
  }

  function updateSeoTitle(next: string) {
    setSeoTitle(next);
    setIsDirty(true);
  }

  function updateSeoDescription(next: string) {
    setSeoDescription(next);
    setIsDirty(true);
  }

  function updateOgImageUrl(next: string) {
    setOgImageUrl(next);
    setIsDirty(true);
  }

  function updateChangeNote(next: string) {
    setChangeNote(next);
    setIsDirty(true);
  }

  function navigateToPage(nextPageKey: string) {
    if (nextPageKey === page.key) return;
    if (isDirty && !window.confirm("当前页面还有未保存修改，确认放弃并切换页面？")) return;
    router.push(`/admin/design/pages/${encodeURIComponent(nextPageKey)}`);
  }

  return (
    <div className="grid gap-4">
      <section className="flex flex-col gap-3 border border-[#d8dde5] bg-white p-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-black">{page.name} · 草稿 v{page.draft.versionNumber}</p>
            {isDirty ? <span className="rounded-[6px] bg-[#fff7ed] px-2 py-0.5 text-[11px] font-black text-[#c2410c]">有未保存修改</span> : <span className="rounded-[6px] bg-[#ecfdf3] px-2 py-0.5 text-[11px] font-black text-[#067647]">草稿已保存</span>}
          </div>
          <p className="mt-1 text-xs font-black text-[#475467]">{differenceSummary}</p>
          <p className="mt-1 text-xs font-bold text-[#697386]" role="status">{message}</p>
          {featuredPreorder ? <p className="mt-2 text-xs font-bold leading-5 text-[#155eef]">同步规则：首页文案与按钮由这里管理；价格、发售状态和右侧轮播由“商品 → {featuredPreorder.name}”管理。</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="vk-button vk-button-light gap-2" disabled={busy !== null || !isDirty} onClick={() => saveDraft("save")} type="button"><Save className="h-4 w-4" />保存草稿</button>
          <button className="vk-button vk-button-light gap-2" disabled={busy !== null} onClick={() => saveDraft("preview")} type="button"><Eye className="h-4 w-4" />预览草稿</button>
          <button className="vk-button vk-button-dark gap-2" disabled={busy !== null} onClick={() => { if (window.confirm("确认发布当前草稿？发布后前台会立即读取这个版本。")) saveDraft("publish"); }} type="button"><Send className="h-4 w-4" />发布</button>
        </div>
      </section>

      <section className="grid min-w-0 gap-4 xl:grid-cols-[220px_minmax(0,1fr)_360px]">
        <aside tabIndex={0} className="vk-editor-sidebar min-w-0 border border-[#d8dde5] bg-white xl:sticky xl:top-[112px] xl:max-h-[calc(100dvh-136px)] xl:overflow-y-auto">
          <label className="grid gap-2 border-b border-[#e4e7ec] p-3 text-xs font-black text-[#697386]">
            编辑页面
            <select className="vk-admin-filter h-10 bg-white text-[#101828]" onChange={(event) => navigateToPage(event.target.value)} value={page.key}>
              {pages.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}
            </select>
          </label>
          {document.documentType === "page" ? (
            <>
              <div className="flex items-center justify-between px-4 py-3"><p className="text-xs font-black text-[#697386]">页面板块</p><span className="text-[11px] font-bold text-[#98a2b3]">{document.sections.length}</span></div>
              <div className="grid gap-1 px-2 pb-3">
                {sortedSections(document).map((section, index) => (
                  <div className={section.id === selectedSectionId ? "grid grid-cols-[minmax(0,1fr)_auto] items-center rounded-[6px] bg-[#eef4ff]" : "grid grid-cols-[minmax(0,1fr)_auto] items-center rounded-[6px] hover:bg-[#f8fafc]"} key={section.id}>
                    <button className="min-w-0 px-3 py-2 text-left" onClick={() => setSelectedSectionId(section.id)} type="button">
                      <span className="block truncate text-xs font-black">{getSectionLabel(section)}</span>
                      <span className="mt-0.5 block text-[10px] font-bold text-[#697386]">{section.visible ? "显示" : "已隐藏"}</span>
                    </button>
                    <div className="flex pr-1">
                      <IconButton disabled={index === 0} label="上移板块" onClick={() => moveSection(section.id, -1)}><ChevronUp className="h-3.5 w-3.5" /></IconButton>
                      <IconButton disabled={index === document.sections.length - 1} label="下移板块" onClick={() => moveSection(section.id, 1)}><ChevronDown className="h-3.5 w-3.5" /></IconButton>
                    </div>
                  </div>
                ))}
                <div className="mt-2 grid grid-cols-2 gap-1 border-t border-[#eef1f5] pt-2">
                  <button className="flex min-h-9 items-center justify-center gap-1 rounded-[6px] border border-[#d8dde5] text-[11px] font-black" onClick={() => addSection("cardGrid")} type="button"><Plus className="h-3.5 w-3.5" />文案板块</button>
                  <button className="flex min-h-9 items-center justify-center gap-1 rounded-[6px] border border-[#d8dde5] text-[11px] font-black" onClick={() => addSection("productGrid")} type="button"><Plus className="h-3.5 w-3.5" />商品推荐</button>
                </div>
              </div>
            </>
          ) : null}
        </aside>

        <div className="min-w-0 overflow-hidden border border-[#d8dde5] bg-[#eef1f5] p-3 md:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-xs font-black text-[#475467]">编辑结构示意</p><span className="text-[11px] font-bold text-[#697386]">在右侧修改；真实显示请点击“预览草稿”。首页与内容正文同步官网和小程序。</span></div>
            <div className="grid grid-cols-2 rounded-[6px] bg-white p-1" aria-label="预览设备">
              <button aria-pressed={previewMode === "mobile"} className={previewMode === "mobile" ? "inline-flex h-8 items-center gap-1 rounded-[4px] bg-[#eef4ff] px-2 text-[11px] font-black text-[#155eef]" : "inline-flex h-8 items-center gap-1 rounded-[4px] px-2 text-[11px] font-bold text-[#667085]"} onClick={() => setPreviewMode("mobile")} type="button"><Smartphone className="h-3.5 w-3.5" />移动端</button>
              <button aria-pressed={previewMode === "desktop"} className={previewMode === "desktop" ? "inline-flex h-8 items-center gap-1 rounded-[4px] bg-[#eef4ff] px-2 text-[11px] font-black text-[#155eef]" : "inline-flex h-8 items-center gap-1 rounded-[4px] px-2 text-[11px] font-bold text-[#667085]"} onClick={() => setPreviewMode("desktop")} type="button"><Monitor className="h-3.5 w-3.5" />桌面端</button>
            </div>
          </div>
          <div className="overflow-hidden pb-2">
            <PreviewCanvasFrame assets={assetMap} document={document} mode={previewMode} pageKey={page.key} products={products} selectedSectionId={selectedSectionId} />
          </div>
        </div>

        <aside tabIndex={0} className="vk-editor-sidebar min-w-0 border border-[#d8dde5] bg-white xl:sticky xl:top-[112px] xl:max-h-[calc(100dvh-136px)] xl:overflow-y-auto">
          <div className="border-b border-[#e4e7ec] px-4 py-3"><p className="text-xs font-black text-[#697386]">属性编辑</p><h2 className="mt-1 text-sm font-black">{selectedSection ? getSectionLabel(selectedSection) : document.documentType === "header" ? "顶部导航" : document.documentType === "footer" ? "页脚与渠道" : "页面设置"}</h2></div>
          <div className="grid gap-5 p-4">
            {document.documentType === "page" && selectedSection ? <SectionInspector assets={assets} managedPreorderHero={Boolean(featuredPreorder && selectedSection.type === "hero")} onChange={updateSection} onRemove={() => removeSection(selectedSection.id)} pages={selectablePages} products={products} section={selectedSection} /> : null}
            {document.documentType === "header" ? <HeaderInspector document={document} onChange={updateDocument} pages={selectablePages} /> : null}
            {document.documentType === "footer" ? <FooterInspector document={document} onChange={updateDocument} pages={selectablePages} /> : null}
            {document.documentType === "page" ? (
              <div className="grid gap-3 border-t border-[#e4e7ec] pt-4">
                <h3 className="text-sm font-black">搜索展示</h3>
                <Field label="页面标题" value={seoTitle} onChange={updateSeoTitle} />
                <TextArea label="页面描述" value={seoDescription} onChange={updateSeoDescription} rows={3} />
                <label className="vk-field"><span>分享图</span><select value={ogImageUrl} onChange={(event) => updateOgImageUrl(event.target.value)}><option value="">使用默认品牌图</option>{assets.map((asset) => <option key={asset.id} value={asset.url}>{asset.name}</option>)}</select></label>
                <Field label="本次修改说明" value={changeNote} onChange={updateChangeNote} placeholder="例如：更新首页夏季主图" />
              </div>
            ) : null}
          </div>
        </aside>
      </section>

      <section className="border border-[#d8dde5] bg-white">
        <div className="border-b border-[#e4e7ec] px-5 py-4"><h2 className="text-base font-black">版本记录</h2><p className="mt-1 text-xs font-bold text-[#697386]">恢复操作只写入当前草稿，不会绕过预览和发布。</p></div>
        <div className="divide-y divide-[#eef1f5]">
          {page.versions.filter((version) => version.status !== "DRAFT").map((version) => (
            <div className="grid gap-3 px-5 py-4 text-xs md:grid-cols-[100px_120px_1fr_auto] md:items-center" key={version.id}>
              <span className="font-black">v{version.versionNumber}</span>
              <span className={version.status === "PUBLISHED" ? "font-black text-[#027a48]" : "font-bold text-[#697386]"}>{version.status === "PUBLISHED" ? "当前已发布" : "历史版本"}</span>
              <span className="font-bold text-[#697386]">{version.changeNote || "未填写修改说明"} · {formatDate(version.publishedAt || version.updatedAt)}</span>
              <button className="vk-button vk-button-light gap-2" disabled={busy !== null} onClick={() => rollback(version)} type="button"><RotateCcw className="h-4 w-4" />恢复到草稿</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SectionInspector({ assets, managedPreorderHero, onChange, onRemove, pages, products, section }: { assets: AssetOption[]; managedPreorderHero: boolean; onChange: (section: SiteSection) => void; onRemove: () => void; pages: PageOption[]; products: ProductOption[]; section: SiteSection }) {
  function patch(value: Partial<SiteSection>) { onChange({ ...section, ...value } as SiteSection); }
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs font-black"><input checked={section.visible} onChange={(event) => patch({ visible: event.target.checked })} type="checkbox" />显示板块</label>
        <button aria-label="删除板块" className="inline-flex h-9 w-9 items-center justify-center rounded-[6px] border border-[#fecdca] text-[#b42318]" onClick={onRemove} title="删除板块" type="button"><Trash2 className="h-4 w-4" /></button>
      </div>
      {section.type === "hero" ? <HeroFields assets={assets} managedPreorderHero={managedPreorderHero} onChange={onChange} pages={pages} section={section} /> : null}
      {section.type === "categoryGrid" ? <CategoryFields assets={assets} onChange={onChange} pages={pages} section={section} /> : null}
      {section.type === "productGrid" ? <ProductFields assets={assets} onChange={onChange} pages={pages} products={products} section={section} /> : null}
      {section.type === "cardGrid" || section.type === "contentGrid" ? <CardFields assets={assets} onChange={onChange} pages={pages} section={section} /> : null}
    </div>
  );
}

function HeroFields({ assets, onChange, pages, section }: { assets: AssetOption[]; managedPreorderHero: boolean; onChange: (section: SiteSection) => void; pages: PageOption[]; section: Extract<SiteSection, { type: "hero" }> }) {
  const patch = (value: Partial<typeof section>) => onChange({ ...section, ...value });
  return <>
    <Field label="眉标题" value={section.eyebrow} onChange={(value) => patch({ eyebrow: value })} />
    <Field label="主标题" value={section.title} onChange={(value) => patch({ title: value })} />
    <TextArea label="说明文字" value={section.body} onChange={(value) => patch({ body: value })} rows={4} />
    <AssetSelect assets={assets} label="主图（留空使用现有品牌轮播）" value={section.mediaAssetId ?? ""} onChange={(value) => patch({ mediaAssetId: value || undefined })} />
    <Field label="按钮文字" value={section.action.label} onChange={(value) => patch({ action: { ...section.action, label: value } })} />
    <PageSelect label="按钮跳转页面" pages={pages} value={section.action.pageKey} onChange={(value) => patch({ action: { ...section.action, pageKey: value } })} />
    <Field label="功能短语（用逗号分隔）" value={section.features.join("，")} onChange={(value) => patch({ features: value.split(/[，,]/).map((item) => item.trim()).filter(Boolean).slice(0, 6) })} />
  </>;
}

function CategoryFields({ assets, onChange, pages, section }: { assets: AssetOption[]; onChange: (section: SiteSection) => void; pages: PageOption[]; section: Extract<SiteSection, { type: "categoryGrid" }> }) {
  const patchItem = (index: number, value: Partial<(typeof section.items)[number]>) => onChange({ ...section, items: section.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...value } : item) });
  return <>
    <Field label="板块标题" value={section.title} onChange={(title) => onChange({ ...section, title })} />
    <div className="grid gap-4">
      {section.items.map((item, index) => <div className="grid gap-3 border-t border-[#e4e7ec] pt-4" key={item.id}>
        <div className="flex items-center justify-between"><strong className="text-xs">分类 {index + 1}</strong><IconButton label="删除分类" onClick={() => onChange({ ...section, items: section.items.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 className="h-4 w-4" /></IconButton></div>
        <Field label="名称" value={item.title} onChange={(title) => patchItem(index, { title })} />
        <Field label="说明" value={item.body} onChange={(body) => patchItem(index, { body })} />
        <AssetSelect assets={assets} label="图片" value={item.mediaAssetId ?? ""} onChange={(mediaAssetId) => patchItem(index, { mediaAssetId: mediaAssetId || undefined })} />
        <PageSelect label="跳转页面" pages={pages} value={item.link.pageKey} onChange={(pageKey) => patchItem(index, { link: { ...item.link, pageKey } })} />
        <Field label="筛选参数" value={item.link.query ?? ""} onChange={(query) => patchItem(index, { link: { ...item.link, query } })} placeholder="例如 category=tops" />
      </div>)}
      <button className="vk-button vk-button-light gap-2" onClick={() => onChange({ ...section, items: [...section.items, { id: `category-${Date.now()}`, title: "新分类", body: "分类说明", link: { label: "查看分类", pageKey: "shop" } }] })} type="button"><Plus className="h-4 w-4" />添加分类</button>
    </div>
  </>;
}

function ProductFields({ assets, onChange, pages, products, section }: { assets:AssetOption[]; onChange: (section: SiteSection) => void; pages: PageOption[]; products: ProductOption[]; section: Extract<SiteSection, { type: "productGrid" }> }) {
  const offeredProducts = products.filter(isActiveSaleProduct);
  return <>
    <label className="vk-field"><span>商品排版</span><select value={section.layout||"grid"} onChange={e=>onChange({...section,layout:e.target.value as "grid"|"spotlight"})}><option value="grid">商品网格</option><option value="spotlight">品牌大图与商品介绍</option></select></label>
    <AssetSelect assets={assets} label="板块横幅（可选）" value={section.mediaAssetId||""} onChange={value=>onChange({...section,mediaAssetId:value||undefined})}/>
    <TextArea label="商品板块说明" value={section.body||""} rows={2} onChange={body=>onChange({...section,body})}/>
    <Field label="板块标题" value={section.title} onChange={(title) => onChange({ ...section, title })} />
    <Field label="右侧按钮文字" value={section.action.label} onChange={(label) => onChange({ ...section, action: { ...section.action, label } })} />
    <PageSelect label="按钮跳转页面" pages={pages} value={section.action.pageKey} onChange={(pageKey) => onChange({ ...section, action: { ...section.action, pageKey } })} />
    <fieldset className="grid gap-2"><legend className="mb-2 text-xs font-black">关联预售或已发售商品</legend>{offeredProducts.map((product) => {
      const checked = section.productIds.includes(product.id);
      const stock = product.skus.reduce((sum, sku) => sum + Math.max(0, sku.status === "ACTIVE" ? sku.stockQuantity - sku.reservedQuantity : 0), 0);
      return <label className="flex items-start gap-2 border border-[#e4e7ec] p-3 text-xs" key={product.id}><input checked={checked} disabled={!checked && section.productIds.length >= 12} onChange={(event) => onChange({ ...section, productIds: event.target.checked ? [...section.productIds, product.id] : section.productIds.filter((id) => id !== product.id) })} type="checkbox" /><span><strong className="block">{product.name}</strong><span className="mt-1 block font-bold text-[#697386]">{product.code} · 可售 {stock}</span></span></label>;
    })}</fieldset>
  </>;
}

function CardFields({ assets, onChange, pages, section }: { assets: AssetOption[]; onChange: (section: SiteSection) => void; pages: PageOption[]; section: Extract<SiteSection, { type: "cardGrid" | "contentGrid" }> }) {
  const patchItem = (index: number, value: Partial<(typeof section.items)[number]>) => onChange({ ...section, items: section.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...value } : item) });
  return <>
    <label className="vk-field"><span>首页图片排版</span><select value={section.layout||"grid"} onChange={e=>onChange({...section,layout:e.target.value as "grid"|"fitPair"|"detailPair"})}><option value="grid">普通内容网格</option><option value="fitPair">穿着效果双图</option><option value="detailPair">产品细节双图</option></select></label>
    <TextArea label="板块说明" value={section.body||""} rows={2} onChange={body=>onChange({...section,body})}/>
    <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={!!section.action} onChange={e=>onChange({...section,action:e.target.checked?{label:"了解产品细节",pageKey:"shop"}:undefined})}/>显示板块按钮</label>
    {section.action&&<><Field label="板块按钮文字" value={section.action.label} onChange={label=>onChange({...section,action:{...section.action!,label}})}/><PageSelect label="板块按钮跳转" pages={pages} value={section.action.pageKey} onChange={pageKey=>onChange({...section,action:{...section.action!,pageKey}})}/></>}
    <Field label="板块标题" value={section.title} onChange={(title) => onChange({ ...section, title })} />
    {(!section.layout||section.layout==="grid")&&<label className="vk-field"><span>每行数量</span><select value={section.columns} onChange={(event) => onChange({ ...section, columns: Number(event.target.value) as 1 | 2 | 3 })}><option value={1}>1 项</option><option value={2}>2 项</option><option value={3}>3 项</option></select></label>}
    <div className="grid gap-4">
      {section.items.map((item, index) => <div className="grid gap-3 border-t border-[#e4e7ec] pt-4" key={item.id}>
        <div className="flex items-center justify-between"><strong className="text-xs">内容 {index + 1}</strong><IconButton label="删除内容" onClick={() => onChange({ ...section, items: section.items.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 className="h-4 w-4" /></IconButton></div>
        <Field label="标题" value={item.title} onChange={(title) => patchItem(index, { title })} />
        <TextArea label="正文" value={item.body} onChange={(body) => patchItem(index, { body })} rows={4} />
        <AssetSelect assets={assets} label="图片（可选）" value={item.mediaAssetId ?? ""} onChange={(mediaAssetId) => patchItem(index, { mediaAssetId: mediaAssetId || undefined })} />
        <label className="flex items-center gap-2 text-xs font-black"><input checked={Boolean(item.link)} onChange={(event) => patchItem(index, { link: event.target.checked ? { label: "查看详情", pageKey: "shop" } : undefined })} type="checkbox" />显示按钮</label>
        {item.link ? <><Field label="按钮文字" value={item.link.label} onChange={(label) => patchItem(index, { link: { ...item.link!, label } })} /><PageSelect label="按钮跳转页面" pages={pages} value={item.link.pageKey} onChange={(pageKey) => patchItem(index, { link: { ...item.link!, pageKey } })} /></> : null}
      </div>)}
      <button className="vk-button vk-button-light gap-2" onClick={() => onChange({ ...section, items: [...section.items, { id: `content-${Date.now()}`, title: "新内容", body: "填写内容说明。" }] })} type="button"><Plus className="h-4 w-4" />添加内容</button>
    </div>
  </>;
}

function HeaderInspector({ document, onChange, pages }: { document: HeaderDocument; onChange: (document: SiteDocument) => void; pages: PageOption[] }) {
  const patchItem = (index: number, value: Partial<PageLink>) => onChange({ ...document, items: document.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...value } : item) });
  return <div className="grid gap-4">{document.items.map((item, index) => <div className="grid gap-3 border-b border-[#e4e7ec] pb-4" key={`${item.pageKey}-${index}`}>
    <div className="flex items-center justify-between"><strong className="text-xs">菜单 {index + 1}</strong><div className="flex"><IconButton disabled={index === 0} label="上移" onClick={() => onChange({ ...document, items: moveItem(document.items, index, -1) })}><ChevronUp className="h-4 w-4" /></IconButton><IconButton disabled={index === document.items.length - 1} label="下移" onClick={() => onChange({ ...document, items: moveItem(document.items, index, 1) })}><ChevronDown className="h-4 w-4" /></IconButton><IconButton label="删除" onClick={() => onChange({ ...document, items: document.items.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 className="h-4 w-4" /></IconButton></div></div>
    <Field label="菜单名称" value={item.label} onChange={(label) => patchItem(index, { label })} />
    <PageSelect label="已有页面" pages={pages} value={item.pageKey} onChange={(pageKey) => patchItem(index, { pageKey })} />
    <Field label="筛选参数（可选）" value={item.query ?? ""} onChange={(query) => patchItem(index, { query })} placeholder="例如 category=tops" />
  </div>)}<button className="vk-button vk-button-light gap-2" onClick={() => onChange({ ...document, items: [...document.items, { label: "新菜单", pageKey: "home" }] })} type="button"><Plus className="h-4 w-4" />添加菜单</button></div>;
}

function FooterInspector({ document, onChange, pages }: { document: FooterDocument; onChange: (document: SiteDocument) => void; pages: PageOption[] }) {
  return <div className="grid gap-5">
    <TextArea label="品牌文案" value={document.brandText} onChange={(brandText) => onChange({ ...document, brandText })} rows={5} />
    <div className="grid gap-4"><h3 className="text-sm font-black">页脚栏目</h3>{document.columns.map((column, columnIndex) => <div className="grid gap-3 border-t border-[#e4e7ec] pt-4" key={column.id}>
      <div className="flex items-center justify-between"><strong className="text-xs">栏目 {columnIndex + 1}</strong><IconButton label="删除栏目" onClick={() => onChange({ ...document, columns: document.columns.filter((_, index) => index !== columnIndex) })}><Trash2 className="h-4 w-4" /></IconButton></div>
      <Field label="栏目名称" value={column.title} onChange={(title) => onChange({ ...document, columns: document.columns.map((item, index) => index === columnIndex ? { ...item, title } : item) })} />
      {column.links.map((link, linkIndex) => <div className="grid gap-2 bg-[#f8fafc] p-3" key={`${link.pageKey}-${linkIndex}`}><div className="flex justify-end"><IconButton label="删除链接" onClick={() => updateFooterColumn(document, onChange, columnIndex, { links: column.links.filter((_, index) => index !== linkIndex) })}><Trash2 className="h-3.5 w-3.5" /></IconButton></div><Field label="链接名称" value={link.label} onChange={(label) => updateFooterLink(document, onChange, columnIndex, linkIndex, { label })} /><PageSelect label="已有页面" pages={pages} value={link.pageKey} onChange={(pageKey) => updateFooterLink(document, onChange, columnIndex, linkIndex, { pageKey })} /></div>)}
      <button className="vk-button vk-button-light gap-2" onClick={() => updateFooterColumn(document, onChange, columnIndex, { links: [...column.links, { label: "新链接", pageKey: "home" }] })} type="button"><Plus className="h-4 w-4" />添加链接</button>
    </div>)}<button className="vk-button vk-button-light gap-2" onClick={() => onChange({ ...document, columns: [...document.columns, { id: `footer-${Date.now()}`, title: "新栏目", links: [{ label: "首页", pageKey: "home" }] }] })} type="button"><Plus className="h-4 w-4" />添加栏目</button></div>
    <div className="grid gap-4"><h3 className="text-sm font-black">官方渠道</h3>{document.socialChannels.map((channel, index) => <div className="grid gap-3 border-t border-[#e4e7ec] pt-4" key={channel.id}><label className="flex items-center gap-2 text-xs font-black"><input checked={channel.visible} onChange={(event) => updateSocial(document, onChange, index, { visible: event.target.checked })} type="checkbox" />显示渠道</label><Field label="平台名称" value={channel.label} onChange={(label) => updateSocial(document, onChange, index, { label })} /><Field label="账号或说明" value={channel.account} onChange={(account) => updateSocial(document, onChange, index, { account })} /><Field label="外部链接（可选）" value={channel.url} onChange={(url) => updateSocial(document, onChange, index, { url })} placeholder="https://..." /></div>)}</div>
  </div>;
}

type DraftCanvasProps = {
  assets: Map<string, AssetOption>;
  document: SiteDocument;
  mode: "desktop" | "mobile";
  pageKey: string;
  products: ProductOption[];
  selectedSectionId: string;
};

function PreviewCanvasFrame(props: DraftCanvasProps) {
  const { mode } = props;
  const frameRef = useRef<HTMLDivElement>(null);
  const desktopCanvasRef = useRef<HTMLDivElement>(null);
  const [desktopScale, setDesktopScale] = useState(1);
  const [desktopHeight, setDesktopHeight] = useState(0);

  useLayoutEffect(() => {
    if (mode !== "desktop") return;

    const frame = frameRef.current;
    const canvas = desktopCanvasRef.current;
    if (!frame || !canvas) return;

    const updateDesktopFit = () => {
      const nextScale = Math.min(1, frame.clientWidth / 980);
      const nextHeight = canvas.scrollHeight * nextScale;
      setDesktopScale((current) => Math.abs(current - nextScale) > 0.001 ? nextScale : current);
      setDesktopHeight((current) => Math.abs(current - nextHeight) > 1 ? nextHeight : current);
    };

    const observer = new ResizeObserver(updateDesktopFit);
    observer.observe(frame);
    observer.observe(canvas);
    updateDesktopFit();
    return () => observer.disconnect();
  }, [mode]);

  if (mode === "mobile") {
    return <DraftCanvas {...props} />;
  }

  return (
    <div className="w-full overflow-hidden" ref={frameRef}>
      <div className="mx-auto" style={{ height: desktopHeight, width: 980 * desktopScale }}>
        <div ref={desktopCanvasRef} style={{ transform: `scale(${desktopScale})`, transformOrigin: "top left", width: 980 }}>
          <DraftCanvas {...props} />
        </div>
      </div>
    </div>
  );
}

function DraftCanvas({ assets, document, mode, pageKey, products, selectedSectionId }: DraftCanvasProps) {
  const canvasClass = mode === "desktop" ? "w-[980px]" : "mx-auto w-full max-w-[390px]";
  if (document.documentType === "header") return <div className={`${canvasClass} min-h-[520px] bg-white p-5`}><div className={mode === "desktop" ? "flex items-center gap-5 border-b border-[#e4e7ec] pb-4" : "grid gap-3 border-b border-[#e4e7ec] pb-4"}><strong>MerchantKit</strong><nav className="flex flex-wrap gap-4">{document.items.map((item, index) => <span className="text-xs font-black" key={`${item.pageKey}-${index}`}>{item.label}</span>)}</nav></div><PreviewEmpty title="顶部导航草稿" body="菜单名称、目标页面、筛选参数和顺序会按这里的配置发布。" /></div>;
  if (document.documentType === "footer") return <div className={`${canvasClass} min-h-[520px] bg-white p-6`}><div className={mode === "desktop" ? "grid grid-cols-[1.2fr_repeat(3,0.8fr)] gap-6" : "grid grid-cols-2 gap-6"}><div><strong className="text-xl">MerchantKit</strong><p className="mt-3 text-xs font-bold leading-6 text-[#667085]">{document.brandText}</p></div>{document.columns.map((column) => <div key={column.id}><strong className="text-sm">{column.title}</strong><div className="mt-3 grid gap-2">{column.links.map((link, index) => <span className="text-xs font-bold text-[#667085]" key={`${link.pageKey}-${index}`}>{link.label}</span>)}</div></div>)}</div><p className="mt-8 border-t border-[#e4e7ec] pt-4 text-xs font-bold text-[#667085]">{document.socialChannels.filter((item) => item.visible).map((item) => item.label).join(" / ")}</p></div>;
  return <div className={`${canvasClass} min-h-[640px] overflow-hidden bg-white shadow-[0_12px_40px_rgba(16,24,40,0.12)]`}>{sortedSections(document).filter((section) => section.visible).map((section) => <PreviewSection assets={assets} key={section.id} mode={mode} pageKey={pageKey} products={products} section={section} selected={section.id === selectedSectionId} />)}</div>;
}

function PreviewSection({ assets, mode, pageKey, products, section, selected }: { assets: Map<string, AssetOption>; mode: "desktop" | "mobile"; pageKey: string; products: ProductOption[]; section: SiteSection; selected: boolean }) {
  const outline = selected ? "ring-2 ring-inset ring-[#155eef]" : "";
  if (section.type === "hero") {
    const asset = section.mediaAssetId ? assets.get(section.mediaAssetId) : null;
    const preorder = pageKey === "home" ? products.find((product) => product.status === "ACTIVE" && product.saleMode === "PREORDER") : null;
    const posters = preorder ? resolveProductHeroPosterImages(preorder.images) : [];
    const previewImageUrl = posters[0] || asset?.url || null;
    return <section className={outline}><div className={`grid min-h-[320px] bg-[#eef0f3] ${mode === "desktop" ? "grid-cols-2" : "grid-cols-1"}`}><div className="grid content-center p-8"><p className="text-xs font-black">{section.eyebrow}</p><h2 className="mt-3 text-3xl font-black leading-tight">{section.title}</h2><p className="mt-3 text-sm font-bold leading-6 text-[#475467]">{section.body}</p>{section.features.length ? <p className="mt-4 text-xs font-black">{section.features.join(" · ")}</p> : null}<span className="mt-5 w-fit bg-[#075bd8] px-5 py-3 text-xs font-black text-white">{section.action.label}</span></div><div className="relative min-h-[260px]">{previewImageUrl ? <Image alt={preorder ? `${preorder.name} 首页轮播预览` : asset?.altText || asset?.name || section.title} className="object-contain" fill sizes={mode === "desktop" ? "490px" : "390px"} src={previewImageUrl} /> : <div className="grid h-full place-items-center text-xs font-bold text-[#98a2b3]">未选择主图</div>}</div></div>{preorder ? <div className="bg-black px-6 py-4 text-xs font-bold text-white">商品数据自动同步：{formatProductPrice(preorder)} · 当前预售 · 右侧轮播共 {posters.length} 张</div> : null}</section>;
  }
  if (section.type === "categoryGrid") return <section className={`p-6 ${outline}`}><h2 className="text-xl font-black">{section.title}</h2><div className={`mt-4 grid gap-3 ${mode === "desktop" ? "grid-cols-4" : "grid-cols-2"}`}>{section.items.map((item) => { const asset = item.mediaAssetId ? assets.get(item.mediaAssetId) : null; return <div className="border border-[#e4e7ec]" key={item.id}><div className="relative aspect-[4/3] bg-[#f2f4f7]">{asset ? <Image alt={asset.altText || asset.name} className="object-cover" fill sizes={mode === "desktop" ? "220px" : "170px"} src={asset.url} /> : null}</div><div className="p-3"><strong className="text-sm">{item.title}</strong><p className="mt-1 text-xs font-bold text-[#667085]">{item.body}</p></div></div>; })}</div></section>;
  if (section.type === "productGrid") { const selectedProducts = section.productIds.map((id) => products.find((product) => product.id === id)).filter((product): product is ProductOption => product !== undefined && isActiveSaleProduct(product)); return <section className={`p-6 ${outline}`}><div className="flex justify-between"><h2 className="text-xl font-black">{section.title}</h2><span className="text-xs font-black text-[#155eef]">{section.action.label}</span></div><div className={`mt-4 grid gap-3 ${mode === "desktop" ? "grid-cols-4" : "grid-cols-2"}`}>{selectedProducts.map((product) => <div key={product.id}><div className="relative aspect-square bg-[#f2f4f7]">{product.image ? <Image alt={product.name} className="object-cover" fill sizes={mode === "desktop" ? "220px" : "170px"} src={product.image} /> : null}</div><strong className="mt-2 block text-xs">{product.name}</strong><p className="mt-1 text-xs font-black">{formatProductPrice(product)}</p></div>)}{!selectedProducts.length ? <p className="col-span-full py-8 text-center text-xs font-bold text-[#98a2b3]">请关联预售或已发售商品</p> : null}</div></section>; }
  const columns = mode === "mobile" || section.columns === 1 ? "grid-cols-1" : section.columns === 2 ? "grid-cols-2" : "grid-cols-3";
  return <section className={`p-6 ${outline}`}>{section.title ? <h2 className="text-xl font-black">{section.title}</h2> : null}<div className={`grid gap-3 ${section.title ? "mt-4" : ""} ${columns}`}>{section.items.map((item) => <div className="border border-[#e4e7ec] p-4" key={item.id}><strong className="text-base">{item.title}</strong><p className="mt-2 whitespace-pre-line text-xs font-bold leading-6 text-[#667085]">{item.body}</p>{item.link ? <span className="mt-3 block text-xs font-black text-[#155eef]">{item.link.label}</span> : null}</div>)}</div></section>;
}

function Field({ label, onChange, placeholder, value }: { label: string; onChange: (value: string) => void; placeholder?: string; value: string }) { return <label className="vk-field"><span>{label}</span><input onChange={(event) => onChange(event.target.value)} placeholder={placeholder} value={value} /></label>; }
function TextArea({ label, onChange, rows, value }: { label: string; onChange: (value: string) => void; rows: number; value: string }) { return <label className="vk-field"><span>{label}</span><textarea onChange={(event) => onChange(event.target.value)} rows={rows} value={value} /></label>; }
function PageSelect({ label, onChange, pages, value }: { label: string; onChange: (value: string) => void; pages: PageOption[]; value: string }) { return <label className="vk-field"><span>{label}</span><select onChange={(event) => onChange(event.target.value)} value={value}>{pages.map((page) => <option key={page.key} value={page.key}>{page.name} · {page.path}</option>)}</select></label>; }
function AssetSelect({ assets, label, onChange, value }: { assets: AssetOption[]; label: string; onChange: (value: string) => void; value: string }) { return <label className="vk-field"><span>从素材库选择：{label}</span><select onChange={(event) => onChange(event.target.value)} value={value}><option value="">不使用图片</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select></label>; }
function IconButton({ children, disabled, label, onClick }: { children: React.ReactNode; disabled?: boolean; label: string; onClick: () => void }) { return <button aria-label={label} className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] text-[#667085] hover:bg-white hover:text-[#101828] disabled:opacity-30" disabled={disabled} onClick={onClick} title={label} type="button">{children}</button>; }
function PreviewEmpty({ body, title }: { body: string; title: string }) { return <div className="grid min-h-[420px] place-items-center p-8 text-center"><div><h2 className="text-2xl font-black">{title}</h2><p className="mt-3 max-w-md text-sm font-bold leading-7 text-[#667085]">{body}</p></div></div>; }

function sortedSections(document: PageDocument) { return [...document.sections].sort((a, b) => a.sortOrder - b.sortOrder); }
function getSectionLabel(section: SiteSection) { if (section.type === "hero") return `主视觉 · ${section.title}`; if (section.type === "categoryGrid") return `分类导航 · ${section.title}`; if (section.type === "productGrid") return `商品推荐 · ${section.title}`; return `${section.type === "contentGrid" ? "内容" : "卡片"} · ${section.title || "未命名"}`; }
function moveItem<T>(items: T[], index: number, direction: -1 | 1) { const next = [...items]; const target = index + direction; if (target < 0 || target >= next.length) return next; [next[index], next[target]] = [next[target], next[index]]; return next; }
function updateFooterColumn(document: FooterDocument, onChange: (document: SiteDocument) => void, columnIndex: number, value: Partial<FooterDocument["columns"][number]>) { onChange({ ...document, columns: document.columns.map((column, index) => index === columnIndex ? { ...column, ...value } : column) }); }
function updateFooterLink(document: FooterDocument, onChange: (document: SiteDocument) => void, columnIndex: number, linkIndex: number, value: Partial<PageLink>) { const column = document.columns[columnIndex]; updateFooterColumn(document, onChange, columnIndex, { links: column.links.map((link, index) => index === linkIndex ? { ...link, ...value } : link) }); }
function updateSocial(document: FooterDocument, onChange: (document: SiteDocument) => void, index: number, value: Partial<FooterDocument["socialChannels"][number]>) { onChange({ ...document, socialChannels: document.socialChannels.map((channel, channelIndex) => channelIndex === index ? { ...channel, ...value } : channel) }); }
function getDifferenceSummary({ document, ogImageUrl, publishedVersion, seoDescription, seoTitle }: { document: SiteDocument; ogImageUrl: string; publishedVersion: VersionOption | null; seoDescription: string; seoTitle: string }) {
  if (!publishedVersion) return "这个页面还没有线上版本，发布前请先预览草稿。";
  const changes: string[] = [];
  if (JSON.stringify(document) !== JSON.stringify(publishedVersion.document)) {
    if (document.documentType === "page" && publishedVersion.document.documentType === "page" && document.sections.length !== publishedVersion.document.sections.length) {
      changes.push(`板块数量 ${publishedVersion.document.sections.length}→${document.sections.length}`);
    } else {
      changes.push("页面内容");
    }
  }
  if (seoTitle !== (publishedVersion.seoTitle ?? "")) changes.push("页面标题");
  if (seoDescription !== (publishedVersion.seoDescription ?? "")) changes.push("页面描述");
  if (ogImageUrl !== (publishedVersion.ogImageUrl ?? "")) changes.push("分享图");
  return changes.length ? `待发布变更：${changes.join("、")}` : "草稿与线上版本一致。";
}
function formatProductPrice(product: ProductOption) { const prices = product.skus.filter((sku) => sku.status === "ACTIVE").map((sku) => sku.priceCents); if (!prices.length) return "未定价"; const min = Math.min(...prices); const max = Math.max(...prices); return min === max ? `¥${(min / 100).toFixed(2)}` : `¥${(min / 100).toFixed(2)} - ¥${(max / 100).toFixed(2)}`; }
function formatDate(value: string) { return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function getErrorMessage(code?: string) { const messages: Record<string, string> = { ADMIN_UNAUTHORIZED: "后台登录已失效，请重新登录。", INVALID_SITE_DRAFT: "草稿内容不完整，请检查必填文字。", SITE_LINK_PAGE_NOT_FOUND: "某个按钮或菜单没有关联有效页面。", SITE_MEDIA_NOT_FOUND: "草稿引用的图片已归档，请重新选择素材。", SITE_PRODUCT_NOT_FOUND: "草稿引用的商品不存在，请重新选择。", SITE_DOCUMENT_TYPE_MISMATCH: "页面类型与内容不匹配。" }; return messages[code ?? ""] ?? "操作失败，请刷新页面后重试。"; }

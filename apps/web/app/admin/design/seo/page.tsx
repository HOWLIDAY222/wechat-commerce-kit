import Link from "next/link";
import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { listSiteBuilderPages } from "@/lib/services/site-builder-service";

export const dynamic = "force-dynamic";
export const metadata = { title: "SEO | MerchantKit 后台" };

export default async function DesignSeoPage() {
  const pages = (await listSiteBuilderPages()).filter((page) => page.path);
  const covered = pages.filter((page) => page.published?.seoTitle && page.published?.seoDescription);
  return (
    <AdminFrame active="design-seo" metrics={[
      { label: "公开页面", value: pages.length.toString(), hint: "可被导航或搜索发现" },
      { label: "标题与描述完整", value: `${covered.length}/${pages.length}`, hint: "读取已发布版本" },
    ]} title="SEO" subtitle="SEO 与页面草稿一起维护、预览和发布，不再暴露 key/value 或数据库字段。">
      <section className="overflow-hidden border border-[#d8dde5] bg-white">
        <div className="grid min-w-[920px] grid-cols-[0.9fr_1.2fr_1.5fr_100px_auto] gap-4 border-b border-[#e4e7ec] bg-[#f8fafc] px-5 py-3 text-xs font-black text-[#697386]"><span>页面</span><span>标题</span><span>描述</span><span>状态</span><span>操作</span></div>
        <div className="divide-y divide-[#eef1f5] overflow-x-auto">{pages.map((page) => <div className="grid min-w-[920px] grid-cols-[0.9fr_1.2fr_1.5fr_100px_auto] items-center gap-4 px-5 py-4 text-xs" key={page.id}><div><strong>{page.name}</strong><p className="mt-1 font-bold text-[#697386]">{page.path}</p></div><p className="font-black">{page.published?.seoTitle || "未填写"}</p><p className="line-clamp-2 font-bold leading-5 text-[#697386]">{page.published?.seoDescription || "未填写"}</p><span className={page.published?.seoTitle && page.published?.seoDescription ? "font-black text-[#027a48]" : "font-black text-[#b54708]"}>{page.published?.seoTitle && page.published?.seoDescription ? "完整" : "待补充"}</span><Link className="vk-button vk-button-light" href={`/admin/design/pages/${page.key}`}>编辑草稿</Link></div>)}</div>
      </section>
    </AdminFrame>
  );
}

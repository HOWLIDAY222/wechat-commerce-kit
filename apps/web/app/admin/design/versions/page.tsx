import Link from "next/link";
import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { listSiteBuilderPages } from "@/lib/services/site-builder-service";

export const dynamic = "force-dynamic";
export const metadata = { title: "发布与版本 | MerchantKit 后台" };

export default async function VersionsPage() {
  const pages = await listSiteBuilderPages();
  return (
    <AdminFrame active="design-versions" metrics={[
      { label: "已发布页面", value: pages.filter((page) => page.published).length.toString(), hint: "前台正在读取" },
      { label: "草稿页面", value: pages.filter((page) => page.draft).length.toString(), hint: "等待预览或发布" },
      { label: "历史版本", value: pages.reduce((sum, page) => sum + page.versions.filter((version) => version.status === "ARCHIVED").length, 0).toString(), hint: "可恢复到草稿" },
    ]} title="发布与版本" subtitle="每个页面独立保存草稿、预览和发布。历史版本只能恢复到草稿，不能绕过发布流程直接覆盖前台。">
      <section className="overflow-hidden border border-[#d8dde5] bg-white">
        <div className="grid min-w-[860px] grid-cols-[1fr_120px_160px_140px_auto] gap-4 border-b border-[#e4e7ec] bg-[#f8fafc] px-5 py-3 text-xs font-black text-[#697386]"><span>页面</span><span>草稿</span><span>线上版本</span><span>历史版本</span><span>操作</span></div>
        <div className="divide-y divide-[#eef1f5] overflow-x-auto">
          {pages.map((page) => <div className="grid min-w-[860px] grid-cols-[1fr_120px_160px_140px_auto] items-center gap-4 px-5 py-4 text-xs" key={page.id}><div><strong className="text-sm">{page.name}</strong><p className="mt-1 font-bold text-[#697386]">{page.path || "全站区域"}</p></div><span className="font-black">{page.draft ? `v${page.draft.versionNumber}` : "无"}</span><span className="font-black text-[#027a48]">{page.published ? `v${page.published.versionNumber}` : "未发布"}</span><span className="font-bold text-[#697386]">{page.versions.filter((version) => version.status === "ARCHIVED").length} 个</span><Link className="vk-button vk-button-light" href={`/admin/design/pages/${page.key}`}>查看与恢复</Link></div>)}
        </div>
      </section>
    </AdminFrame>
  );
}

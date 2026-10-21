import Link from "next/link";
import { redirect } from "next/navigation";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { listCareerApplications } from "@/lib/services/career-application-service";
import { getTalentRole } from "@/lib/careers-content";
import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { writeAdminAudit } from "@/lib/services/admin-ops-service";
import { setReviewStatus } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "人才储备", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const session = await readCurrentAdminSession();
  if (!session) redirect("/admin/login?returnTo=/admin/careers");
  if (session.role !== "owner") return <AdminFrame active="careers" metrics={[]} title="人才储备"><p>申请资料仅限负责人查看。</p></AdminFrame>;
  const page = Math.max(1, Math.min(100000, Math.floor(Number((await searchParams).page) || 1)));
  const { rows, total, pending } = await listCareerApplications(page);
  await writeAdminAudit(session.userId, "admin.careers.list.viewed", "career_application", "overview", { page });
  return <AdminFrame active="careers" title="人才储备" subtitle="查看网站自荐、简历与作品集。仅负责人可访问。" metrics={[{ label: "自荐总数", value: String(total) }, { label: "待阅", value: String(pending) }]}>
    <div className="grid gap-5">{rows.map(row => <article className="rounded-lg border border-gray-200 bg-white p-5" key={row.id}>
      <div className="flex flex-wrap items-center justify-between gap-4"><h2 className="text-xl font-bold">{row.details.name} · {getTalentRole(row.details.role)?.zh ?? "开放自荐"}</h2><span>{row.status === "NEW" ? "待阅" : "已阅"}</span></div>
      <dl className="mt-5 grid gap-4 text-sm md:grid-cols-2"><div><dt className="text-gray-500">联系方式</dt><dd className="break-all mt-1">{row.details.contact}</dd></div><div><dt className="text-gray-500">可开始时间</dt><dd className="mt-1">{row.details.availability}</dd></div><div className="md:col-span-2"><dt className="text-gray-500">个人简介</dt><dd className="mt-1 whitespace-pre-wrap leading-7">{row.details.intro}</dd></div></dl>
      <div className="mt-5 flex flex-wrap gap-5">{row.resume_name && <a className="underline" href={`/api/admin/careers/${row.id}/resume`}>下载 PDF 附件</a>}{row.images.map(image => <a className="underline" key={image.position} href={`/api/admin/careers/${row.id}/images/${image.position}`}>下载作品图片 {image.position + 1}</a>)}{row.details.portfolio && <a className="underline break-all" href={row.details.portfolio} target="_blank" rel="noopener noreferrer nofollow">打开作品集链接 ↗</a>}</div>
      <p className="mt-5 text-xs text-gray-500">{row.created_at.toISOString().replace("T", " ").slice(0, 16)} UTC · 回执 {row.id} · 已同意人才储备资料使用</p>
      <form action={setReviewStatus} className="mt-4"><input type="hidden" name="id" value={row.id} /><input type="hidden" name="status" value={row.status === "NEW" ? "REVIEWED" : "NEW"} /><button className="border border-gray-400 px-4 py-2" type="submit">{row.status === "NEW" ? "标记已阅" : "恢复待阅"}</button></form>
    </article>)}{!rows.length && <p className="bg-white p-10 text-center text-gray-500">暂无自荐资料。</p>}</div>
    <nav className="mt-6 flex gap-6">{page > 1 && <Link href={`/admin/careers?page=${page - 1}`}>上一页</Link>}<span>第 {page} 页</span>{page * 25 < total && <Link href={`/admin/careers?page=${page + 1}`}>下一页</Link>}</nav>
  </AdminFrame>;
}

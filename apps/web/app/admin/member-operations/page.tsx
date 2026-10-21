import { redirect } from "next/navigation";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { MemberOperationsPanel } from "@/app/admin/member-operations/panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "会员任务与社区 | MerchantKit Admin" };
export default async function MemberOperationsPage() {
  if (!await readCurrentAdminSession()) redirect("/admin/login");
  return <AdminFrame active="membership" title="会员任务与社区" subtitle="配置任务、问卷和积分抽奖，核验学生认证与外部任务，审核社区内容。" metrics={[]}><MemberOperationsPanel /></AdminFrame>;
}

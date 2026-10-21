import SubscriptionAdmin from "./subscription-admin";
import { redirect } from "next/navigation";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { AdminFrame } from "@/app/admin/_components/admin-frame";
export const dynamic = "force-dynamic";
export const metadata = { title: "微信订阅提醒 | MerchantKit Admin" };
export default async function SubscriptionPage() {
  if (!await readCurrentAdminSession()) redirect("/admin/login");
  return <AdminFrame active="membership" title="微信订阅提醒" subtitle="管理会员主动订阅的品牌动态、订单与售后通知。" metrics={[]}><SubscriptionAdmin /></AdminFrame>;
}

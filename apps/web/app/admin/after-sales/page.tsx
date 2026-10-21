import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { fetchAdminJson } from "@/app/admin/_lib/admin-page-fetch";
import { AfterSalesAdminTable } from "@/app/admin/after-sales/after-sales-admin-table";
import { type AfterSalesStatus, type AfterSalesType } from "@/lib/after-sales/state-machine";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "售后管理 | MerchantKit Admin",
};

type AdminAfterSalesItem = {
  orderItemId: string;
  productName: string;
  color: string;
  size: string;
  quantity: number;
  refundAmountCents: number;
};

type AdminAfterSales = {
  id: string;
  afterSalesNo: string;
  userId: string;
  orderNo: string;
  type: AfterSalesType;
  reason: string;
  description: string;
  status: AfterSalesStatus;
  items: AdminAfterSalesItem[];
  imageUrls: string[];
  refundAmountCents: number;
  rejectReason?: string;
  createdAt: string;
  updatedAt: string;
};

type AfterSalesResponse = {
  ok: boolean;
  afterSales: AdminAfterSales[];
  audit: {
    actorId: string;
    action: string;
    createdAt: string;
  };
};

const terminalStatuses = new Set<AfterSalesStatus>(["rejected", "completed", "cancelled"]);

export default async function AdminAfterSalesPage() {
  const { afterSales } = await fetchAdminJson<AfterSalesResponse>("/api/admin/after-sales");
  const openCount = afterSales.filter((request) => !terminalStatuses.has(request.status)).length;
  const refundCount = afterSales.filter((request) => request.type === "return_refund" || request.type === "refund_only").length;
  const returnInTransitCount = afterSales.filter((request) => request.status === "return_in_transit").length;
  const completedCount = afterSales.filter((request) => terminalStatuses.has(request.status)).length;
  const frameMetrics = [
    { label: "售后申请总数", value: afterSales.length.toString(), hint: `退款类 ${refundCount}`, tone: "blue" as const },
    { label: "待处理", value: openCount.toString(), hint: "当前仍处于非终态", tone: "orange" as const },
    { label: "退货途中", value: returnInTransitCount.toString(), hint: "等待退货签收", tone: "purple" as const },
    { label: "已结束", value: completedCount.toString(), hint: "已完成、驳回或取消", tone: "green" as const },
  ];

  return (
    <AdminFrame active="after-sales" metrics={frameMetrics} title="售后管理" subtitle="处理退货、退款、换货、补发等售后请求，提升客户满意度。">
      <AfterSalesAdminTable afterSales={afterSales} />
    </AdminFrame>
  );
}

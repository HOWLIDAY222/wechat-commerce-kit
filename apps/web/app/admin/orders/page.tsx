import Link from 'next/link';
import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { fetchAdminJson } from "@/app/admin/_lib/admin-page-fetch";
import { OrderAdminTable } from "./order-admin-table";
import { needsWeChatShippingSync } from "@/lib/commerce/wechat-shipping-status";
import { fulfillmentActions } from "@/lib/commerce/admin-operations";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "订单管理 | MerchantKit Admin",
  description: "MerchantKit 后台订单管理，查看订单、支付、履约、售后和退款状态。",
};

type AdminOrderItem = {
  id: string;
  productName: string;
  productCode?: string;
  color: string;
  size: string;
  quantity: number;
  unitPriceCents: number;
};

type AdminOrder = {
  pickup?: { status: string; name: string; address: string; hours: string; phone: string; collectedAt?: string | null; blocked?: boolean } | null;
  id: string;
  orderNo: string;
  userId: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  customerName: string;
  customerPhone: string;
  addressSnapshot: string;
  subtotalCents: number;
  payableAmountCents: number;
  currency: string;
  items: AdminOrderItem[];
  paymentIntents?: Array<{ provider?: string; status?: string }>;
  afterSalesRequests?: Array<unknown>;
  refunds?: Array<unknown>;
  shipments?: Array<{
    id: string;
    trackingCompany?: string | null;
    trackingNo?: string | null;
    status: string;
    wechatSyncedAt?: string | null;
    wechatSyncError?: string | null;
  }>;
  audit?: Array<unknown>;
  createdAt: string;
  updatedAt: string;
};

type OrdersResponse = {
  ok: boolean;
  orders: AdminOrder[];
  audit: {
    actorId: string;
    action: string;
    createdAt: string;
  };
};

export default async function AdminOrdersPage() {
  const { orders } = await fetchAdminJson<OrdersResponse>("/api/admin/orders");
  const paidCount = orders.filter((order) => isPaid(order.paymentStatus)).length;
  const pendingShipment = orders.filter((order) => fulfillmentActions(order).ship).length;
  const paidAmountCents = orders.reduce((sum, order) => (isPaid(order.paymentStatus) ? sum + order.payableAmountCents : sum), 0);
  const frameMetrics = [
    { label: "订单总数", value: orders.length.toString(), hint: `已支付 ${paidCount} 笔`, tone: "blue" as const },
    { label: "待发货", value: pendingShipment.toString(), hint: "已支付且尚未履约", tone: "orange" as const },
    { label: "微信同步待处理", value: orders.filter(needsWeChatShippingSync).length.toString(), hint: "已发货、待报送或报送异常", tone: "purple" as const },
    { label: "已支付金额", value: formatMoney(paidAmountCents), hint: `已支付 ${paidCount} 笔`, tone: "green" as const },
  ];

  return (
    <AdminFrame active="orders" metrics={frameMetrics} title="订单与发货" subtitle="先筛选订单，再进入详情发货；物流自动同步微信，同步异常会集中显示。">
      <div className="flex justify-end"><Link className="vk-button vk-button-light min-h-11 px-5" href="/admin/settings#pickup">自提设置</Link></div>
      <OrderAdminTable orders={orders} />
    </AdminFrame>
  );
}

function isPaid(status: string) {
  return status.toUpperCase() === "PAID";
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(cents / 100);
}

import Link from "next/link";
import { fetchAccountJson } from "@/app/account/_lib/account-page-fetch";
import { AfterSalesRequestForm } from "@/app/account/orders/[id]/after-sales/after-sales-request-form";
import { AccountShell } from "@/components/storefront/account-shell";

type OrderAfterSalesProps = {
  params: Promise<{ id: string }>;
};

export const metadata = {
  title: "申请售后",
  description: "从 MerchantKit 订单详情发起售后申请，选择订单商品、售后类型、退款金额和问题说明。",
};

type AfterSalesOrder = {
  items: Array<{
    color: string;
    id: string;
    productName: string;
    quantity: number;
    size: string;
    unitPriceCents: number;
    discountShareCents: number;
  }>;
  orderNo: string;
  paymentStatus: string;
  fulfillmentStatus: string;
};

export default async function OrderAfterSalesPage({ params }: OrderAfterSalesProps) {
  const { id } = await params;
  const { order } = await fetchAccountJson<{ ok: boolean; order: AfterSalesOrder }>(`/api/account/orders/${encodeURIComponent(id)}`);
  if (!order) {
    return (
      <AccountShell active="after-sales" description={`没有找到属于当前账户的订单 ${id}。`} eyebrow="申请售后" title="订单不存在">
        <Link className="vk-button vk-button-light" href="/account/orders">返回订单列表</Link>
      </AccountShell>
    );
  }

  const canApply = order.paymentStatus.toLowerCase() === "paid";

  return (
    <AccountShell
      active="after-sales"
      actions={<Link className="vk-button vk-button-light" href={`/account/orders/${encodeURIComponent(order.orderNo)}`}>返回订单详情</Link>}
      description={`订单 ${order.orderNo} 的售后申请会限制为当前订单商品；未签收前仅可申请仅退款。`}
      eyebrow="申请售后"
      title="申请售后"
    >
      <AfterSalesRequestForm canApply={canApply} fulfillmentStatus={order.fulfillmentStatus} items={order.items} orderNo={order.orderNo} />
    </AccountShell>
  );
}

import Link from "next/link";
import { isDomesticStorefront } from "@/lib/server/storefront-market";
import { fetchAccountJson } from "@/app/account/_lib/account-page-fetch";
import { OrderCancelButton } from "@/app/account/orders/order-cancel-button";
import { OrderPayButton } from "@/app/account/orders/order-pay-button";
import { AccountShell } from "@/components/storefront/account-shell";
import { EmptyState, InfoPanel, formatMoney } from "@/components/storefront/storefront-ui";
import {
  formatFulfillmentStatusLabel,
  formatOrderStatusLabel,
  formatPaymentStatusLabel,
  normalizeStatusKey,
} from "@/lib/display-labels";

export const metadata = {
  title: "我的订单",
  description: "查看 MerchantKit 账户订单列表、订单状态、支付状态、金额和售后入口。",
};

type OrderItem = {
  productName: string;
  quantity: number;
  unitPriceCents: number;
  discountShareCents?: number;
};

type AccountOrder = {
  createdAt: Date | string;
  fulfillmentStatus: string;
  items: OrderItem[];
  orderNo: string;
  payableAmountCents: number;
  paymentStatus: string;
  status: string;
};

export default async function AccountOrdersPage() {
  const domestic = await isDomesticStorefront();
  const { orders } = await fetchAccountJson<{ ok: boolean; orders: AccountOrder[] }>("/api/account/orders");

  return (
    <AccountShell
      active="orders"
      actions={<Link className="vk-button vk-button-dark" href="/shop">继续选购</Link>}
      description="查看付款、配送和售后进度。"
      eyebrow="订单列表"
      title="我的订单"
    >
      <section className="grid gap-5">
        {orders.map((order) => {
          const canPay = canPayOrder(order);
          const canCancel = canCancelOrder(order);
          const canApplyAfterSales = canApplyAfterSalesForOrder(order);
          return (
            <InfoPanel className="p-5" key={order.orderNo}>
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_240px]">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="break-all text-2xl font-black">{order.orderNo}</h2>
                    <StatusPill label={`订单：${formatOrderStatusLabel(order.status)}`} />
                    <StatusPill label={`支付：${formatPaymentStatusLabel(order.paymentStatus)}`} />
                    <StatusPill label={`履约：${formatFulfillmentStatusLabel(order.fulfillmentStatus)}`} />
                  </div>
                  <p className="mt-2 text-sm font-bold text-muted">创建时间：{formatDate(order.createdAt)}</p>
                  <div className="mt-5 grid gap-3">
                    {order.items.map((item, index) => (
                      <div className="flex justify-between gap-4 border-t border-line pt-3 text-sm" key={`${order.orderNo}-${item.productName}-${index}`}>
                        <span className="font-bold text-muted">
                          {item.productName} x {item.quantity}
                        </span>
                        <span className="text-right">{formatMoney(item.unitPriceCents * item.quantity - (item.discountShareCents ?? 0))}{item.discountShareCents === undefined ? <small className="block text-muted">优惠前</small> : null}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="grid content-between gap-4">
                  <div>
                    <p className="text-sm font-bold text-muted">应付</p>
                    <p className="mt-1 text-3xl font-black">{formatMoney(order.payableAmountCents)}</p>
                  </div>
                  <div className="grid gap-3">
                    <Link className="vk-button vk-button-light" href={`/account/orders/${encodeURIComponent(order.orderNo)}`}>查看详情</Link>
                    {canPay ? <OrderPayButton amountCents={order.payableAmountCents} disabled={false} orderNo={order.orderNo} domestic={domestic} /> : null}
                    {canCancel ? <OrderCancelButton orderNo={order.orderNo} /> : null}
                    {canApplyAfterSales ? (
                      <Link className="vk-button vk-button-dark" href={`/account/orders/${encodeURIComponent(order.orderNo)}/after-sales`}>
                        {getAfterSalesActionLabel(order)}
                      </Link>
                    ) : null}
                  </div>
                </div>
              </div>
            </InfoPanel>
          );
        })}
        {orders.length === 0 ? <EmptyState actionHref="/shop" actionLabel="去选购" title="还没有订单" body="下单后可在这里查看支付、配送和售后进度。" /> : null}
      </section>
    </AccountShell>
  );
}

function StatusPill({ label }: { label: string }) {
  return <span className="rounded-full border border-line px-3 py-1 text-xs font-black">{label}</span>;
}

function canPayOrder(order: AccountOrder) {
  return ["NOT_STARTED", "PENDING"].includes(normalizeStatusKey(order.paymentStatus)) && !["CANCELLED", "CLOSED"].includes(normalizeStatusKey(order.status));
}

function canCancelOrder(order: AccountOrder) {
  return normalizeStatusKey(order.paymentStatus) !== "PAID" && !["CANCELLED", "CLOSED"].includes(normalizeStatusKey(order.status));
}

function canApplyAfterSalesForOrder(order: AccountOrder) {
  return normalizeStatusKey(order.paymentStatus) === "PAID" && !["CANCELLED", "CLOSED"].includes(normalizeStatusKey(order.status));
}

function getAfterSalesActionLabel(order: AccountOrder) {
  return ["PENDING", "PROCESSING"].includes(normalizeStatusKey(order.fulfillmentStatus)) ? "申请取消并退款" : "申请售后";
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

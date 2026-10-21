import { RefundSummaryPanel } from "@/components/storefront/refund-summary-panel";
import type { OrderRefundSummary } from "@/lib/services/wechat-refund-read-model";
import Link from "next/link";
import { isDomesticStorefront } from "@/lib/server/storefront-market";
import { fetchAccountJson } from "@/app/account/_lib/account-page-fetch";
import { OrderCancelButton } from "@/app/account/orders/order-cancel-button";
import { OrderPayButton } from "@/app/account/orders/order-pay-button";
import { AccountShell } from "@/components/storefront/account-shell";
import { InfoPanel, formatMoney } from "@/components/storefront/storefront-ui";
import {
  formatOrderFulfillmentStatusLabel,
  formatOrderStatusLabel,
  formatPaymentStatusLabel,
  normalizeStatusKey,
} from "@/lib/display-labels";

type AccountOrderDetailProps = {
  params: Promise<{ id: string }>;
};

export const metadata = {
  title: "订单详情",
  description: "查看 MerchantKit 账户订单详情、商品快照、收货信息、支付状态、履约状态和售后入口。",
};

type DetailItem = {
  color: string;
  id: string;
  productName: string;
  quantity: number;
  size: string;
  unitPriceCents: number;
  discountShareCents?: number;
};

type DetailOrder = {
  refundSummary?: OrderRefundSummary;
  addressSnapshot: string;
  createdAt: Date | string;
  customerName: string;
  customerPhone: string;
  fulfillmentStatus: string;
  items: DetailItem[];
  orderNo: string;
  discountCents: number;
  payableAmountCents: number;
  paymentStatus: string;
  status: string;
  subtotalCents: number;
  shippingFeeCents: number;
};

export default async function AccountOrderDetailPage({ params }: AccountOrderDetailProps) {
  const domestic = await isDomesticStorefront();
  const { id } = await params;
  const { order } = await fetchAccountJson<{ ok: boolean; order: DetailOrder }>(`/api/account/orders/${encodeURIComponent(id)}`);
  if (!order) {
    return (
      <AccountShell active="orders" description={`没有找到属于当前账户的订单 ${id}。`} eyebrow="订单详情" title="订单不存在">
        <Link className="vk-button vk-button-light" href="/account/orders">返回订单列表</Link>
      </AccountShell>
    );
  }

  const isFullyRefunded = normalizeStatusKey(order.paymentStatus) === "REFUNDED" || (order.refundSummary?.state === "REFUNDED" && order.refundSummary.fullyRefunded === true);
  const canPay = !isFullyRefunded && canPayOrder(order);
  const canCancel = !isFullyRefunded && normalizeStatusKey(order.paymentStatus) !== "PAID" && !["CANCELLED", "CLOSED"].includes(normalizeStatusKey(order.status));
  const canApplyAfterSales = !isFullyRefunded && normalizeStatusKey(order.paymentStatus) === "PAID" && !["CANCELLED", "CLOSED"].includes(normalizeStatusKey(order.status));

  return (
    <AccountShell
      active="orders"
      actions={<Link className="vk-button vk-button-light" href="/account/orders">返回订单列表</Link>}
      description={`创建时间 ${formatDate(order.createdAt)}，可在此跟踪支付、配送和售后入口。`}
      eyebrow="订单详情"
      title={`订单 ${order.orderNo}`}
    >
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-5">
          <InfoPanel className="p-5">
            <h2 className="text-2xl font-black">订单商品</h2>
            <div className="mt-4 grid gap-3">
              {order.items.map((item) => (
                <div className="grid gap-2 border-t border-line pt-4 md:grid-cols-[1fr_auto]" key={item.id}>
                  <div>
                    <p className="text-lg font-black">{item.productName}</p>
                    <p className="mt-1 text-sm font-bold text-muted">
                      {item.color} / {item.size} x {item.quantity}
                    </p>
                  </div>
                  <div className="text-right"><p className="font-black">{formatMoney(item.unitPriceCents * item.quantity - (item.discountShareCents ?? 0))}</p>{item.discountShareCents === undefined && order.discountCents > 0 ? <p className="mt-1 text-xs text-muted">优惠前金额，优惠见订单汇总</p> : (item.discountShareCents ?? 0) > 0 ? <p className="mt-1 text-xs font-bold text-[#067647]">已优惠 {formatMoney(item.discountShareCents!)}</p> : null}</div>
                </div>
              ))}
            </div>
          </InfoPanel>
          <InfoPanel className="p-5">
            <h2 className="text-2xl font-black">收货信息</h2>
            <p className="mt-3 font-bold">{order.customerName} / {maskPhone(order.customerPhone)}</p>
            <p className="mt-2 text-sm font-bold leading-6 text-muted">{order.addressSnapshot}</p>
          </InfoPanel>
        </div>
        <aside className="h-fit">
          <InfoPanel className="p-6">
            <h2 className="text-xl font-black">订单状态</h2>
            <div className="mt-5 grid gap-3 text-sm font-bold">
              <Row label="订单状态" value={normalizeStatusKey(order.status) === "CLOSED" ? "订单已结束" : isFullyRefunded ? "已退款" : formatOrderStatusLabel(order.status)} />
              <Row label="支付状态" value={formatPaymentStatusLabel(isFullyRefunded ? "REFUNDED" : order.paymentStatus)} />
              <Row label="履约状态" value={formatOrderFulfillmentStatusLabel({ ...order, paymentStatus: isFullyRefunded ? "REFUNDED" : order.paymentStatus })} />
              <Row label="商品小计" value={formatMoney(order.subtotalCents)} />
              {order.discountCents > 0 ? <Row label="预售组合优惠" value={`-${formatMoney(order.discountCents)}`} /> : null}
              <Row label="配送费用" value={formatMoney(order.shippingFeeCents)} />
              <Row label="应付金额" value={formatMoney(order.payableAmountCents)} strong />
            </div>
            <RefundSummaryPanel summary={order.refundSummary} />
            <div className="mt-6 grid gap-3">
              {canPay ? <OrderPayButton amountCents={order.payableAmountCents} disabled={false} orderNo={order.orderNo} domestic={domestic} /> : null}
              {canCancel ? <OrderCancelButton orderNo={order.orderNo} /> : null}
              {canApplyAfterSales ? (
                <Link className="vk-button vk-button-dark" href={`/account/orders/${encodeURIComponent(order.orderNo)}/after-sales`}>
                  {getAfterSalesActionLabel(order)}
                </Link>
              ) : null}
            </div>
          </InfoPanel>
        </aside>
      </section>
    </AccountShell>
  );
}

function Row({ label, strong, value }: { label: string; strong?: boolean; value: string }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "border-t border-line pt-3 text-lg font-black" : ""}`}>
      <span className="text-muted">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function canPayOrder(order: DetailOrder) {
  return ["NOT_STARTED", "PENDING"].includes(normalizeStatusKey(order.paymentStatus)) && !["CANCELLED", "CLOSED"].includes(normalizeStatusKey(order.status));
}

function getAfterSalesActionLabel(order: DetailOrder) {
  return ["PENDING", "PROCESSING"].includes(normalizeStatusKey(order.fulfillmentStatus)) ? "申请取消并退款" : "申请售后";
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function maskPhone(phone: string) {
  return phone.replace(/^(\d{3})\d+(\d{4})$/, "$1****$2");
}

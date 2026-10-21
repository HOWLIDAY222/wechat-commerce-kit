import { OrderPickupPanel } from '../order-pickup-panel';
import { appConfig } from "@/lib/config";
import { getOrderRefundSummary } from "@/lib/services/wechat-refund-read-model";
import { RefundSummaryPanel } from "@/components/storefront/refund-summary-panel";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { fetchAdminJson } from "@/app/admin/_lib/admin-page-fetch";
import { OrderAdminForm } from "@/app/admin/orders/order-admin-form";
import { OrderFulfillmentForm } from "@/app/admin/orders/order-fulfillment-form";
import { OrderShippingContact } from "@/app/admin/orders/order-shipping-contact";
import { WeChatShippingStatus } from "@/app/admin/orders/wechat-shipping-status";
import { WeChatLogisticsStatus } from "@/app/admin/orders/wechat-logistics-status";
import { OrderDispatchEstimate } from "@/app/admin/orders/order-dispatch-estimate";
import { getWeChatShippingState } from "@/lib/commerce/wechat-shipping-status";
import { OrderPaymentTaskForm } from "@/app/admin/orders/order-payment-task-form";
import { formatOrderFulfillmentStatusLabel, formatOrderStatusLabel, formatPaymentStatusLabel, formatStatusLabel } from "@/lib/display-labels";

type AdminOrderDetailProps = {
  params: Promise<{ orderNo: string }>;
};

type AdminOrderItem = {
  id: string;
  productName: string;
  productCode?: string;
  color: string;
  size: string;
  quantity: number;
  unitPriceCents: number;
  discountShareCents: number;
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
  discountCents: number;
  shippingFeeCents: number;
  payableAmountCents: number;
  currency: string;
  items: AdminOrderItem[];
  paymentIntents?: Array<{ id?: string; status?: string; provider?: string; gatewayTradeNo?: string | null }>;
  afterSalesRequests?: Array<{ id?: string; afterSalesNo?: string; status?: string }>;
  refunds?: Array<{ id?: string; refundNo?: string; refundStatus?: string; refundAmountCents?: number; amountCents?: number }>;
  shipments?: Array<{
    id: string;
    trackingCompany?: string | null;
    trackingNo?: string | null;
    wechatSyncedAt?: string | null;
    wechatSyncError?: string | null;
    status: string;
  }>;
  audit?: Array<{ id?: string; action?: string; createdAt?: string }>;
  createdAt: string;
  updatedAt: string;
};

type OrdersResponse = {
  ok: boolean;
  orders: AdminOrder[];
};

export const dynamic = "force-dynamic";

export const metadata = {
  title: "订单详情 | MerchantKit Admin",
  description: "MerchantKit 后台订单详情页，用于核对用户、地址、商品、支付、发货、售后、退款和审计记录。",
};

export default async function AdminOrderDetailPage({ params }: AdminOrderDetailProps) {
  const { orderNo } = await params;
  const { orders } = await fetchAdminJson<OrdersResponse>("/api/admin/orders");
  const order = orders.find((item) => item.orderNo === orderNo || item.id === orderNo);
  if (!order) notFound();
  const refundSummary = appConfig.COMMERCE_STORAGE === "prisma" ? await getOrderRefundSummary(order.id) : null;

  const frameMetrics = [
    { label: "订单状态", value: formatOrderStatusLabel(order.status, order.paymentStatus) },
    { label: "支付状态", value: formatPaymentStatusLabel(order.paymentStatus) },
    { label: "履约状态", value: formatOrderFulfillmentStatusLabel(order) },
    { label: "应付", value: formatMoney(order.payableAmountCents) },
  ];
  const headerAction = getOrderHeaderAction(order);

  return (
    <AdminFrame active="orders" metrics={frameMetrics} title="订单详情" subtitle="订单、支付、履约状态分开核对；不要在后台伪造支付成功。">
      <section className="border border-[#d8dde5] bg-white px-4 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <Link className="vk-admin-link" href="/admin/orders">返回订单管理</Link>
            <h1 className="mt-3 break-all text-2xl font-black">订单 {order.orderNo}</h1>
            <p className="mt-2 text-xs font-bold text-[#697386]">创建：{formatDate(order.createdAt)} / 更新：{formatDate(order.updatedAt)}</p>
          </div>
          {headerAction ? (
            <Link className="vk-button vk-button-dark" href={headerAction.href}>
              {headerAction.label}
            </Link>
          ) : null}
        </div>

        <RefundSummaryPanel summary={refundSummary} admin />
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <section className="rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4">
            <h2 className="text-base font-black">订单基础信息</h2>
            <dl className="mt-3 grid gap-3 text-xs font-bold">
              <Info label="订单号" value={order.orderNo} />
              <Info label="用户 ID" value={order.userId} />
              <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-3">
                <dt className="text-[#697386]">用户详情</dt>
                <dd>
                  <Link className="vk-admin-link" href={`/admin/users/${encodeURIComponent(order.userId)}`}>
                    查看用户详情
                  </Link>
                </dd>
              </div>
              <Info label="订单状态" value={formatOrderStatusLabel(order.status, order.paymentStatus)} />
              <Info label="支付状态" value={formatPaymentStatusLabel(order.paymentStatus)} />
              <Info label="履约状态" value={formatOrderFulfillmentStatusLabel(order)} />
              <Info label="商品小计" value={formatMoney(order.subtotalCents)} />
              {order.discountCents > 0 ? <Info label="预售优惠" value={`-${formatMoney(order.discountCents)}`} /> : null}
              <Info label="配送费用" value={formatMoney(order.shippingFeeCents)} />
              <Info label="应付金额" value={formatMoney(order.payableAmountCents)} />
            </dl>
            <OrderShippingContact name={order.customerName} phone={order.customerPhone} address={order.addressSnapshot} />
          </section>

          <section className="rounded-[8px] border border-[#d8dde5] bg-white p-4">
            <h2 className="text-base font-black">商品明细</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-[760px] w-full text-left text-xs">
                <thead className="text-[#697386]">
                  <tr className="border-b border-[#d8dde5]">
                    <th className="py-2 pr-3">商品</th>
                    <th className="py-2 pr-3">规格</th>
                    <th className="py-2 pr-3">数量</th>
                    <th className="py-2 pr-3">单价</th>
                    <th className="py-2 pr-3">小计</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e6eaf0]">
                  {order.items.map((item) => (
                    <tr key={item.id}>
                      <td className="py-3 pr-3 font-black">
                        {item.productName}
                        {item.productCode ? <span className="block text-[#697386]">{item.productCode}</span> : null}
                      </td>
                      <td className="py-3 pr-3 font-bold">{item.color} / {item.size}</td>
                      <td className="py-3 pr-3 font-bold">{item.quantity}</td>
                      <td className="py-3 pr-3 font-bold">{formatMoney(item.unitPriceCents)}</td>
                      <td className="py-3 pr-3 font-black">{formatMoney(item.unitPriceCents * item.quantity - item.discountShareCents)}{item.discountShareCents > 0 ? <span className="block text-[#027a48]">优惠 {formatMoney(item.discountShareCents)}</span> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <section className="rounded-[8px] border border-[#d8dde5] bg-white p-4">
            <h2 className="text-base font-black">状态区</h2>
            {!order.pickup ? <OrderDispatchEstimate key={order.orderNo} orderNo={order.orderNo} updatedAt={order.updatedAt} /> : null}
            {!order.pickup ? <WeChatLogisticsStatus orderNo={order.orderNo} updatedAt={order.updatedAt} /> : null}
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <StatusBlock label="订单状态" value={formatOrderStatusLabel(order.status, order.paymentStatus)} />
              <StatusBlock label="支付状态" value={formatPaymentStatusLabel(order.paymentStatus)} />
              <StatusBlock label="履约状态" value={formatOrderFulfillmentStatusLabel(order)} />
            </div>
            <p className="mt-3 text-xs font-bold leading-5 text-[#697386]">
              订单状态只能通过这里的状态动作流转；支付状态必须来自支付通知或主动查单同步；发货与签收在本订单的履约任务中处理。
            </p>
          </section>
          <OrderAdminForm
            fulfillmentStatus={order.fulfillmentStatus}
            orderNo={order.orderNo}
            paymentStatus={order.paymentStatus}
            status={order.status}
          />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <RecordPanel title="支付记录" empty="暂无支付记录">
            {(order.paymentIntents ?? []).map((payment) => (
              <RecordLine
                key={payment.id ?? payment.gatewayTradeNo ?? "payment"}
                label={payment.provider ?? "payment"}
                value={`${payment.status ?? "未知"} / ${payment.gatewayTradeNo ?? "暂无网关号"}`}
              />
            ))}
          </RecordPanel>
          <RecordPanel title="发货记录" empty="暂无发货记录">
            {(order.shipments ?? []).map((shipment) => (
              <RecordLine
                key={shipment.id}
                label={shipment.status}
                value={order.pickup ? "线下自提交付" : `${shipment.trackingCompany ?? "未填物流"} / ${shipment.trackingNo ?? "未填单号"}`}
              />
            ))}
          </RecordPanel>
          <RecordPanel title="售后记录" empty="暂无售后记录">
            {(order.afterSalesRequests ?? []).map((request) => (
              <RecordLine
                href={request.afterSalesNo ? `/admin/after-sales/${encodeURIComponent(request.afterSalesNo)}` : undefined}
                key={request.id ?? request.afterSalesNo ?? "after-sales"}
                label={request.afterSalesNo ?? "售后单"}
                value={request.status ?? "未知状态"}
              />
            ))}
          </RecordPanel>
          <RecordPanel title="退款记录" empty="暂无退款记录">
            {(order.refunds ?? []).map((refund) => (
              <RecordLine
                key={refund.id ?? refund.refundNo ?? "refund"}
                label={refund.refundNo ?? "退款单"}
                value={`${formatStatusLabel(refund.refundStatus ?? "未知状态")} / ${formatMoney(refund.refundAmountCents ?? refund.amountCents ?? 0)}`}
              />
            ))}
          </RecordPanel>
        </div>

        <div className="mt-4">
          {(order.paymentIntents ?? []).filter((payment) => payment.id).slice(0, 1).map((payment) => <div className="mb-4" key={payment.id}><OrderPaymentTaskForm gatewayTradeNo={payment.gatewayTradeNo} paymentId={payment.id!} provider={payment.provider ?? "未知"} status={payment.status ?? "未知"} /></div>)}
          {order.pickup ? <OrderPickupPanel orderNo={order.orderNo} pickup={order.pickup} /> : <OrderFulfillmentForm orderStatus={order.status} paymentStatus={order.paymentStatus}
            fulfillmentStatus={order.fulfillmentStatus}
            orderNo={order.orderNo}
            trackingCompany={order.shipments?.[0]?.trackingCompany}
            trackingNo={order.shipments?.[0]?.trackingNo}
          />}
          <WeChatShippingStatus pickup={!!order.pickup} state={getWeChatShippingState(order)} errors={(order.shipments ?? []).flatMap(shipment => shipment.wechatSyncError ? [shipment.wechatSyncError] : [])} syncedAt={order.shipments?.find(shipment => shipment.wechatSyncedAt)?.wechatSyncedAt} />
        </div>

        <section className="mt-4 rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4">
          <h2 className="text-base font-black">时间线</h2>
          <div className="mt-3 grid gap-2 text-xs font-bold text-[#697386]">
            <p>创建订单：{formatDate(order.createdAt)}</p>
            <p>最近更新：{formatDate(order.updatedAt)}</p>
            <p>支付记录：{order.paymentIntents?.length ?? 0} 条</p>
            <p>发货记录：{order.shipments?.length ?? 0} 条</p>
            <p>售后记录：{order.afterSalesRequests?.length ?? 0} 条</p>
            <p>退款记录：{order.refunds?.length ?? 0} 条</p>
          </div>
        </section>

        <section className="mt-4 rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4">
          <h2 className="text-base font-black">审计记录</h2>
          <div className="mt-3 grid gap-2">
            {(order.audit ?? []).map((entry) => (
              <p className="text-xs font-bold text-[#697386]" key={entry.id ?? `${entry.action}-${entry.createdAt}`}>
                {entry.createdAt ? formatDate(entry.createdAt) : "未知时间"} / {entry.action ?? "未知操作"}
              </p>
            ))}
            {!order.audit?.length ? <p className="text-xs font-bold text-[#697386]">暂无关联审计记录。</p> : null}
          </div>
        </section>
      </section>
    </AdminFrame>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-3">
      <dt className="text-[#697386]">{label}</dt>
      <dd className="break-all text-[#111827]">{value}</dd>
    </div>
  );
}

function StatusBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] bg-[#f8fafc] px-3 py-3">
      <p className="text-xs font-black text-[#697386]">{label}</p>
      <p className="mt-1 text-sm font-black">{value}</p>
    </div>
  );
}

function RecordPanel({ children, empty, title }: { children: React.ReactNode; empty: string; title: string }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <section className="rounded-[8px] border border-[#d8dde5] bg-white p-4">
      <h2 className="text-base font-black">{title}</h2>
      <div className="mt-3 grid gap-2">{items.length > 0 ? items : <p className="text-xs font-bold text-[#697386]">{empty}</p>}</div>
    </section>
  );
}

function RecordLine({ href, label, value }: { href?: string; label: string; value: string }) {
  const content = (
    <span className="grid gap-1 rounded-[8px] bg-[#f8fafc] px-3 py-2 text-xs font-bold">
      <span className="font-black text-[#111827]">{label}</span>
      <span className="break-all text-[#697386]">{value}</span>
    </span>
  );
  return href ? (
    <Link className="block" href={href}>
      {content}
    </Link>
  ) : (
    content
  );
}

function getOrderHeaderAction(order: AdminOrder) {
  if (order.pickup) return {href:"#fulfillment-task",label: order.pickup.status === "COLLECTED" ? "查看取货记录" : "处理自提"};
  const fulfillment = order.fulfillmentStatus.toUpperCase();
  if (order.paymentStatus.toUpperCase() === "REFUNDED" && ["SHIPPED", "DELIVERED"].includes(fulfillment)) return { href: "#fulfillment-task", label: "查看物流" };
  if (order.status.toUpperCase() !== "CONFIRMED" || order.paymentStatus.toUpperCase() !== "PAID") return null;
  const href = "#fulfillment-task";
  if (fulfillment === "PENDING" || fulfillment === "PROCESSING") return { href, label: "安排发货" };
  if (fulfillment === "SHIPPED") return { href, label: "查看物流" };
  return { href, label: "查看履约记录" };
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(cents / 100);
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

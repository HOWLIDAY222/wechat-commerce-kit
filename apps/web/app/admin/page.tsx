import { needsPaymentReview, fulfillmentActions } from "@/lib/commerce/admin-operations";
import { needsWeChatShippingSync, type WeChatShipmentStatus } from "@/lib/commerce/wechat-shipping-status";
import Link from "next/link";
import { ArrowRight, CheckCircle2, PackagePlus, PanelsTopLeft } from "lucide-react";
import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { fetchAdminJson } from "@/app/admin/_lib/admin-page-fetch";
import { formatFulfillmentStatusLabel, formatPaymentStatusLabel, formatStatusLabel } from "@/lib/display-labels";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "今日工作 | MerchantKit Admin",
  description: "MerchantKit 商家运营工作台，按优先级集中处理发货、售后、支付异常、库存和商品资料。",
};

type AdminSku = {
  priceCents: number;
  stockQuantity: number;
  reservedQuantity: number;
  status: string;
};

type AdminProduct = {
  image?: string | null;
  images?: Array<{ imageUrl?: string | null }>;
  status: string;
  skus: AdminSku[];
};

type ProductsResponse = {
  products: AdminProduct[];
};

type AdminOrder = {
  orderNo: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  payableAmountCents: number;
  customerName?: string;
  customerPhone?: string;
  createdAt: string;
  paymentIntents?: Array<{ provider?: string; status?: string }>;
  shipments?: WeChatShipmentStatus[];
};

type OrdersResponse = {
  orders: AdminOrder[];
};

type AdminPayment = {
  status: string;
  amountCents: number;
  createdAt?: string;
};

type PaymentsResponse = {
  missingPaymentIntentOrders: unknown[];
  payments: AdminPayment[];
};

type AdminAfterSales = {
  afterSalesNo?: string;
  orderNo?: string;
  status: string;
  type: string;
  reason?: string;
  refundAmountCents: number;
  createdAt?: string;
};

type AfterSalesResponse = {
  afterSales: AdminAfterSales[];
};

type PriorityTask = {
  action: string;
  count: number;
  detail: string;
  href: string;
  label: string;
  title: string;
};

const terminalAfterSales = new Set(["REJECTED", "REFUNDED", "COMPLETED", "CANCELLED", "rejected", "refunded", "completed", "cancelled"]);

export default async function AdminPage() {
  const [productsData, ordersData, paymentsData, afterSalesData] = await Promise.all([
    fetchAdminJson<ProductsResponse>("/api/admin/products"),
    fetchAdminJson<OrdersResponse>("/api/admin/orders"),
    fetchAdminJson<PaymentsResponse>("/api/admin/payments"),
    fetchAdminJson<AfterSalesResponse>("/api/admin/after-sales"),
  ]);

  const productStats = getProductStats(productsData.products);
  const orderStats = getOrderStats(ordersData.orders);
  const paymentStats = getPaymentStats(paymentsData, ordersData.orders);
  const afterSalesStats = getAfterSalesStats(afterSalesData.afterSales);
  const recentOrders = ordersData.orders.slice(0, 8);
  const recentAfterSales = afterSalesData.afterSales.slice(0, 6);
  const priorityTasks = buildPriorityTasks({ afterSalesStats, orderStats, paymentStats, productStats });
  const pendingTaskCount = priorityTasks.reduce((sum, task) => sum + task.count, 0);

  const frameMetrics = [
    { label: "今日订单", value: orderStats.todayOrders.toString(), hint: "按下单时间统计" },
    { label: "今日实付", value: formatMoney(paymentStats.todayPaidAmountCents), hint: "仅统计已支付记录" },
    { label: "待发货", value: orderStats.paidUnfulfilled.toString(), hint: "已支付且尚未履约" },
    { label: "售后待审核", value: afterSalesStats.reviewing.toString(), hint: "需要人工核对证据" },
  ];

  return (
    <AdminFrame active="home" metrics={frameMetrics} title="今日工作" subtitle="按优先级处理真实业务待办；完成后状态、记录和下一步会同步更新。">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
        <section className="overflow-hidden rounded-[8px] border border-[#d8dde5] bg-white">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e6eaf0] px-4 py-4">
            <div>
              <h2 className="text-lg font-black text-[#101828]">今日待办</h2>
              <p className="mt-1 text-xs font-bold leading-5 text-[#697386]">异常优先，其次处理售后、发货、库存和商品资料。</p>
            </div>
            <span className="rounded-[6px] bg-[#f2f4f7] px-2.5 py-1 text-xs font-black text-[#475467]">共 {pendingTaskCount} 项</span>
          </div>

          {priorityTasks.length > 0 ? (
            <div className="divide-y divide-[#e6eaf0]">
              {priorityTasks.map((task, index) => (
                <Link className="grid gap-3 px-4 py-4 hover:bg-[#fbfcfd] sm:grid-cols-[32px_minmax(0,1fr)_auto] sm:items-center" href={task.href} key={task.title}>
                  <span className={index === 0 ? "flex h-8 w-8 items-center justify-center rounded-[6px] bg-[#101828] text-xs font-black text-white" : "flex h-8 w-8 items-center justify-center rounded-[6px] bg-[#f2f4f7] text-xs font-black text-[#475467]"}>
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-black text-[#101828]">{task.title}</span>
                      <span className="rounded-[6px] bg-[#f2f4f7] px-2 py-0.5 text-[11px] font-black text-[#475467]">{task.label}</span>
                      <span className="rounded-[6px] bg-[#fff1f3] px-2 py-0.5 text-[11px] font-black text-[#d92d20]">{task.count}</span>
                    </span>
                    <span className="mt-1 block text-xs font-bold leading-5 text-[#697386]">{task.detail}</span>
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-black text-[#155eef]">
                    {task.action}
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="flex items-start gap-3 px-4 py-8">
              <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#079455]" />
              <div>
                <p className="text-sm font-black text-[#101828]">当前没有需要立即处理的业务待办</p>
                <p className="mt-1 text-xs font-bold leading-5 text-[#697386]">新订单、支付、售后或库存变化出现后，会自动进入这里。</p>
              </div>
            </div>
          )}
        </section>

        <aside className="grid content-start gap-4">
          <section className="rounded-[8px] border border-[#d8dde5] bg-white p-4">
            <h2 className="text-base font-black text-[#101828]">当前经营概况</h2>
            <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">
              <Metric label="待支付订单" value={orderStats.pendingPayment.toString()} />
              <Metric label="支付待核对" value={paymentStats.anomaly.toString()} />
              <Metric label="低库存 SKU" value={productStats.lowStock.toString()} />
              <Metric label="商品待完善" value={productStats.incompleteProducts.toString()} />
              <Metric label="在售商品" value={`${productStats.activeProducts}/${productStats.totalProducts}`} />
              <Metric label="可售库存" value={`${productStats.availableStock} 件`} />
            </dl>
          </section>

          <section className="rounded-[8px] border border-[#d8dde5] bg-white p-4">
            <h2 className="text-base font-black text-[#101828]">快捷操作</h2>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
              <Link className="vk-button vk-button-dark min-h-11 gap-2" href="/admin/products/new">
                <PackagePlus aria-hidden="true" className="h-4 w-4" />
                新建商品
              </Link>
              <Link className="vk-button vk-button-light min-h-11 gap-2" href="/admin/orders?tab=PENDING_SHIPMENT">处理待发货</Link>
              <Link className="vk-button vk-button-light min-h-11 gap-2" href="/admin/membership">管理会员与权益</Link>
              <Link className="vk-button vk-button-light min-h-11 gap-2" href="/admin/design">
                <PanelsTopLeft aria-hidden="true" className="h-4 w-4" />
                装修网站
              </Link>
            </div>
          </section>
        </aside>
      </section>

      <section className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1.3fr)_minmax(340px,0.7fr)]">
        <section className="overflow-hidden rounded-[8px] border border-[#d8dde5] bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-[#e6eaf0] px-4 py-3">
            <div>
              <h2 className="text-base font-black text-[#101828]">最新订单</h2>
              <p className="mt-1 text-xs font-bold text-[#697386]">点击订单号进入详情，支付和履约状态分别核对。</p>
            </div>
            <Link className="text-xs font-black text-[#155eef]" href="/admin/orders">查看全部</Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] border-collapse text-left text-xs">
              <thead className="bg-[#f8fafc] text-[#697386]">
                <tr className="border-b border-[#e6eaf0]">
                  <Th>订单号</Th>
                  <Th>客户</Th>
                  <Th>应付金额</Th>
                  <Th>支付</Th>
                  <Th>履约</Th>
                  <Th>下单时间</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e6eaf0]">
                {recentOrders.map((order) => (
                  <tr className="hover:bg-[#fbfcfd]" key={order.orderNo}>
                    <td className="px-4 py-3">
                      <Link className="font-black text-[#155eef] hover:underline" href={`/admin/orders/${encodeURIComponent(order.orderNo)}`}>{order.orderNo}</Link>
                    </td>
                    <td className="px-4 py-3 font-bold text-[#344054]">{order.customerName || order.customerPhone || "未记录"}</td>
                    <td className="px-4 py-3 font-black text-[#101828]">{formatMoney(order.payableAmountCents)}</td>
                    <td className="px-4 py-3"><StatusPill tone={isPaid(order.paymentStatus) ? "green" : "orange"} value={formatPaymentStatusLabel(order.paymentStatus)} /></td>
                    <td className="px-4 py-3"><StatusPill value={fulfillmentActions(order).reason || formatFulfillmentStatusLabel(order.fulfillmentStatus)} /></td>
                    <td className="px-4 py-3 font-bold text-[#697386]">{formatDate(order.createdAt)}</td>
                  </tr>
                ))}
                {recentOrders.length === 0 ? <tr><td className="px-4 py-8 text-sm font-bold text-[#697386]" colSpan={6}>暂无订单。</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-[8px] border border-[#d8dde5] bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-[#e6eaf0] px-4 py-3">
            <div>
              <h2 className="text-base font-black text-[#101828]">最新售后</h2>
              <p className="mt-1 text-xs font-bold text-[#697386]">待审核记录会同时进入今日待办。</p>
            </div>
            <Link className="text-xs font-black text-[#155eef]" href="/admin/after-sales">查看全部</Link>
          </div>
          <div className="divide-y divide-[#e6eaf0]">
            {recentAfterSales.map((request, index) => (
              <Link className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-3 hover:bg-[#fbfcfd]" href={request.afterSalesNo ? `/admin/after-sales/${encodeURIComponent(request.afterSalesNo)}` : "/admin/after-sales"} key={request.afterSalesNo ?? `${request.orderNo}-${index}`}>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black text-[#101828]">{request.afterSalesNo ?? "售后记录"}</span>
                  <span className="mt-1 block truncate text-xs font-bold text-[#697386]">{request.orderNo ?? "未绑定订单"} · {request.reason ?? formatStatusLabel(request.type)}</span>
                </span>
                <span className="text-right">
                  <StatusPill tone={terminalAfterSales.has(request.status) ? "slate" : "orange"} value={formatStatusLabel(request.status)} />
                  <span className="mt-1 block text-xs font-black text-[#101828]">{formatMoney(request.refundAmountCents)}</span>
                </span>
              </Link>
            ))}
            {recentAfterSales.length === 0 ? <p className="px-4 py-8 text-sm font-bold text-[#697386]">暂无售后记录。</p> : null}
          </div>
        </section>
      </section>
    </AdminFrame>
  );
}

function buildPriorityTasks({
  afterSalesStats,
  orderStats,
  paymentStats,
  productStats,
}: {
  afterSalesStats: ReturnType<typeof getAfterSalesStats>;
  orderStats: ReturnType<typeof getOrderStats>;
  paymentStats: ReturnType<typeof getPaymentStats>;
  productStats: ReturnType<typeof getProductStats>;
}) {
  const tasks: PriorityTask[] = [
    {
      action: "核对支付",
      count: paymentStats.anomaly,
      detail: "等待服务端通知、主动查单或缺少支付意图，不能手工改成已支付。",
      href: "/admin/orders?tab=ANOMALY",
      label: "异常优先",
      title: "支付记录待核对",
    },
    {
      action: "核对同步",
      count: orderStats.wechatSyncPending,
      detail: "已发货但尚未成功报送微信；进入订单核对物流及同步结果，无需重复发货。",
      href: "/admin/orders?tab=WECHAT_SYNC",
      label: "发货报送",
      title: "微信发货同步待处理",
    },
    {
      action: "审核售后",
      count: afterSalesStats.reviewing,
      detail: "核对订单、商品和用户凭证后，再进入退款、退货或补发流程。",
      href: "/admin/after-sales",
      label: "客户时效",
      title: "售后申请待审核",
    },
    {
      action: "安排发货",
      count: orderStats.paidUnfulfilled,
      detail: "这些订单已经确认支付，需要填写物流公司和运单号推进履约。",
      href: "/admin/orders?tab=PENDING_SHIPMENT",
      label: "履约时效",
      title: "已支付订单待发货",
    },
    {
      action: "补充库存",
      count: productStats.lowStock,
      detail: "可售库存不高于 5 件的 SKU，需要到货入库或盘点修正。",
      href: "/admin/products?tab=LOW_STOCK",
      label: "库存风险",
      title: "低库存 SKU 待处理",
    },
    {
      action: "完善商品",
      count: productStats.incompleteProducts,
      detail: "商品缺少主图、SKU 或有效售价，补齐后才能稳定展示和销售。",
      href: "/admin/products",
      label: "资料完整",
      title: "商品资料待完善",
    },
  ];
  return tasks.filter((task) => task.count > 0);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold text-[#697386]">{label}</dt>
      <dd className="mt-1 text-lg font-black text-[#101828]">{value}</dd>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 text-xs font-black">{children}</th>;
}

function StatusPill({ value, tone = "slate" }: { value: string; tone?: "green" | "orange" | "slate" }) {
  const className = tone === "green" ? "bg-[#ecfdf3] text-[#067647]" : tone === "orange" ? "bg-[#fff7ed] text-[#c2410c]" : "bg-[#f2f4f7] text-[#475467]";
  return <span className={`inline-flex w-fit whitespace-nowrap rounded-[6px] px-2 py-1 text-[11px] font-black ${className}`}>{value}</span>;
}

function getProductStats(products: AdminProduct[]) {
  let availableStock = 0;
  let lowStock = 0;
  for (const product of products) {
    for (const sku of product.skus) {
      const available = Math.max(0, sku.stockQuantity - sku.reservedQuantity);
      if (product.status === "ACTIVE" && sku.status === "ACTIVE") availableStock += available;
      if (product.status === "ACTIVE" && sku.status === "ACTIVE" && available <= 5) lowStock += 1;
    }
  }
  return {
    activeProducts: products.filter((product) => product.status === "ACTIVE").length,
    availableStock,
    incompleteProducts: products.filter(isProductIncomplete).length,
    lowStock,
    totalProducts: products.length,
  };
}

function getOrderStats(orders: AdminOrder[]) {
  return {
    paidUnfulfilled: orders.filter((order) => fulfillmentActions(order).ship).length,
    wechatSyncPending: orders.filter(needsWeChatShippingSync).length,
    pendingPayment: orders.filter(needsPaymentReview).length,
    todayOrders: orders.filter((order) => isToday(order.createdAt)).length,
  };
}

function getPaymentStats(data: PaymentsResponse, orders: AdminOrder[]) {
  return {
    anomaly: orders.filter(needsPaymentReview).length,
    todayPaidAmountCents: data.payments.reduce((sum, payment) => (isPaid(payment.status) && isToday(payment.createdAt) ? sum + payment.amountCents : sum), 0),
  };
}

function getAfterSalesStats(afterSales: AdminAfterSales[]) {
  return {
    reviewing: afterSales.filter((request) => ["submitted", "reviewing", "SUBMITTED", "REVIEWING"].includes(request.status)).length,
  };
}

function isProductIncomplete(product: AdminProduct) {
  const hasImage = Boolean(product.image || product.images?.some((image) => image.imageUrl));
  const hasSellableSku = product.skus.some((sku) => sku.priceCents > 0);
  return !hasImage || !hasSellableSku;
}

function isPaid(status: string | undefined) {
  return status?.toUpperCase() === "PAID";
}

function isCancelled(status: string | undefined) {
  return ["CANCELLED", "CLOSED", "FAILED"].includes(status?.toUpperCase() ?? "");
}

function isToday(value: string | Date | undefined) {
  if (!value) return false;
  const date = new Date(value);
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("zh-CN", { currency: "CNY", style: "currency" }).format(cents / 100);
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

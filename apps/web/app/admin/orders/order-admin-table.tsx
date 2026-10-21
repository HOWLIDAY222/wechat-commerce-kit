"use client";

import { useSearchParams } from "next/navigation";
import { needsPaymentReview, fulfillmentActions } from "@/lib/commerce/admin-operations";
import { getWeChatShippingState, needsWeChatShippingSync, weChatShippingLabels } from "@/lib/commerce/wechat-shipping-status";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Filter, Search } from "lucide-react";
import { getPageCount, getPageItems } from "@/lib/client/admin-table-actions";
import { formatFulfillmentStatusLabel, formatOrderStatusLabel, formatPaymentStatusLabel } from "@/lib/display-labels";

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
  source?: string | null;
  id: string;
  orderNo: string;
  userId: string;
  status: string;
  paymentStatus: string;
  fulfillmentStatus: string;
  customerName: string;
  customerPhone: string;
  addressSnapshot: string;
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
  createdAt: string;
};

type OrderTab = "ALL" | "PICKUP" | "PENDING_PAYMENT" | "PENDING_SHIPMENT" | "SHIPPED" | "WECHAT_SYNC" | "AFTER_SALES" | "COMPLETED" | "CANCELLED" | "ANOMALY";
type SortMode = "LATEST" | "AMOUNT_DESC" | "AMOUNT_ASC";

export function OrderAdminTable({ orders }: { orders: AdminOrder[] }) {
  const [source, setSource] = useState("ALL");
  const [query, setQuery] = useState("");
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab");
  const requestedTab=buildTabs(orders).some(t=>t.key===initialTab)?initialTab as OrderTab:"ALL";
  const [tabSelection,setTabSelection]=useState({query:initialTab,tab:requestedTab});
  const tab=tabSelection.query===initialTab?tabSelection.tab:requestedTab;
  function setTab(value:OrderTab){setTabSelection({query:initialTab,tab:value});}
  const [paymentStatus, setPaymentStatus] = useState("ALL");
  const [fulfillmentStatus, setFulfillmentStatus] = useState("ALL");
  const [sortMode, setSortMode] = useState<SortMode>("LATEST");
  const [selectedOrderNo, setSelectedOrderNo] = useState(() => getPreferredOrder(orders)?.orderNo ?? "");
  const [page, setPage] = useState(1);
  const paymentStatuses = useMemo(() => uniqueValues(orders.map((order) => order.paymentStatus)), [orders]);
  const fulfillmentStatuses = useMemo(() => uniqueValues(orders.map((order) => order.fulfillmentStatus)), [orders]);
  const tabs = useMemo(() => buildTabs(orders), [orders]);

  const filteredOrders = (() => {
    const normalizedQuery = query.trim().toLowerCase();
    return orders
      .filter((order) => {
        if (!matchesTab(order, tab)) return false;
        if(source !== "ALL" && (order.source || "UNKNOWN") !== source) return false;
        if (paymentStatus !== "ALL" && order.paymentStatus !== paymentStatus) return false;
        if (fulfillmentStatus !== "ALL" && order.fulfillmentStatus !== fulfillmentStatus) return false;
        if (["PENDING", "PROCESSING", "UNFULFILLED"].includes(fulfillmentStatus.toUpperCase()) && order.paymentStatus.toUpperCase() === "REFUNDED") return false;
        if (!normalizedQuery) return true;
        const searchText = [
          order.orderNo,
          order.customerName,
          order.customerPhone,
          order.addressSnapshot,
          order.status,
          order.paymentStatus,
          order.fulfillmentStatus,
          ...order.items.flatMap((item) => [item.productName, item.productCode ?? "", item.color, item.size]),
          ...(order.shipments ?? []).flatMap((shipment) => [shipment.trackingCompany ?? "", shipment.trackingNo ?? ""]),
        ]
          .join(" ")
          .toLowerCase();
        return searchText.includes(normalizedQuery);
      })
      .sort((a, b) => sortOrders(a, b, sortMode));
  })();

  const pageCount = getPageCount(filteredOrders.length);
  const currentPage = Math.min(page, pageCount);
  const visibleOrders = getPageItems(filteredOrders,currentPage);
  const selectedOrder = filteredOrders.find((order) => order.orderNo === selectedOrderNo) ?? getPreferredOrder(filteredOrders);

  function resetFilters() {
    setSource("ALL");
    setQuery("");
    setTab("ALL");
    setPaymentStatus("ALL");
    setFulfillmentStatus("ALL");
    setSortMode("LATEST");
    setPage(1);
  }

  return (
    <section className="mt-5 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 overflow-hidden rounded-[8px] border border-[#e4e7ec] bg-white shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
        <div className="border-b border-[#eef1f5] px-4 py-4">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {tabs.map((item) => (
              <button
                className={
                  tab === item.key
                    ? "min-w-fit border-b-2 border-[#155eef] px-1 pb-3 text-sm font-black text-[#155eef]"
                    : "min-w-fit border-b-2 border-transparent px-1 pb-3 text-sm font-black text-[#344054] hover:text-[#155eef]"
                  }
                  key={item.key}
                onClick={() => {
                  setTab(item.key);
                  setPage(1);
                }}
                type="button"
              >
                {item.label} <span className="ml-1 text-[#667085]">{item.count}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-[140px_minmax(220px,1fr)_130px_130px_130px_84px]">
            <select aria-label="订单来源" className="vk-admin-filter h-11" value={source} onChange={e=>{setSource(e.target.value);setPage(1);}}><option value="ALL">全部来源</option><option value="WEB">官网</option><option value="MINIPROGRAM">小程序</option><option value="UNKNOWN">历史订单（未记录）</option></select>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#667085]" />
              <input
                aria-label="搜索订单"
                className="vk-admin-filter h-11 pl-9"
                style={{ paddingLeft: "2.25rem" }}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="搜索订单号 / 手机号 / 商品名称"
                type="search"
                value={query}
              />
            </label>
            <select className="vk-admin-filter h-11" onChange={(event) => {
              setPaymentStatus(event.target.value);
              setPage(1);
            }} value={paymentStatus}>
              <option value="ALL">支付状态</option>
              {paymentStatuses.map((item) => (
                <option key={item} value={item}>{formatPaymentStatusLabel(item)}</option>
              ))}
            </select>
            <select className="vk-admin-filter h-11" onChange={(event) => {
              setFulfillmentStatus(event.target.value);
              setPage(1);
            }} value={fulfillmentStatus}>
              <option value="ALL">履约状态</option>
              {fulfillmentStatuses.map((item) => (
                <option key={item} value={item}>{formatFulfillmentStatusLabel(item)}</option>
              ))}
            </select>
            <select className="vk-admin-filter h-11" onChange={(event) => {
              setSortMode(event.target.value as SortMode);
              setPage(1);
            }} value={sortMode}>
              <option value="LATEST">最新下单</option>
              <option value="AMOUNT_DESC">金额高在前</option>
              <option value="AMOUNT_ASC">金额低在前</option>
            </select>
            <button className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] border border-[#d8dde5] bg-white px-3 text-sm font-black text-[#344054]" onClick={resetFilters} type="button">
              <Filter className="h-4 w-4" />
              清空
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-xs">
            <thead className="bg-[#f8fafc] text-[#667085]">
              <tr className="border-b border-[#eef1f5]">
                <Th>商品信息</Th>
                <Th>订单金额</Th>
                <Th>收货人</Th>
                <Th>下单时间</Th>
                <Th>支付状态</Th>
                <Th>履约状态</Th>
                <Th>微信同步</Th>
                <Th>售后状态</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef1f5]">
              {visibleOrders.map((order) => (
                <OrderRow
                  key={order.id}
                  order={order}
                  selected={selectedOrder?.orderNo === order.orderNo}
                  onSelect={() => setSelectedOrderNo(order.orderNo)}
                />
              ))}
              {filteredOrders.length === 0 ? (
                <tr>
                  <td className="px-4 py-10 text-sm font-bold text-[#697386]" colSpan={9}>
                    没有匹配的订单，请调整搜索、筛选或状态 Tab。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-[#eef1f5] px-4 py-3 text-xs font-bold text-[#697386] md:flex-row md:items-center md:justify-between">
          <span>共 {filteredOrders.length} / {orders.length} 条</span>
          <div className="flex items-center gap-2">
            <button className="h-8 rounded-[8px] border border-[#d8dde5] px-3 disabled:cursor-not-allowed disabled:opacity-50" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">上一页</button>
            <span className="flex h-8 min-w-12 items-center justify-center rounded-[8px] bg-[#155eef] px-2 font-black text-white">{currentPage}/{pageCount}</span>
            <button className="h-8 rounded-[8px] border border-[#d8dde5] px-3 disabled:cursor-not-allowed disabled:opacity-50" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">下一页</button>
          </div>
        </div>
      </div>

      <OrderDetailPanel order={selectedOrder} />
    </section>
  );
}

function OrderRow({ onSelect, order, selected }: { onSelect: () => void; order: AdminOrder; selected: boolean }) {
  const hasAfterSales = hasOpenAfterSales(order);
  const hasAfterSalesHistory = (order.afterSalesRequests?.length ?? 0) > 0;
  const canShip = fulfillmentActions(order).ship;
  const syncState = getWeChatShippingState(order);
  return (
    <tr className={selected ? "bg-[#f5f8ff] shadow-[inset_3px_0_0_#155eef]" : "hover:bg-[#fbfcfd]"}>
      <td className="px-4 py-3">
        <button aria-pressed={selected} className="text-left" onClick={onSelect} type="button">
          <span className="block font-black text-[#101828]">{order.orderNo}</span>
          <span className="mt-1 line-clamp-2 block max-w-[270px] font-bold leading-5 text-[#344054]">{summarizeItems(order.items)}</span>
          <span className="mt-1 block font-bold text-[#98a2b3]">{order.items[0]?.color ?? "未填"} / {order.items[0]?.size ?? "未填"} x{getItemQuantity(order)}</span>
        </button>
      </td>
      <td className="px-4 py-3">
        <p className="font-black text-[#101828]">{formatMoney(order.payableAmountCents)}</p>
      </td>
      <td className="px-4 py-3">
        <p className="font-black text-[#344054]">{order.customerName || "未记录"}</p>
        <p className="mt-1 font-bold text-[#98a2b3]">{order.customerPhone || "未记录"}</p>
      </td>
      <td className="px-4 py-3 font-bold text-[#344054]">{formatDate(order.createdAt)}</td>
      <td className="px-4 py-3"><StatusPill value={formatPaymentStatusLabel(order.paymentStatus)} tone={isPaid(order.paymentStatus) ? "green" : "orange"} /></td>
      <td className="px-4 py-3"><StatusPill value={fulfillmentActions(order).reason || formatFulfillmentStatusLabel(order.fulfillmentStatus)} tone={canShip ? "blue" : "slate"} /></td>
      <td className="px-4 py-3"><StatusPill value={weChatShippingLabels[syncState]} tone={syncState === "FAILED" ? "red" : syncState === "SYNCED" ? "green" : "slate"} /></td>
      <td className="px-4 py-3">{hasAfterSales ? <StatusPill value="售后中" tone="orange" /> : <span className="font-bold text-[#98a2b3]">无</span>}</td>
      <td className="px-4 py-3">
        <div className="grid gap-1">
          <ActionLink href={`/admin/orders/${encodeURIComponent(order.orderNo)}`}>查看详情</ActionLink>
          {canShip ? <ActionLink href={`/admin/orders/${encodeURIComponent(order.orderNo)}#fulfillment-task`}>发货</ActionLink> : null}
          {hasAfterSalesHistory ? <ActionLink href={`/admin/after-sales?order=${encodeURIComponent(order.orderNo)}`}>查看售后</ActionLink> : null}
        </div>
      </td>
    </tr>
  );
}

function OrderDetailPanel({ order }: { order: AdminOrder | undefined }) {
  if (!order) {
    return (
      <aside className="rounded-[8px] border border-[#e4e7ec] bg-white p-5 text-sm font-bold text-[#697386]">
        请选择一笔订单查看详情。
      </aside>
    );
  }
  const canShip = fulfillmentActions(order).ship;
  const secondaryAction = getOrderSecondaryAction(order);
  return (
    <aside className="grid gap-4 2xl:sticky 2xl:top-[112px] 2xl:self-start">
      <section className="rounded-[8px] border border-[#e4e7ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-black text-[#101828]">订单详情</h3>
          <StatusPill value={fulfillmentActions(order).reason || formatFulfillmentStatusLabel(order.fulfillmentStatus)} tone={canShip ? "blue" : "slate"} />
        </div>
        <dl className="mt-4 grid gap-3 text-sm">
          <DetailRow label="订单号" value={order.orderNo} />
          <DetailRow label="下单时间" value={formatDateTime(order.createdAt)} />
          <DetailRow label="支付状态" value={formatPaymentStatusLabel(order.paymentStatus)} />
          <DetailRow label="订单状态" value={formatOrderStatusLabel(order.status, order.paymentStatus)} />
          <DetailRow label="微信同步" value={weChatShippingLabels[getWeChatShippingState(order)]} />
          <DetailRow label="收货人" value={`${order.customerName || "未记录"} ${order.customerPhone || "未记录"}`} />
        </dl>
        <div className="mt-4 border-t border-[#eef1f5] pt-4">
          <h4 className="text-sm font-black text-[#101828]">商品信息</h4>
          <div className="mt-3 grid gap-2">
            {order.items.slice(0, 3).map((item) => (
              <div className="rounded-[8px] bg-[#f8fafc] px-3 py-3" key={item.id}>
                <p className="line-clamp-2 text-sm font-black text-[#344054]">{item.productName}</p>
                <p className="mt-1 text-xs font-bold text-[#697386]">{item.color} / {item.size} x{item.quantity}</p>
                <p className="mt-1 text-sm font-black text-[#101828]">{formatMoney(item.unitPriceCents)}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 border-t border-[#eef1f5] pt-4">
          <h4 className="text-sm font-black text-[#101828]">收货信息</h4>
          <p className="mt-2 text-xs font-bold leading-5 text-[#697386]">{order.addressSnapshot || "未记录地址"}</p>
        </div>
        <div className={secondaryAction ? "mt-4 grid grid-cols-2 gap-2" : "mt-4 grid gap-2"}>
          <Link className="vk-button vk-button-dark" href={`/admin/orders/${encodeURIComponent(order.orderNo)}`}>查看详情</Link>
          {secondaryAction ? <Link className="vk-button vk-button-light" href={secondaryAction.href}>{secondaryAction.label}</Link> : null}
        </div>
      </section>

      <section className="rounded-[8px] border border-[#e4e7ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
        <h3 className="text-base font-black text-[#101828]">快捷提醒</h3>
        <ul className="mt-3 grid gap-2 text-xs font-bold leading-5 text-[#697386]">
          <li>已支付订单只能从发货流程推进履约状态。</li>
          <li>支付状态必须来自支付宝 notify、受保护查询或已验证记录。</li>
          <li>退款和售后操作请进入对应详情页留审计记录。</li>
        </ul>
      </section>
    </aside>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 font-black">{children}</th>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3">
      <dt className="font-bold text-[#697386]">{label}</dt>
      <dd className="min-w-0 break-words font-black text-[#344054]">{value}</dd>
    </div>
  );
}

function ActionLink({ children, href }: { children: React.ReactNode; href: string }) {
  return (
    <Link className="w-fit whitespace-nowrap text-xs font-black text-[#155eef] hover:underline" href={href}>
      {children}
    </Link>
  );
}

function StatusPill({ value, tone = "slate" }: { value: string; tone?: "blue" | "green" | "orange" | "red" | "slate" }) {
  const className =
    tone === "blue"
      ? "bg-[#eef4ff] text-[#155eef]"
      : tone === "green"
        ? "bg-[#ecfdf3] text-[#079455]"
        : tone === "orange"
          ? "bg-[#fff7ed] text-[#f97316]"
          : tone === "red"
            ? "bg-[#fff1f3] text-[#d92d20]"
            : "bg-[#f2f4f7] text-[#667085]";
  return <span className={`inline-flex w-fit whitespace-nowrap rounded-[6px] px-2 py-1 text-[11px] font-black ${className}`}>{value}</span>;
}

function buildTabs(orders: AdminOrder[]): Array<{ key: OrderTab; label: string; count: number }> {
  return [
    { key: "ALL", label: "全部", count: orders.length },
    { key: "PENDING_PAYMENT", label: "待支付", count: orders.filter(needsPaymentReview).length },
    {key:"PICKUP",label:"线下自提",count:orders.filter(order=>!!order.pickup).length},
    { key: "PENDING_SHIPMENT", label: "待发货", count: orders.filter((order) => fulfillmentActions(order).ship).length },
    { key: "SHIPPED", label: "已发货", count: orders.filter((order) => isShipped(order.fulfillmentStatus)).length },
    { key: "WECHAT_SYNC", label: "微信同步待处理", count: orders.filter(needsWeChatShippingSync).length },
    { key: "AFTER_SALES", label: "售后中", count: orders.filter(hasOpenAfterSales).length },
    { key: "COMPLETED", label: "已完成", count: orders.filter((order) => isCompleted(order.status)).length },
    { key: "CANCELLED", label: "已关闭", count: orders.filter((order) => isClosed(order.status)).length },
    { key: "ANOMALY", label: "支付待核对", count: orders.filter((order) => isAnomaly(order)).length },
  ];
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function matchesTab(order: AdminOrder, tab: OrderTab) {
  if (tab === "ALL") return true;
  if (tab === "PENDING_PAYMENT") return needsPaymentReview(order);
  if (tab === "PICKUP") return !!order.pickup;
  if (tab === "PENDING_SHIPMENT") return fulfillmentActions(order).ship;
  if (tab === "SHIPPED") return isShipped(order.fulfillmentStatus);
  if (tab === "WECHAT_SYNC") return needsWeChatShippingSync(order);
  if (tab === "AFTER_SALES") return hasOpenAfterSales(order);
  if (tab === "COMPLETED") return isCompleted(order.status);
  if (tab === "CANCELLED") return isClosed(order.status);
  return isAnomaly(order);
}

function sortOrders(a: AdminOrder, b: AdminOrder, sortMode: SortMode) {
  if (sortMode === "AMOUNT_DESC") return b.payableAmountCents - a.payableAmountCents;
  if (sortMode === "AMOUNT_ASC") return a.payableAmountCents - b.payableAmountCents;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function summarizeItems(items: AdminOrderItem[]) {
  if (!items.length) return "无商品快照";
  return items.map((item) => item.productName).join("、");
}

function getItemQuantity(order: AdminOrder) {
  return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

function isPaid(status: string) {
  return status.toUpperCase() === "PAID";
}


function isShipped(status: string) {
  return ["SHIPPED", "DELIVERED"].includes(status.toUpperCase());
}

function isClosed(status: string) {
  return ["CANCELLED", "CANCELED", "CLOSED"].includes(status.toUpperCase());
}

function isCompleted(status: string) {
  return ["COMPLETED", "FINISHED"].includes(status.toUpperCase());
}

function isAnomaly(order: AdminOrder) { return needsPaymentReview(order); }

function hasOpenAfterSales(order: AdminOrder) {
  return order.afterSalesRequests?.some(request => {
    if (!request || typeof request !== "object" || !("status" in request) || typeof request.status !== "string") return true;
    return !["COMPLETED", "REJECTED", "CANCELLED"].includes(request.status.toUpperCase());
  }) ?? false;
}

function getPreferredOrder(orders: AdminOrder[]) {
  let preferred: AdminOrder | undefined;
  let preferredPriority = Number.MAX_SAFE_INTEGER;
  for (const order of orders) {
    const priority = getOrderPriority(order);
    if (priority < preferredPriority) {
      preferred = order;
      preferredPriority = priority;
    }
  }
  return preferred;
}

function getOrderPriority(order: AdminOrder) {
  if (isAnomaly(order)) return 0;
  if (hasOpenAfterSales(order)) return 1;
  if (fulfillmentActions(order).ship) return 2;
  if (needsPaymentReview(order)) return 3;
  if (isShipped(order.fulfillmentStatus) && order.fulfillmentStatus.toUpperCase() !== "DELIVERED") return 4;
  return 10;
}

function getOrderSecondaryAction(order: AdminOrder) {
  const orderNo = encodeURIComponent(order.orderNo);
  const shipmentId = order.shipments?.[0]?.id;
  if (fulfillmentActions(order).ship) {
    return { href: `/admin/orders/${orderNo}#fulfillment-task`, label: "安排发货" };
  }
  if (hasOpenAfterSales(order)) {
    return { href: `/admin/after-sales?order=${orderNo}`, label: "处理售后" };
  }
  if (shipmentId && isShipped(order.fulfillmentStatus)) {
    return { href: `/admin/orders/${orderNo}#fulfillment-task`, label: "查看物流" };
  }
  if (needsPaymentReview(order)) {
    return { href: `/admin/orders/${orderNo}#payment-task`, label: "核对支付" };
  }
  if ((order.afterSalesRequests?.length ?? 0) > 0) return { href: `/admin/after-sales?order=${orderNo}`, label: "查看售后" };
  return null;
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("zh-CN", {
    currency: "CNY",
    style: "currency",
  }).format(cents / 100);
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Download, Filter, Search } from "lucide-react";
import { exportRowsAsCsv, getPageCount, getPageItems } from "@/lib/client/admin-table-actions";
import { getAfterSalesNextStatuses, type AfterSalesStatus, type AfterSalesType } from "@/lib/after-sales/state-machine";
import { formatAfterSalesStatusLabel, formatAfterSalesTypeLabel, formatStatusLabel } from "@/lib/display-labels";

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

type AfterSalesTab = "ALL" | "MERCHANT_PENDING" | "BUYER_PENDING" | "RETURN_PENDING" | "REFUND_PENDING" | "SETTLEMENT_PENDING" | "COMPLETED" | "REJECTED" | "ANOMALY";

const terminalStatuses = new Set<AfterSalesStatus>(["rejected", "completed", "cancelled"]);
const merchantPendingStatuses = new Set<AfterSalesStatus>(["submitted", "reviewing", "received", "inspecting"]);
const buyerPendingStatuses = new Set<AfterSalesStatus>(["approved", "waiting_return"]);
const returnPendingStatuses = new Set<AfterSalesStatus>(["return_in_transit"]);
const refundPendingStatuses = new Set<AfterSalesStatus>(["refund_processing"]);

export function AfterSalesAdminTable({ afterSales }: { afterSales: AdminAfterSales[] }) {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(() => searchParams.get("order") ?? "");
  const [tab, setTab] = useState<AfterSalesTab>("ALL");
  const [type, setType] = useState("ALL");
  const [selectedNo, setSelectedNo] = useState(() => getPreferredAfterSales(afterSales)?.afterSalesNo ?? "");
  const [page, setPage] = useState(1);
  const types = useMemo(() => uniqueValues(afterSales.map((request) => request.type)), [afterSales]);
  const tabs = useMemo(() => buildTabs(afterSales), [afterSales]);
  const filteredAfterSales = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return afterSales.filter((request) => {
      if (!matchesTab(request, tab)) return false;
      if (type !== "ALL" && request.type !== type) return false;
      if (!normalizedQuery) return true;
      const text = [
        request.afterSalesNo,
        request.orderNo,
        request.userId,
        request.type,
        request.status,
        request.reason,
        request.description,
        ...request.items.flatMap((item) => [item.productName, item.color, item.size, item.orderItemId]),
      ]
        .join(" ")
        .toLowerCase();
      return text.includes(normalizedQuery);
    });
  }, [afterSales, query, tab, type]);

  const pageCount = getPageCount(filteredAfterSales.length);
  const currentPage = Math.min(page, pageCount);
  const visibleAfterSales = useMemo(() => getPageItems(filteredAfterSales, currentPage), [currentPage, filteredAfterSales]);
  const selectedRequest = filteredAfterSales.find((request) => request.afterSalesNo === selectedNo) ?? getPreferredAfterSales(filteredAfterSales) ?? getPreferredAfterSales(afterSales);

  function resetFilters() {
    setQuery("");
    setTab("ALL");
    setType("ALL");
    setPage(1);
  }

  function exportAfterSales() {
    exportRowsAsCsv("merchantkit-after-sales.csv", filteredAfterSales, [
      { header: "售后单号", value: (request) => request.afterSalesNo },
      { header: "订单号", value: (request) => request.orderNo },
      { header: "类型", value: (request) => formatAfterSalesTypeLabel(request.type) },
      { header: "状态", value: (request) => formatAfterSalesStatusLabel(request.status) },
      { header: "原因", value: (request) => request.reason },
      { header: "退款金额", value: (request) => request.refundAmountCents / 100 },
      { header: "创建时间", value: (request) => formatDateTime(request.createdAt) },
    ]);
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

          <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(260px,1fr)_180px_84px_84px]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#667085]" />
              <input
                className="vk-admin-filter h-11 pl-9"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="搜索售后单号 / 订单号 / 商品名 / SKU"
                type="search"
                value={query}
              />
            </label>
            <select className="vk-admin-filter h-11" onChange={(event) => {
              setType(event.target.value);
              setPage(1);
            }} value={type}>
              <option value="ALL">全部类型</option>
              {types.map((item) => (
                <option key={item} value={item}>{formatAfterSalesTypeLabel(item)}</option>
              ))}
            </select>
            <button className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] border border-[#d8dde5] bg-white px-3 text-sm font-black text-[#344054]" onClick={resetFilters} type="button">
              <Filter className="h-4 w-4" />
              清空
            </button>
            <button className="inline-flex h-11 items-center justify-center gap-2 rounded-[8px] border border-[#d8dde5] bg-white px-3 text-sm font-black text-[#344054]" onClick={exportAfterSales} type="button">
              <Download className="h-4 w-4" />
              导出
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left text-xs">
            <thead className="bg-[#f8fafc] text-[#667085]">
              <tr className="border-b border-[#eef1f5]">
                <Th>售后单号</Th>
                <Th>订单号</Th>
                <Th>商品</Th>
                <Th>原因</Th>
                <Th>状态</Th>
                <Th>退款金额</Th>
                <Th>时间</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef1f5]">
              {visibleAfterSales.map((request) => (
                <AfterSalesRow
                  key={request.id}
                  onSelect={() => setSelectedNo(request.afterSalesNo)}
                  request={request}
                  selected={selectedRequest?.afterSalesNo === request.afterSalesNo}
                />
              ))}
              {filteredAfterSales.length === 0 ? (
                <tr>
                  <td className="px-4 py-10 text-sm font-bold text-[#697386]" colSpan={8}>
                    {afterSales.length === 0 ? "暂无售后记录。" : "没有匹配的售后记录，请调整搜索、筛选或状态 Tab。"}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-[#eef1f5] px-4 py-3 text-xs font-bold text-[#697386] md:flex-row md:items-center md:justify-between">
          <span>共 {filteredAfterSales.length} / {afterSales.length} 条</span>
          <div className="flex items-center gap-2">
            <button className="h-8 rounded-[8px] border border-[#d8dde5] px-3 disabled:cursor-not-allowed disabled:opacity-50" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">上一页</button>
            <span className="flex h-8 min-w-12 items-center justify-center rounded-[8px] bg-[#155eef] px-2 font-black text-white">{currentPage}/{pageCount}</span>
            <button className="h-8 rounded-[8px] border border-[#d8dde5] px-3 disabled:cursor-not-allowed disabled:opacity-50" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">下一页</button>
          </div>
        </div>
      </div>

      <AfterSalesDetailPanel request={selectedRequest} />
    </section>
  );
}

function AfterSalesRow({ onSelect, request, selected }: { onSelect: () => void; request: AdminAfterSales; selected: boolean }) {
  const allowedNextStatuses = getAfterSalesNextStatuses(request.status, request.type);
  return (
    <tr className={selected ? "bg-[#f5f8ff] shadow-[inset_3px_0_0_#155eef]" : "hover:bg-[#fbfcfd]"}>
      <td className="px-4 py-3">
        <button aria-pressed={selected} className="font-black text-[#101828]" onClick={onSelect} type="button">{request.afterSalesNo}</button>
      </td>
      <td className="px-4 py-3 font-bold text-[#344054]">{request.orderNo}</td>
      <td className="px-4 py-3">
        <p className="line-clamp-2 max-w-[240px] font-black text-[#344054]">{summarizeItems(request.items)}</p>
        <p className="mt-1 font-bold text-[#98a2b3]">{formatAfterSalesTypeLabel(request.type)}</p>
      </td>
      <td className="px-4 py-3 font-bold text-[#344054]">{request.reason || "未填写"}</td>
      <td className="px-4 py-3"><StatusPill value={formatAfterSalesStatusLabel(request.status)} tone={terminalStatuses.has(request.status) ? "slate" : "orange"} /></td>
      <td className="px-4 py-3 font-black text-[#101828]">{formatMoney(request.refundAmountCents)}</td>
      <td className="px-4 py-3 font-bold text-[#344054]">{formatDate(request.createdAt)}</td>
      <td className="px-4 py-3">
        <div className="grid gap-1">
          <ActionLink href={`/admin/after-sales/${request.afterSalesNo}`}>查看详情</ActionLink>
          {allowedNextStatuses.length ? <span className="text-[11px] font-bold text-[#98a2b3]">下一步 {allowedNextStatuses.map(formatStatusLabel).join("、")}</span> : null}
        </div>
      </td>
    </tr>
  );
}

function AfterSalesDetailPanel({ request }: { request: AdminAfterSales | undefined }) {
  if (!request) {
    return (
      <aside className="rounded-[8px] border border-[#e4e7ec] bg-white p-5 text-sm font-bold text-[#697386]">
        请选择一笔售后单查看详情。
      </aside>
    );
  }
  const allowedNextStatuses = getAfterSalesNextStatuses(request.status, request.type);
  return (
    <aside className="grid gap-4 2xl:sticky 2xl:top-[112px] 2xl:self-start">
      <section className="rounded-[8px] border border-[#e4e7ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-black text-[#101828]">售后单详情</h3>
          <StatusPill value={formatAfterSalesStatusLabel(request.status)} tone={terminalStatuses.has(request.status) ? "slate" : "orange"} />
        </div>
        <dl className="mt-4 grid gap-3 text-sm">
          <DetailRow label="售后单号" value={request.afterSalesNo} />
          <DetailRow label="订单号" value={request.orderNo} />
          <DetailRow label="售后类型" value={formatAfterSalesTypeLabel(request.type)} />
          <DetailRow label="售后原因" value={request.reason || "未填写"} />
          <DetailRow label="申请时间" value={formatDateTime(request.createdAt)} />
        </dl>
        <div className="mt-4 border-t border-[#eef1f5] pt-4">
          <h4 className="text-sm font-black text-[#101828]">商品信息</h4>
          <div className="mt-3 grid gap-2">
            {request.items.slice(0, 3).map((item) => (
              <div className="rounded-[8px] bg-[#f8fafc] px-3 py-3" key={item.orderItemId}>
                <p className="line-clamp-2 text-sm font-black text-[#344054]">{item.productName}</p>
                <p className="mt-1 text-xs font-bold text-[#697386]">{item.color} / {item.size} x{item.quantity}</p>
                <p className="mt-1 text-sm font-black text-[#101828]">{formatMoney(item.refundAmountCents)}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-4 border-t border-[#eef1f5] pt-4">
          <h4 className="text-sm font-black text-[#101828]">用户描述</h4>
          <p className="mt-2 text-xs font-bold leading-5 text-[#697386]">{request.description || "未填写描述"}</p>
          <p className="mt-3 text-xs font-bold text-[#697386]">图片凭证：{request.imageUrls.length} 张</p>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Link className="vk-button vk-button-dark" href={`/admin/after-sales/${request.afterSalesNo}`}>
            进入处理
          </Link>
          <Link className="vk-button vk-button-light" href={`/admin/orders/${encodeURIComponent(request.orderNo)}`}>
            查看订单
          </Link>
        </div>
      </section>

      <section className="rounded-[8px] border border-[#e4e7ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
        <h3 className="text-base font-black text-[#101828]">可执行操作</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {allowedNextStatuses.length ? (
            allowedNextStatuses.map((status) => <StatusPill key={status} value={formatStatusLabel(status)} tone="blue" />)
          ) : (
            <StatusPill value="已无下一步" tone="slate" />
          )}
        </div>
        <p className="mt-3 text-xs font-bold leading-5 text-[#697386]">审核、拒绝、确认收货、退款与补发都在详情页执行，列表只负责定位和分流。</p>
      </section>
    </aside>
  );
}

function getPreferredAfterSales(requests: AdminAfterSales[]) {
  let preferred: AdminAfterSales | undefined;
  let preferredPriority = Number.MAX_SAFE_INTEGER;
  for (const request of requests) {
    const priority = getAfterSalesPriority(request.status);
    if (priority < preferredPriority) {
      preferred = request;
      preferredPriority = priority;
    }
  }
  return preferred;
}

function getAfterSalesPriority(status: AfterSalesStatus) {
  if (merchantPendingStatuses.has(status)) return 0;
  if (refundPendingStatuses.has(status)) return 1;
  if (returnPendingStatuses.has(status)) return 2;
  if (buyerPendingStatuses.has(status)) return 3;
  return terminalStatuses.has(status) ? 10 : 4;
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

function buildTabs(afterSales: AdminAfterSales[]): Array<{ key: AfterSalesTab; label: string; count: number }> {
  return [
    { key: "ALL", label: "全部", count: afterSales.length },
    { key: "MERCHANT_PENDING", label: "待审核", count: afterSales.filter((request) => merchantPendingStatuses.has(request.status)).length },
    { key: "BUYER_PENDING", label: "待买家退货", count: afterSales.filter((request) => buyerPendingStatuses.has(request.status)).length },
    { key: "RETURN_PENDING", label: "待确认收货", count: afterSales.filter((request) => returnPendingStatuses.has(request.status)).length },
    { key: "REFUND_PENDING", label: "待退款", count: afterSales.filter((request) => refundPendingStatuses.has(request.status)).length },
    { key: "SETTLEMENT_PENDING", label: "待收尾", count: afterSales.filter((request) => request.status === "refunded").length },
    { key: "COMPLETED", label: "已完成", count: afterSales.filter((request) => request.status === "completed").length },
    { key: "REJECTED", label: "已拒绝", count: afterSales.filter((request) => request.status === "rejected").length },
    { key: "ANOMALY", label: "异常售后", count: afterSales.filter((request) => isAnomaly(request)).length },
  ];
}

function matchesTab(request: AdminAfterSales, tab: AfterSalesTab) {
  if (tab === "ALL") return true;
  if (tab === "MERCHANT_PENDING") return merchantPendingStatuses.has(request.status);
  if (tab === "BUYER_PENDING") return buyerPendingStatuses.has(request.status);
  if (tab === "RETURN_PENDING") return returnPendingStatuses.has(request.status);
  if (tab === "REFUND_PENDING") return refundPendingStatuses.has(request.status);
  if (tab === "SETTLEMENT_PENDING") return request.status === "refunded";
  if (tab === "COMPLETED") return request.status === "completed";
  if (tab === "REJECTED") return request.status === "rejected";
  return isAnomaly(request);
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
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

function summarizeItems(items: AdminAfterSalesItem[]) {
  if (!items.length) return "无售后商品";
  return items.map((item) => `${item.productName} ${item.color}/${item.size} x${item.quantity}`).join("、");
}

function isAnomaly(request: AdminAfterSales) {
  return request.status === "cancelled" || Boolean(request.rejectReason);
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("zh-CN", {
    currency: "CNY",
    style: "currency",
  }).format(cents / 100);
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function formatDateTime(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

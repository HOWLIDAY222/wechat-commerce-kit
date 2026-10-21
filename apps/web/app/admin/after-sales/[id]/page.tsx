import { getOrderRefundSummaryByOrderNo } from "@/lib/services/wechat-refund-read-model";
import { RefundSummaryPanel } from "@/components/storefront/refund-summary-panel";
import Link from "next/link";
import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { fetchAdminJson } from "@/app/admin/_lib/admin-page-fetch";
import { AfterSalesTransitionForm } from "@/app/admin/after-sales/after-sales-transition-form";
import { RefundTaskForm } from "@/app/admin/after-sales/refund-task-form";
import { ReshipmentTaskForm } from "@/app/admin/after-sales/reshipment-task-form";
import { canExecuteProviderRefund } from "@/lib/admin/permission-policy";
import { getAfterSalesNextStatuses, type AfterSalesStatus, type AfterSalesType } from "@/lib/after-sales/state-machine";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import { formatAfterSalesTypeLabel, formatStatusLabel } from "@/lib/display-labels";
import { getAfterSalesAdminOperations } from "@/lib/services/after-sales-service";

type AdminAfterSalesDetailProps = {
  params: Promise<{ id: string }>;
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
  returnAddress?: string;
  returnTrackingCompany?: string;
  returnTrackingNo?: string;
  messages?: Array<{ id: string; senderType: string; message: string; createdAt: string }>;
  createdAt: string;
  updatedAt: string;
};

type AfterSalesResponse = {
  ok: boolean;
  afterSales: AdminAfterSales[];
};

export const dynamic = "force-dynamic";

export const metadata = {
  title: "售后详情 | MerchantKit Admin",
  description: "MerchantKit 后台售后详情页，用于查看售后编号、订单、商品、凭证和处理状态。",
};

export default async function AdminAfterSalesDetailPage({ params }: AdminAfterSalesDetailProps) {
  const { id } = await params;
  const { afterSales } = await fetchAdminJson<AfterSalesResponse>("/api/admin/after-sales");
  const request = afterSales.find((item) => item.afterSalesNo === id || item.id === id);
  const session = await readCurrentAdminSession();
  const operations = request ? await getAfterSalesAdminOperations(request.afterSalesNo, request.orderNo) : { refunds: [], reshipments: [] };
  const refundSummary = request && appConfig.COMMERCE_STORAGE === "prisma" ? await getOrderRefundSummaryByOrderNo(request.orderNo) : null;
  const frameMetrics = [
    { label: "售后号", value: request?.afterSalesNo ?? id },
    { label: "状态", value: request ? formatStatusLabel(request.status) : "未找到" },
    { label: "商品行", value: (request?.items.length ?? 0).toString() },
    { label: "凭证", value: (request?.imageUrls.length ?? 0).toString() },
  ];

  return (
    <AdminFrame active="after-sales" metrics={frameMetrics} title="售后详情" subtitle="详情页用于核对售后证据、订单商品和状态，不在这里绕过状态机。">
      <section className="border border-[#d8dde5] bg-white px-4 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <Link className="vk-admin-link" href="/admin/after-sales">返回售后工作台</Link>
            <h2 className="mt-3 break-words text-2xl font-black">售后 {request?.afterSalesNo ?? id}</h2>
          </div>
          {request ? (
            <div className="flex flex-wrap gap-3">
              <Link className="vk-button vk-button-light" href={`/admin/orders/${encodeURIComponent(request.orderNo)}`}>
                查看订单
              </Link>
              <Link className="vk-button vk-button-light" href={`/admin/users/${encodeURIComponent(request.userId)}`}>
                查看用户
              </Link>
            </div>
          ) : null}
        </div>
        <RefundSummaryPanel summary={refundSummary} admin />
        {!request ? (
          <p className="mt-4 rounded-[8px] bg-[#fff7ed] px-4 py-3 text-sm font-bold text-[#9a3412]">没有找到这条售后记录。</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <section className="rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4">
              <h2 className="text-base font-black">基础信息</h2>
              <dl className="mt-3 grid gap-3 text-xs font-bold">
                <Info label="订单号" value={request.orderNo} />
                <Info label="用户" value={request.userId} />
                <Info label="类型" value={formatAfterSalesTypeLabel(request.type)} />
                <Info label="状态" value={formatStatusLabel(request.status)} />
                <Info label="申请金额" value={formatMoney(request.refundAmountCents)} />
                <Info label="申请时间" value={formatDate(request.createdAt)} />
                <Info label="更新时间" value={formatDate(request.updatedAt)} />
              </dl>
            </section>

            <section className="rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4">
              <h2 className="text-base font-black">状态流转</h2>
              <p className="mt-2 text-sm font-bold leading-6 text-[#697386]">
                当前状态：{formatStatusLabel(request.status)}。下一步必须按状态机推进，不能跳过审核、收货、退款或补发节点。
              </p>
              <p className="mt-2 text-xs font-bold text-[#697386]">
                可流转：{getAfterSalesNextStatuses(request.status, request.type).map(formatStatusLabel).join("、") || "无"}
              </p>
              <AfterSalesTransitionForm
                afterSalesNo={request.afterSalesNo}
                currentStatus={request.status}
                nextStatuses={getAfterSalesNextStatuses(request.status, request.type)}
                returnAddress={request.returnAddress}
              />
            </section>

            <section className="rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4 lg:col-span-2">
              <h2 className="text-base font-black">原因与描述</h2>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                <div>
                  <p className="text-xs font-black text-[#697386]">申请原因</p>
                  <p className="mt-2 text-sm font-black">{request.reason}</p>
                </div>
                <div>
                  <p className="text-xs font-black text-[#697386]">用户描述</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm font-bold leading-6 text-[#697386]">{request.description}</p>
                </div>
              </div>
              {request.rejectReason ? <p className="mt-3 text-xs font-black text-[#9a3412]">拒绝原因：{request.rejectReason}</p> : null}
            </section>

            {request.type === "return_refund" || request.type === "exchange" || request.returnAddress || request.returnTrackingCompany || request.returnTrackingNo ? <section className="rounded-[8px] border border-[#d8dde5] bg-white p-4 lg:col-span-2">
              <h2 className="text-base font-black">退货信息</h2>
              <dl className="mt-3 grid gap-3 text-xs font-bold">
                <Info label="退货地址" value={request.returnAddress || "尚未填写退货地址"} />
                <Info label="寄回物流公司" value={request.returnTrackingCompany || "客户尚未提交"} />
                <Info label="寄回运单号" value={request.returnTrackingNo || "客户尚未提交"} />
              </dl>
            </section> : null}

            <section className="rounded-[8px] border border-[#d8dde5] bg-white p-4 lg:col-span-2">
              <h2 className="text-base font-black">沟通记录</h2>
              <div className="mt-3 grid gap-3">
                {(request.messages ?? []).map((message) => (
                  <div className="border-t border-[#e6eaf0] pt-3" key={message.id}>
                    <p className="text-xs font-bold text-[#697386]">{message.senderType.toLowerCase() === "user" ? "客户" : message.senderType.toLowerCase() === "admin" ? "商家" : "系统"} · {formatDate(message.createdAt)}</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{message.message}</p>
                  </div>
                ))}
                {!request.messages?.length ? <p className="text-xs font-bold text-[#697386]">暂无沟通记录。</p> : null}
              </div>
            </section>

            <section className="rounded-[8px] border border-[#d8dde5] bg-white p-4 lg:col-span-2">
              <h2 className="text-base font-black">关联上下文</h2>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <ContextLink href={`/admin/orders/${encodeURIComponent(request.orderNo)}`} label="关联订单" value={request.orderNo} />
                <ContextLink href={`/admin/users/${encodeURIComponent(request.userId)}`} label="关联用户" value={request.userId} />
                <ContextBlock label="售后类型" value={formatAfterSalesTypeLabel(request.type)} />
              </div>
            </section>

            <section className="rounded-[8px] border border-[#d8dde5] bg-white p-4 lg:col-span-2">
              <h2 className="text-base font-black">售后商品</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-[720px] w-full text-left text-xs">
                  <thead className="text-[#697386]">
                    <tr className="border-b border-[#d8dde5]">
                      <th className="py-2 pr-3">商品</th>
                      <th className="py-2 pr-3">规格</th>
                      <th className="py-2 pr-3">数量</th>
                      <th className="py-2 pr-3">申请退款</th>
                      <th className="py-2 pr-3">订单项</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#e6eaf0]">
                    {request.items.map((item) => (
                      <tr key={item.orderItemId}>
                        <td className="py-3 pr-3 font-black">{item.productName}</td>
                        <td className="py-3 pr-3 font-bold text-[#697386]">{item.color} / {item.size}</td>
                        <td className="py-3 pr-3 font-bold">{item.quantity}</td>
                        <td className="py-3 pr-3 font-bold">{formatMoney(item.refundAmountCents)}</td>
                        <td className="py-3 pr-3 break-all font-bold text-[#697386]">{item.orderItemId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="rounded-[8px] border border-[#d8dde5] bg-white p-4 lg:col-span-2">
              <h2 className="text-base font-black">图片凭证</h2>
              <div className="mt-3 grid gap-2">
                {request.imageUrls.map((url) => (
                  <a className="vk-admin-link break-all" href={url} key={url} target="_blank" rel="noreferrer">{url}</a>
                ))}
                {request.imageUrls.length === 0 ? <p className="text-xs font-bold text-[#697386]">暂无图片凭证。</p> : null}
              </div>
            </section>

            <section className="rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4 lg:col-span-2">
              <h2 className="text-base font-black">时间线</h2>
              <div className="mt-3 grid gap-2 text-xs font-bold text-[#697386]">
                <p>创建售后：{formatDate(request.createdAt)}</p>
                <p>最近更新：{formatDate(request.updatedAt)}</p>
                <p>当前状态：{formatStatusLabel(request.status)}</p>
                <p>下一步：{getAfterSalesNextStatuses(request.status, request.type).map(formatStatusLabel).join("、") || "无可用流转"}</p>
              </div>
            </section>

            <section className="rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4 lg:col-span-2">
              <h2 className="text-base font-black">审计日志</h2>
              <p className="mt-2 text-xs font-bold leading-5 text-[#697386]">
                售后创建、凭证补充、审核、拒绝、退款处理、退款完成和补发创建都必须写入审计日志。复核时按售后号、订单号或用户 ID 检索。
              </p>
              <Link className="vk-button vk-button-light mt-3 min-h-10 px-4 text-xs" href="/admin/audit">
                查看审计日志
              </Link>
            </section>
            {operations.refunds.map((refund) => <div className="lg:col-span-2" key={refund.id}><RefundTaskForm canExecuteProviderRefund={canExecuteProviderRefund(session?.role ?? "admin", appConfig.PAYMENT_PROVIDER)} paymentRefundId={refund.paymentRefundId} refundNo={refund.refundNo} status={refund.status} /></div>)}
            {(request.type === "exchange" || request.type === "reship") ? operations.reshipments.slice(0, 1).map((reshipment) => <div className="lg:col-span-2" key={reshipment.id}><ReshipmentTaskForm {...reshipment} /></div>) : null}
          </div>
        )}
      </section>
    </AdminFrame>
  );
}

function ContextLink({ href, label, value }: { href: string; label: string; value: string }) {
  return (
    <Link className="block rounded-[8px] bg-[#f8fafc] px-3 py-3" href={href}>
      <p className="text-xs font-black text-[#697386]">{label}</p>
      <p className="mt-1 break-all text-sm font-black">{value}</p>
    </Link>
  );
}

function ContextBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] bg-[#f8fafc] px-3 py-3">
      <p className="text-xs font-black text-[#697386]">{label}</p>
      <p className="mt-1 break-all text-sm font-black">{value}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
      <dt className="text-[#697386]">{label}</dt>
      <dd className="break-all text-[#111827]">{value}</dd>
    </div>
  );
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

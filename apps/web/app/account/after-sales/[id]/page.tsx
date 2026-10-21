import { RefundSummaryPanel } from "@/components/storefront/refund-summary-panel";
import type { OrderRefundSummary } from "@/lib/services/wechat-refund-read-model";
import Link from "next/link";
import { fetchAccountJson } from "@/app/account/_lib/account-page-fetch";
import { AfterSalesImageForm } from "@/app/account/after-sales/after-sales-image-form";
import { AccountShell } from "@/components/storefront/account-shell";
import { InfoPanel, formatMoney } from "@/components/storefront/storefront-ui";
import { formatAfterSalesTypeLabel, formatAfterSalesStatusLabel, normalizeStatusKey } from "@/lib/display-labels";

type AccountAfterSalesDetailProps = {
  params: Promise<{ id: string }>;
};

export const metadata = {
  title: "售后详情",
  description: "查看 MerchantKit 售后申请详情、关联订单、商品明细、处理状态和质量问题图片凭证。",
};

type AfterSalesDetail = {
  refundSummary?: OrderRefundSummary;
  afterSalesNo: string;
  createdAt: Date | string;
  description: string;
  imageUrls: string[];
  items: Array<{
    color: string;
    productName: string;
    quantity: number;
    refundAmountCents: number;
    size: string;
  }>;
  orderNo: string;
  reason: string;
  refundAmountCents: number;
  rejectReason?: string;
  status: string;
  type: string;
};

export default async function AccountAfterSalesDetailPage({ params }: AccountAfterSalesDetailProps) {
  const { id } = await params;
  const { afterSales: request } = await fetchAccountJson<{ afterSales: AfterSalesDetail; ok: boolean }>(`/api/account/after-sales/${encodeURIComponent(id)}`);
  if (!request) {
    return (
      <AccountShell active="after-sales" description="没有找到属于当前账户的售后申请。" eyebrow="售后详情" title="售后不存在">
        <Link className="vk-button vk-button-light" href="/account/after-sales">返回售后列表</Link>
      </AccountShell>
    );
  }

  const canAddImage = normalizeStatusKey(request.type) === "QUALITY_ISSUE" && !["CANCELLED", "REJECTED", "REFUNDED", "COMPLETED"].includes(normalizeStatusKey(request.status));

  return (
    <AccountShell
      active="after-sales"
      actions={<Link className="vk-button vk-button-light" href="/account/after-sales">返回售后列表</Link>}
      description={`关联订单 ${request.orderNo}，创建时间 ${formatDate(request.createdAt)}。`}
      eyebrow="售后详情"
      title={`售后 ${request.afterSalesNo}`}
    >
      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-5">
          <InfoPanel className="p-5">
            <h2 className="text-2xl font-black">申请商品</h2>
            <div className="mt-4 grid gap-3">
              {request.items.map((item, index) => (
                <div className="grid gap-2 border-t border-line pt-4 md:grid-cols-[1fr_auto]" key={`${request.afterSalesNo}-${item.productName}-${index}`}>
                  <div>
                    <p className="text-lg font-black">{item.productName}</p>
                    <p className="mt-1 text-sm font-bold text-muted">
                      {item.color} / {item.size} x {item.quantity}
                    </p>
                  </div>
                  <p className="font-black">{formatMoney(item.refundAmountCents)}</p>
                </div>
              ))}
            </div>
          </InfoPanel>
          <InfoPanel className="p-5">
            <h2 className="text-2xl font-black">问题说明</h2>
            <p className="mt-3 font-bold">{request.reason}</p>
            <p className="mt-2 text-sm font-bold leading-6 text-muted">{request.description}</p>
            {request.rejectReason ? <p className="mt-4 text-sm font-black text-[#b42318]">拒绝原因：{request.rejectReason}</p> : null}
          </InfoPanel>
          <InfoPanel className="p-5">
            <h2 className="text-2xl font-black">图片凭证</h2>
            <div className="mt-4 grid gap-2">
              {request.imageUrls.map((imageUrl) => (
                <a className="break-all text-sm font-bold text-brand underline" href={imageUrl} key={imageUrl} rel="noreferrer" target="_blank">
                  {imageUrl}
                </a>
              ))}
              {request.imageUrls.length === 0 ? <p className="text-sm font-bold text-muted">暂无图片凭证。</p> : null}
            </div>
            <AfterSalesImageForm afterSalesNo={request.afterSalesNo} disabled={!canAddImage} />
          </InfoPanel>
        </div>
        <aside className="h-fit">
          <InfoPanel className="p-6">
            <h2 className="text-xl font-black">售后状态</h2>
            <div className="mt-5 grid gap-3 text-sm font-bold">
              <Row label="售后类型" value={formatAfterSalesTypeLabel(request.type)} />
              <Row label="当前状态" value={formatAfterSalesStatusLabel(request.status)} />
              <Row label="申请金额" value={formatMoney(request.refundAmountCents)} strong />
            </div>
            <RefundSummaryPanel summary={request.refundSummary} />
            <Link className="vk-button vk-button-dark mt-6 w-full" href={`/account/orders/${encodeURIComponent(request.orderNo)}`}>查看订单</Link>
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

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

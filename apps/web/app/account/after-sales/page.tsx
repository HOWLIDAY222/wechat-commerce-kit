import Link from "next/link";
import { fetchAccountJson } from "@/app/account/_lib/account-page-fetch";
import { AccountShell } from "@/components/storefront/account-shell";
import { EmptyState, InfoPanel, formatMoney } from "@/components/storefront/storefront-ui";
import { formatAfterSalesTypeLabel, formatStatusLabel } from "@/lib/display-labels";

export const metadata = {
  description: "查看 MerchantKit 账户售后申请列表、售后状态、退款金额和关联订单。",
  title: "我的售后",
};

type AfterSalesItem = {
  productName: string;
  quantity: number;
  refundAmountCents: number;
};

type AfterSalesRequest = {
  afterSalesNo: string;
  createdAt: Date | string;
  items: AfterSalesItem[];
  orderNo: string;
  refundAmountCents: number;
  status: string;
  type: string;
};

export default async function AccountAfterSalesPage() {
  const { afterSales } = await fetchAccountJson<{ afterSales: AfterSalesRequest[]; ok: boolean }>("/api/account/after-sales");

  return (
    <AccountShell
      active="after-sales"
      actions={<Link className="vk-button vk-button-dark" href="/account/orders">从订单申请</Link>}
      description="查看售后申请、审核状态、退款金额和相关订单。售后需从已支付订单详情发起。"
      eyebrow="售后申请"
      title="我的售后"
    >
      <section className="grid gap-5">
        {afterSales.map((request) => (
          <InfoPanel className="p-5" key={request.afterSalesNo}>
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_220px]">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="break-all text-2xl font-black">{request.afterSalesNo}</h2>
                  <span className="rounded-full border border-line px-3 py-1 text-xs font-black">{formatAfterSalesTypeLabel(request.type)}</span>
                  <span className="rounded-full border border-line px-3 py-1 text-xs font-black">{formatStatusLabel(request.status)}</span>
                </div>
                <p className="mt-2 break-all text-sm font-bold text-muted">订单：{request.orderNo} / {formatDate(request.createdAt)}</p>
                <div className="mt-4 grid gap-2">
                  {request.items.map((item, index) => (
                    <p className="text-sm font-bold text-muted" key={`${request.afterSalesNo}-${item.productName}-${index}`}>
                      {item.productName} x {item.quantity} / 申请金额 {formatMoney(item.refundAmountCents)}
                    </p>
                  ))}
                </div>
              </div>
              <div className="grid content-between gap-4">
                <div>
                  <p className="text-sm font-bold text-muted">申请退款金额</p>
                  <p className="mt-1 text-3xl font-black">{formatMoney(request.refundAmountCents)}</p>
                </div>
                <Link className="vk-button vk-button-dark" href={`/account/after-sales/${encodeURIComponent(request.afterSalesNo)}`}>查看详情</Link>
              </div>
            </div>
          </InfoPanel>
        ))}
        {afterSales.length === 0 ? (
          <EmptyState actionHref="/account/orders" actionLabel="查看订单" title="还没有售后申请" body="进入已支付订单详情后，可以选择商品并提交售后申请。" />
        ) : null}
      </section>
    </AccountShell>
  );
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

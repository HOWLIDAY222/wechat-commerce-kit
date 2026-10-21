import type { OrderRefundSummary } from "@/lib/services/wechat-refund-read-model";

export function RefundSummaryPanel({ summary, admin = false }: { summary?: OrderRefundSummary | null; admin?: boolean }) {
  if (!summary || summary.state === "NONE" || summary.state === "REQUESTED") return null;
  const title = summary.fullyRefunded ? "已退款" : summary.succeededAmountCents > 0 ? "部分退款" : "退款处理中";
  const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
  return (
    <section aria-label="订单退款" className="mt-4 rounded-[8px] border border-[#dedede] bg-[#fafafa] p-4">
      <h2 className="text-base font-bold">订单退款 · {title}</h2>
      <dl className="mt-3 grid gap-2 text-sm">
        {summary.succeededAmountCents > 0 ? <div className="flex flex-wrap justify-between gap-3"><dt>已退金额</dt><dd className="font-bold">{money(summary.succeededAmountCents)}</dd></div> : null}
        {summary.processingAmountCents > 0 ? <div className="flex flex-wrap justify-between gap-3"><dt>处理中</dt><dd className="font-bold">{money(summary.processingAmountCents)}</dd></div> : null}
      </dl>
      {admin && summary.requiresAfterSalesReview ? <p className="mt-3 font-bold">售后关联待核对</p> : null}
    </section>
  );
}

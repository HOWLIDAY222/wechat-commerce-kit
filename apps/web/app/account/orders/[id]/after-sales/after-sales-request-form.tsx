"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { InfoPanel, formatMoney } from "@/components/storefront/storefront-ui";

type OrderItem = {
  color: string;
  id: string;
  productName: string;
  quantity: number;
  size: string;
  unitPriceCents: number;
  discountShareCents?: number;
};

type AfterSalesRequestFormProps = {
  canApply: boolean;
  fulfillmentStatus: string;
  items: OrderItem[];
  orderNo: string;
};

type RequestResult = {
  afterSalesNo?: string;
  message: string;
  tone: "idle" | "success" | "error";
};

const afterSalesTypes = [
  { label: "退货退款", value: "return_refund" },
  { label: "换货", value: "exchange" },
  { label: "仅退款", value: "refund_only" },
  { label: "补发", value: "reship" },
  { label: "质量问题", value: "quality_issue" },
];

export function AfterSalesRequestForm({ canApply: allowedToApply, fulfillmentStatus, items, orderNo }: AfterSalesRequestFormProps) {
  const pricingReady = items.every((item) => Number.isFinite(item.discountShareCents));
  const canApply = allowedToApply && pricingReady;
  const physicalAfterSalesAvailable = fulfillmentStatus.toLowerCase() === "delivered";
  const availableTypes = physicalAfterSalesAvailable ? afterSalesTypes : afterSalesTypes.filter((type) => type.value === "refund_only");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RequestResult>({
    message: !pricingReady ? "订单的商品优惠明细尚未确认，请联系客服处理售后金额。" : canApply
      ? physicalAfterSalesAvailable ? "选择商品和售后类型后提交申请。" : "商品尚未签收，当前仅可申请仅退款。"
      : "只有已支付订单可以申请售后。",
    tone: "idle",
  });

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canApply || busy) return;
    const form = new FormData(event.currentTarget);
    const selectedItems = items
      .filter((item) => form.get(`item-${item.id}`) === "on")
      .map((item) => {
        const quantity = Number(form.get(`quantity-${item.id}`) ?? 1);
        const refundYuan = String(form.get(`refund-${item.id}`) ?? "").trim();
        return {
          orderItemId: item.id,
          quantity: Number.isInteger(quantity) && quantity > 0 ? Math.min(quantity, item.quantity) : 1,
          refundAmountCents: refundYuan ? Math.round(Number(refundYuan) * 100) : item.unitPriceCents * item.quantity - (item.discountShareCents ?? 0),
        };
      });
    const imageUrl = String(form.get("imageUrl") ?? "").trim();

    if (selectedItems.length === 0) {
      setResult({ message: "请至少选择一件需要售后的商品。", tone: "error" });
      return;
    }

    setBusy(true);
    setResult({ message: "正在提交售后申请...", tone: "idle" });
    try {
    const response = await fetch("/api/account/after-sales", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderNo,
        type: String(form.get("type") ?? "return_refund"),
        reason: String(form.get("reason") ?? "").trim(),
        description: String(form.get("description") ?? "").trim(),
        items: selectedItems,
        imageUrls: imageUrl ? [imageUrl] : [],
      }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      afterSales?: { afterSalesNo?: string };
      error?: string;
      ok?: boolean;
    };
    setBusy(false);

    if (!response.ok || !payload.ok || !payload.afterSales?.afterSalesNo) {
      setResult({ message: formatAfterSalesError(payload.error, "售后申请提交失败。"), tone: "error" });
      return;
    }

    setResult({
      afterSalesNo: payload.afterSales.afterSalesNo,
      message: `售后申请 ${payload.afterSales.afterSalesNo} 已提交。`,
      tone: "success",
    });
    } catch {
      setResult({ message: "连接中断，请先在我的售后中检查是否已提交。", tone: "error" });
    } finally { setBusy(false); }
  }

  return (
    <form className="grid gap-5" onSubmit={submitRequest}>
      <InfoPanel className="p-5">
        <label className="vk-field">
          售后类型
          <select disabled={!canApply || busy} name="type" required>
            {availableTypes.map((type) => (
              <option key={type.value} value={type.value}>{type.label}</option>
            ))}
          </select>
        </label>
      </InfoPanel>

      <div className="grid gap-4">
        {items.map((item) => (
          <InfoPanel className="p-5" key={item.id}>
            <label className="grid gap-4">
              <span className="flex items-start gap-3">
                <input className="mt-1 size-5" disabled={!canApply || busy} name={`item-${item.id}`} type="checkbox" />
                <span>
                  <span className="block text-lg font-black">{item.productName}</span>
                  <span className="mt-1 block text-sm font-bold text-muted">
                    {item.color} / {item.size} x {item.quantity} / {formatMoney(item.unitPriceCents)}
                  </span>
                </span>
              </span>
              <span className="grid gap-3 md:grid-cols-2">
                <span className="vk-field">
                  申请数量
                  <input defaultValue={item.quantity} disabled={!canApply || busy} max={item.quantity} min={1} name={`quantity-${item.id}`} type="number" />
                </span>
                <span className="vk-field">
                  申请金额
                  <input defaultValue={item.discountShareCents === undefined ? "" : (item.unitPriceCents * item.quantity - item.discountShareCents) / 100} disabled={!canApply || busy} min={0} name={`refund-${item.id}`} step="0.01" type="number" />
                </span>
              </span>
            </label>
          </InfoPanel>
        ))}
      </div>

      <InfoPanel className="p-5">
        <div className="grid gap-4">
          <label className="vk-field">
            原因
            <input disabled={!canApply || busy} name="reason" placeholder="例如尺码不合适、质量问题、少发漏发" required />
          </label>
          <label className="vk-field">
            说明
            <textarea disabled={!canApply || busy} name="description" placeholder="补充问题描述，方便客服审核。" required />
          </label>
          <label className="vk-field">
            图片 URL（质量问题可填）
            <input disabled={!canApply || busy} name="imageUrl" placeholder="https://example.com/photo.jpg" type="url" />
          </label>
        </div>
      </InfoPanel>

      <button className="vk-button vk-button-dark h-12 w-max min-w-[180px]" disabled={!canApply || busy} type="submit">
        {busy ? "提交中..." : "提交售后申请"}
      </button>
      <p className={statusClass(result.tone)} role="status">{result.message}</p>
      {result.afterSalesNo ? (
        <Link className="vk-button vk-button-light w-max" href={`/account/after-sales/${encodeURIComponent(result.afterSalesNo)}`}>
          查看售后详情
        </Link>
      ) : null}
    </form>
  );
}

function formatAfterSalesError(error: string | undefined, fallback: string) {
  const messages: Record<string, string> = {
    AFTER_SALES_ITEMS_REQUIRED: "请至少选择一件需要售后的商品。",
    AUTH_REQUIRED: "请先登录。",
    INVALID_AFTER_SALES_REQUEST: "请完整填写售后类型、原因、说明和商品。",
    INVALID_AFTER_SALES_QUANTITY: "申请数量超过订单中的可售后数量，请重新填写。",
    INVALID_REFUND_AMOUNT: "申请金额不正确，请核对商品单价和数量。",
    ORDER_ITEM_ALREADY_REFUNDED: "所选商品已经退款完成，不能重复申请。",
    ORDER_ITEM_NOT_FOUND: "所选商品不属于这笔订单，请返回订单详情重新进入。",
    ORDER_NOT_DELIVERED_AFTER_SALES_FORBIDDEN: "商品尚未签收，当前仅可申请仅退款。",
    ORDER_NOT_FOUND: "订单不存在或不属于当前账户。",
    REFUND_AMOUNT_EXCEEDS_ORDER: "申请金额超过订单实付金额，请重新核对。",
    UNPAID_ORDER_AFTER_SALES_FORBIDDEN: "只有已支付订单可以申请售后。",
  };
  return error ? (messages[error] ?? fallback) : fallback;
}

function statusClass(tone: RequestResult["tone"]) {
  if (tone === "success") return "rounded-[8px] bg-[#ecfdf3] px-4 py-3 text-sm font-black text-[#067647]";
  if (tone === "error") return "rounded-[8px] bg-[#fff1f3] px-4 py-3 text-sm font-black text-[#b42318]";
  return "rounded-[8px] bg-soft px-4 py-3 text-sm font-bold text-muted";
}

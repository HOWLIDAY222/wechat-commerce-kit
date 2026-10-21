"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { formatAdminActionError } from "@/lib/client/admin-error-message";
import { formatOrderFulfillmentStatusLabel, formatOrderStatusLabel, formatStatusLabel } from "@/lib/display-labels";

type StatusTone = "idle" | "success" | "error";

export function OrderAdminForm({
  fulfillmentStatus,
  orderNo,
  paymentStatus,
  status,
}: {
  fulfillmentStatus: string;
  orderNo: string;
  paymentStatus: string;
  status: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("根据订单状态选择可执行动作。");
  const [tone, setTone] = useState<StatusTone>("idle");
  const actions = getAvailableActions(status, paymentStatus);

  async function submitOrderAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const action = String(form.get("action") ?? "");
    const nextStatus = resolveNextStatus(action, status, paymentStatus);
    if (!nextStatus) {
      setTone("error");
      setMessage("当前状态没有这个订单动作。");
      return;
    }
    if (action === "cancel" && !window.confirm("确认取消这笔订单？取消后不能通过后台伪造支付成功。")) return;
    if (action === "confirm" && !window.confirm("确认订单已满足进入履约条件？")) return;

    setTone("idle");
    setMessage("正在提交状态动作...");

    const response = await fetch(`/api/admin/orders/${encodeURIComponent(orderNo)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stripEmpty({
        action,
        note: String(form.get("note") ?? "").trim(),
      })),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      setTone("error");
      setMessage(formatAdminActionError(result.error, response.status, "订单更新"));
      return;
    }

    setTone("success");
    setMessage(
      nextStatus === "CANCELLED"
        ? "订单已取消。下一步：查看审计日志或联系用户。"
        : "订单已确认。下一步：在本页履约任务中确认发货。",
    );
    router.refresh();
  }

  return (
    <form className="mt-4 grid gap-3 rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4" onSubmit={submitOrderAction}>
      <p className="text-xs font-black text-[#697386]">订单状态动作</p>
      <div className="grid gap-2 rounded-[8px] bg-white px-3 py-3 text-xs font-bold text-muted">
        <p>当前订单：{formatOrderStatusLabel(status, paymentStatus)}</p>
        <p>支付状态：{formatStatusLabel(paymentStatus)}</p>
        <p>履约状态：{formatOrderFulfillmentStatusLabel({ paymentStatus, fulfillmentStatus })}</p>
      </div>
      <label className="vk-field">
        可执行动作
        <select name="action" disabled={!actions.length}>
          {actions.map((action) => (
            <option key={action.value} value={action.value}>
              {action.label}
            </option>
          ))}
          {!actions.length ? <option value="">当前无可执行动作</option> : null}
        </select>
      </label>
      <label className="vk-field">
        操作备注
        <input name="note" placeholder="说明这次状态动作的依据" />
      </label>
      <button className="vk-button vk-button-dark" disabled={!actions.length} type="submit">
        提交订单动作
      </button>
      <p className={statusClass(tone)} role="status">{message}</p>
    </form>
  );
}

function getAvailableActions(status: string, paymentStatus: string) {
  const normalizedStatus = status.toUpperCase();
  const normalizedPayment = paymentStatus.toUpperCase();
  const actions: Array<{ label: string; value: string }> = [];
  if (normalizedStatus === "CREATED" && normalizedPayment === "PAID") {
    actions.push({ label: "确认订单，进入履约", value: "confirm" });
  }
  if (normalizedStatus === "CREATED" && !["PAID", "REFUNDED"].includes(normalizedPayment)) {
    actions.push({ label: "取消未支付订单", value: "cancel" });
  }
  return actions;
}

function resolveNextStatus(action: string, status: string, paymentStatus: string) {
  const allowed = getAvailableActions(status, paymentStatus).some((item) => item.value === action);
  if (!allowed) return "";
  if (action === "confirm") return "CONFIRMED";
  if (action === "cancel") return "CANCELLED";
  return "";
}

function stripEmpty(payload: Record<string, string>) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== ""));
}

function statusClass(tone: StatusTone) {
  if (tone === "success") return "rounded-[8px] bg-white px-3 py-2 text-xs font-black text-foreground";
  if (tone === "error") return "rounded-[8px] bg-foreground px-3 py-2 text-xs font-black text-background";
  return "rounded-[8px] border border-line px-3 py-2 text-xs font-black text-muted";
}

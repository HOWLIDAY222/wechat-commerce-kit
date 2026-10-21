"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { formatAdminActionError } from "@/lib/client/admin-error-message";
import { formatStatusLabel } from "@/lib/display-labels";

type TransitionStatus = {
  tone: "idle" | "success" | "error";
  message: string;
};

export function AfterSalesTransitionForm({
  afterSalesNo,
  currentStatus,
  nextStatuses,
  returnAddress,
}: {
  afterSalesNo: string;
  currentStatus: string;
  nextStatuses: string[];
  returnAddress?: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<TransitionStatus>({ tone: "idle", message: "待操作" });
  const [targetStatus, setTargetStatus] = useState(nextStatuses[0] ?? "");

  async function submitTransition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!targetStatus) return;

    const form = new FormData(event.currentTarget);
    const rejectReason = String(form.get("rejectReason") ?? "").trim();
    const detailNote = String(form.get("detailNote") ?? "").trim();
    const payload: Record<string, unknown> = {
      status: targetStatus,
      detail: detailNote ? { note: detailNote } : undefined,
    };
    if (targetStatus === "rejected") {
      payload.rejectReason = rejectReason;
    }
    if (targetStatus === "waiting_return") {
      const address = String(form.get("returnAddress") ?? "").trim();
      if (address.length < 5 || address.length > 500) {
        setStatus({ tone: "error", message: "请填写完整退货地址（5至500字），包括收件人和联系电话。" });
        return;
      }
      payload.returnAddress = address;
    }
    if (!window.confirm(`确认将售后 ${afterSalesNo} 从 ${formatStatusLabel(currentStatus)} 流转到 ${formatStatusLabel(targetStatus)}？该操作会写入审计日志。`)) {
      return;
    }

    setStatus({ tone: "idle", message: "提交中..." });
    const response = await fetch(`/api/admin/after-sales/${encodeURIComponent(afterSalesNo)}/transition`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(stripEmpty(payload)),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      setStatus({ tone: "error", message: formatAdminActionError(result.error, response.status, "售后状态更新") });
      return;
    }

    setStatus({ tone: "success", message: `已流转到 ${formatStatusLabel(targetStatus)}。下一步：按详情页状态区继续处理或复核审计日志。` });
    router.refresh();
  }

  if (!nextStatuses.length) {
    return (
      <div className="rounded-2xl bg-soft px-4 py-3 text-xs font-black text-muted">
        售后流转表单 · {formatStatusLabel(currentStatus)} 无可用流转
      </div>
    );
  }

  return (
    <form className="mt-3 grid gap-3 rounded-2xl border border-line px-4 py-3" onSubmit={submitTransition}>
      <p className="text-xs font-black text-muted">售后流转表单</p>
      <label className="vk-field">
        下一状态
        <select name="status" onChange={(event) => setTargetStatus(event.target.value)} value={targetStatus}>
          {nextStatuses.map((nextStatus) => (
            <option key={nextStatus} value={nextStatus}>{formatStatusLabel(nextStatus)}</option>
          ))}
        </select>
      </label>
      {targetStatus === "rejected" ? (
        <label className="vk-field">
          拒绝原因
          <input name="rejectReason" placeholder="请填写拒绝原因" required />
        </label>
      ) : null}
      {targetStatus === "waiting_return" ? (
        <label className="vk-field">
          退货地址
          <textarea defaultValue={returnAddress ?? ""} maxLength={500} minLength={5} name="returnAddress" placeholder="填写收件人、联系电话和完整退货地址，客户会在售后详情中看到。" required rows={3} />
        </label>
      ) : null}
      <label className="vk-field">
        处理备注
        <input name="detailNote" placeholder="内部处理备注" />
      </label>
      <button className="vk-button vk-button-dark" type="submit">提交流转</button>
      <p className={statusClass(status.tone)} role="status">{status.message}</p>
    </form>
  );
}

function statusClass(tone: TransitionStatus["tone"]) {
  if (tone === "success") return "rounded-2xl bg-soft px-3 py-2 text-xs font-black text-foreground";
  if (tone === "error") return "rounded-2xl bg-foreground px-3 py-2 text-xs font-black text-background";
  return "rounded-2xl px-3 py-2 text-xs font-black text-muted";
}

function stripEmpty(payload: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== ""));
}

"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { formatAdminActionError } from "@/lib/client/admin-error-message";
import { formatRoleLabel, formatStatusLabel } from "@/lib/display-labels";

type StatusTone = "idle" | "success" | "error";

const roles = ["CUSTOMER", "ADMIN", "OWNER"] as const;
const statuses = ["ACTIVE", "DISABLED"] as const;

export function UserAdminForm({
  canManageRole,
  canManageStatus,
  isSelf,
  name,
  role,
  status,
  userId,
}: {
  canManageRole: boolean;
  canManageStatus: boolean;
  isSelf: boolean;
  name: string;
  role: string;
  status: string;
  userId: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState("等待操作");
  const [tone, setTone] = useState<StatusTone>("idle");

  async function submitUserUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextName = String(form.get("name") ?? "").trim();
    const nextRole = form.has("role") ? String(form.get("role") ?? "").trim() : role;
    const nextStatus = form.has("status") ? String(form.get("status") ?? "").trim() : status;
    const roleChanged = nextRole.toUpperCase() !== role.toUpperCase();
    const statusChanged = nextStatus.toUpperCase() !== status.toUpperCase();

    if ((roleChanged || statusChanged) && !window.confirm(
      `确认保存敏感账户变更？角色：${formatRoleLabel(role)} → ${formatRoleLabel(nextRole)}；状态：${formatStatusLabel(status)} → ${formatStatusLabel(nextStatus)}。该操作会写入审计日志。`,
    )) return;

    setTone("idle");
    setMessage("提交中...");

    const response = await fetch(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: nextName,
        role: form.has("role") ? String(form.get("role") ?? "").trim() : undefined,
        status: form.has("status") ? String(form.get("status") ?? "").trim() : undefined,
      }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!response.ok || !result.ok) {
      setTone("error");
      setMessage(formatAdminActionError(result.error, response.status, "用户资料更新"));
      return;
    }

    setTone("success");
    setMessage("用户已更新");
    router.refresh();
  }

  return (
    <form className="mt-4 grid gap-3 rounded-[8px] border border-[#e4e7ec] bg-[#f8fafc] p-4" onSubmit={submitUserUpdate}>
      <p className="text-xs font-black text-[#697386]">用户维护表单</p>
      <label className="vk-field">
        昵称
        <input name="name" defaultValue={name} required />
      </label>
      {canManageRole ? (
        <label className="vk-field">
          角色
          <select name="role" defaultValue={normalizeOption(role, roles)}>
            {roles.map((item) => (
              <option key={item} value={item}>{formatRoleLabel(item)}</option>
            ))}
          </select>
        </label>
      ) : (
        <ReadOnlyField label="角色" value={formatRoleLabel(role)} />
      )}
      {canManageStatus ? (
        <label className="vk-field">
          状态
          <select name="status" defaultValue={normalizeOption(status, statuses)}>
            {statuses.map((item) => (
              <option key={item} value={item}>{formatStatusLabel(item)}</option>
            ))}
          </select>
        </label>
      ) : (
        <ReadOnlyField label="状态" value={formatStatusLabel(status)} />
      )}
      {isSelf ? <p className="rounded-[8px] bg-[#fff7ed] px-3 py-2 text-xs font-bold leading-5 text-[#9a3412]">当前登录账号不能在这里降权或停用；姓名、手机号、邮箱和密码请到个人资料修改。</p> : null}
      {!canManageRole && !isSelf && isPrivilegedRole(role) ? <p className="rounded-[8px] bg-[#f8fafc] px-3 py-2 text-xs font-bold leading-5 text-[#667085]">只有店铺负责人可以修改管理员角色或状态。</p> : null}
      <button className="vk-button vk-button-dark" type="submit">保存用户资料</button>
      <p className={statusClass(tone)} role="status">{message}</p>
    </form>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-[#d8dde5] bg-white px-3 py-3">
      <p className="text-xs font-bold text-[#697386]">{label}</p>
      <p className="mt-1 text-sm font-black text-[#344054]">{value}</p>
    </div>
  );
}

function isPrivilegedRole(role: string) {
  const normalized = role.toUpperCase();
  return normalized === "ADMIN" || normalized === "OWNER";
}

function normalizeOption<T extends readonly string[]>(value: string, options: T): T[number] {
  const upper = value.toUpperCase();
  return (options.includes(upper) ? upper : options[0]) as T[number];
}

function statusClass(tone: StatusTone) {
  if (tone === "success") return "rounded-[8px] bg-[#ecfdf3] px-3 py-2 text-xs font-black text-[#027a48]";
  if (tone === "error") return "rounded-[8px] bg-[#fff1f3] px-3 py-2 text-xs font-black text-[#d92d20]";
  return "rounded-[8px] border border-[#d8dde5] px-3 py-2 text-xs font-black text-[#697386]";
}

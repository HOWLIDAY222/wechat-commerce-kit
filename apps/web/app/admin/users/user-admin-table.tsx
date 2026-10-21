"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Download, Eye, Search, SlidersHorizontal } from "lucide-react";
import { exportRowsAsCsv, getPageCount, getPageItems } from "@/lib/client/admin-table-actions";
import { formatRoleLabel, formatStatusLabel } from "@/lib/display-labels";
import { UserAdminForm } from "./user-admin-form";

type AdminUser = {
  id: string;
  phone?: string | null;
  email?: string | null;
  name: string;
  role: string;
  status: string;
  orderCount?: number;
  afterSalesCount?: number;
  createdAt: string;
  updatedAt: string;
  _count?: {
    orders: number;
    afterSalesRequests: number;
  };
};

type UserTab = "ALL" | "ACTIVE" | "DISABLED" | "ADMIN" | "RISK";
type CurrentAdmin = { role: string; userId: string } | null;

export function UserAdminTable({ currentAdmin, users }: { currentAdmin: CurrentAdmin; users: AdminUser[] }) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<UserTab>("ALL");
  const [role, setRole] = useState("ALL");
  const [status, setStatus] = useState("ALL");
  const [selectedUserId, setSelectedUserId] = useState(users[0]?.id ?? "");
  const [page, setPage] = useState(1);
  const roles = useMemo(() => uniqueValues(users.map((user) => user.role)), [users]);
  const statuses = useMemo(() => uniqueValues(users.map((user) => user.status)), [users]);
  const tabs = useMemo(() => buildTabs(users), [users]);
  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return users.filter((user) => {
      if (!matchesTab(user, tab)) return false;
      if (role !== "ALL" && user.role !== role) return false;
      if (status !== "ALL" && user.status !== status) return false;
      if (!normalizedQuery) return true;
      return [user.id, user.name, user.phone ?? "", user.email ?? "", user.role, user.status]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
      });
  }, [query, role, status, tab, users]);
  const pageCount = getPageCount(filteredUsers.length);
  const currentPage = Math.min(page, pageCount);
  const visibleUsers = useMemo(() => getPageItems(filteredUsers, currentPage), [currentPage, filteredUsers]);
  const selectedUser = filteredUsers.find((user) => user.id === selectedUserId) ?? filteredUsers[0] ?? users[0];

  function resetFilters() {
    setQuery("");
    setTab("ALL");
    setRole("ALL");
    setStatus("ALL");
    setPage(1);
  }

  function exportUsers() {
    exportRowsAsCsv("merchantkit-users.csv", filteredUsers, [
      { header: "用户ID", value: (user) => user.id },
      { header: "昵称", value: (user) => user.name },
      { header: "手机号", value: (user) => user.phone ?? "" },
      { header: "邮箱", value: (user) => user.email ?? "" },
      { header: "角色", value: (user) => formatRoleLabel(user.role) },
      { header: "状态", value: (user) => formatStatusLabel(user.status) },
      { header: "订单数", value: (user) => getOrderCount(user) },
      { header: "售后数", value: (user) => getAfterSalesCount(user) },
      { header: "注册时间", value: (user) => formatDateTime(user.createdAt) },
    ]);
  }

  return (
    <section className="mt-5 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 overflow-hidden rounded-[8px] border border-[#e4e7ec] bg-white shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
        <div className="border-b border-[#eef1f5] px-4 py-4">
          <div className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_auto] xl:items-center">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#667085]" />
              <input
                className="vk-admin-filter h-11 pl-9"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder="搜索用户 ID、昵称或手机号"
                type="search"
                value={query}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <select className="vk-admin-filter h-11 w-[150px]" onChange={(event) => {
                setRole(event.target.value);
                setPage(1);
              }} value={role}>
                <option value="ALL">全部角色</option>
                {roles.map((item) => (
                  <option key={item} value={item}>{formatRoleLabel(item)}</option>
                ))}
              </select>
              <select className="vk-admin-filter h-11 w-[150px]" onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }} value={status}>
                <option value="ALL">全部状态</option>
                {statuses.map((item) => (
                  <option key={item} value={item}>{formatStatusLabel(item)}</option>
                ))}
              </select>
              <button className="inline-flex h-11 items-center gap-2 rounded-[8px] border border-[#d8dde5] bg-white px-3 text-sm font-black text-[#344054]" onClick={resetFilters} type="button">
                <SlidersHorizontal className="h-4 w-4" />
                清空
              </button>
              <button className="inline-flex h-11 items-center gap-2 rounded-[8px] border border-[#d8dde5] bg-white px-3 text-sm font-black text-[#344054]" onClick={exportUsers} type="button">
                <Download className="h-4 w-4" />
                导出
              </button>
            </div>
          </div>

          <div className="mt-4 flex gap-5 overflow-x-auto">
            {tabs.map((item) => (
              <button
                className={
                  tab === item.key
                    ? "min-w-fit rounded-[8px] bg-[#eef4ff] px-4 py-2.5 text-sm font-black text-[#155eef] ring-1 ring-[#d6e4ff]"
                    : "min-w-fit rounded-[8px] px-4 py-2.5 text-sm font-black text-[#344054] hover:bg-[#f8fafc]"
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
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] border-collapse text-left text-xs">
            <thead className="bg-[#f8fafc] text-[#667085]">
              <tr className="border-b border-[#eef1f5]">
                <Th>用户ID</Th>
                <Th>昵称</Th>
                <Th>绑定手机号</Th>
                <Th>角色</Th>
                <Th>订单数</Th>
                <Th>售后数</Th>
                <Th>注册时间</Th>
                <Th>最近更新</Th>
                <Th>状态</Th>
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#eef1f5]">
              {visibleUsers.map((user) => (
                <UserRow
                  key={user.id}
                  onSelect={() => setSelectedUserId(user.id)}
                  selected={selectedUser?.id === user.id}
                  user={user}
                />
              ))}
              {filteredUsers.length === 0 ? (
                <tr>
                  <td className="px-4 py-10 text-sm font-bold text-[#697386]" colSpan={10}>
                    暂无匹配用户。
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-[#eef1f5] px-4 py-3 text-xs font-bold text-[#697386] md:flex-row md:items-center md:justify-between">
          <span>共 {filteredUsers.length} / {users.length} 条</span>
          <div className="flex items-center gap-2">
            <button className="h-8 rounded-[8px] border border-[#d8dde5] px-3 disabled:cursor-not-allowed disabled:opacity-50" disabled={currentPage <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} type="button">上一页</button>
            <span className="flex h-8 min-w-12 items-center justify-center rounded-[8px] bg-[#155eef] px-2 font-black text-white">{currentPage}/{pageCount}</span>
            <button className="h-8 rounded-[8px] border border-[#d8dde5] px-3 disabled:cursor-not-allowed disabled:opacity-50" disabled={currentPage >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))} type="button">下一页</button>
          </div>
        </div>
      </div>

      <UserDetailPanel currentAdmin={currentAdmin} user={selectedUser} />
    </section>
  );
}

function UserRow({ onSelect, selected, user }: { onSelect: () => void; selected: boolean; user: AdminUser }) {
  return (
    <tr className={selected ? "bg-[#f5f8ff] shadow-[inset_3px_0_0_#155eef]" : "hover:bg-[#fbfcfd]"}>
      <td className="px-4 py-3 font-bold text-[#344054]">{user.id}</td>
      <td className="px-4 py-3">
        <button aria-pressed={selected} className="font-black text-[#101828]" onClick={onSelect} type="button">{user.name}</button>
      </td>
      <td className="px-4 py-3 font-bold text-[#344054]">{user.phone || getUserEmail(user) || "未记录"}</td>
      <td className="px-4 py-3"><StatusPill value={formatRoleLabel(user.role)} tone={isAdminRole(user.role) ? "blue" : "slate"} /></td>
      <td className="px-4 py-3 font-black text-[#101828]">{getOrderCount(user)}</td>
      <td className="px-4 py-3 font-black text-[#101828]">{getAfterSalesCount(user)}</td>
      <td className="px-4 py-3 font-bold text-[#344054]">{formatDate(user.createdAt)}</td>
      <td className="px-4 py-3 font-bold text-[#344054]">{formatDate(user.updatedAt)}</td>
      <td className="px-4 py-3"><StatusPill value={formatStatusLabel(user.status)} tone={user.status.toUpperCase() === "ACTIVE" ? "green" : "red"} /></td>
      <td className="px-4 py-3">
        <div className="flex gap-2">
          <Link className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border border-[#d8dde5] text-[#155eef]" href={`/admin/users/${encodeURIComponent(user.id)}`} title="查看详情">
            <Eye className="h-4 w-4" />
          </Link>
        </div>
      </td>
    </tr>
  );
}

function UserDetailPanel({ currentAdmin, user }: { currentAdmin: CurrentAdmin; user: AdminUser | undefined }) {
  if (!user) {
    return <aside className="rounded-[8px] border border-[#e4e7ec] bg-white p-5 text-sm font-bold text-[#697386]">请选择用户查看详情。</aside>;
  }
  const isSelf = currentAdmin?.userId === user.id;
  const currentAdminIsOwner = currentAdmin?.role === "owner";
  const targetIsPrivileged = isAdminRole(user.role);
  const canManageRole = currentAdminIsOwner && !isSelf;
  const canManageStatus = !isSelf && (currentAdminIsOwner || !targetIsPrivileged);
  return (
    <aside className="grid gap-4 2xl:sticky 2xl:top-[112px] 2xl:self-start">
      <section className="rounded-[8px] border border-[#e4e7ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-black text-[#101828]">用户详情</h3>
          <StatusPill value={formatStatusLabel(user.status)} tone={user.status.toUpperCase() === "ACTIVE" ? "green" : "red"} />
        </div>
        <div className="mt-4 grid justify-items-center gap-2 border-b border-[#eef1f5] pb-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#eef4ff] text-xl font-black text-[#155eef]">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
          <p className="text-lg font-black text-[#101828]">{user.name}</p>
          <p className="text-xs font-bold text-[#697386]">UID: {user.id}</p>
        </div>
        <dl className="mt-4 grid gap-3 text-sm">
          <DetailRow label="账户绑定手机号" value={user.phone || "未记录"} />
          <DetailRow label="注册时间" value={formatDateTime(user.createdAt)} />
          <DetailRow label="最后更新" value={formatDateTime(user.updatedAt)} />
          <DetailRow label="角色" value={formatRoleLabel(user.role)} />
        </dl>
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-[#eef1f5] pt-4 text-center">
          <div className="rounded-[8px] bg-[#f8fafc] px-3 py-3">
            <p className="text-xl font-black text-[#101828]">{getOrderCount(user)}</p>
            <p className="mt-1 text-xs font-bold text-[#697386]">最近订单</p>
          </div>
          <div className="rounded-[8px] bg-[#f8fafc] px-3 py-3">
            <p className="text-xl font-black text-[#101828]">{getAfterSalesCount(user)}</p>
            <p className="mt-1 text-xs font-bold text-[#697386]">最近售后</p>
          </div>
        </div>
        <Link className="vk-button vk-button-light mt-4 w-full" href={`/admin/users/${encodeURIComponent(user.id)}`}>
          查看完整用户详情
        </Link>
      </section>

      <section className="rounded-[8px] border border-[#e4e7ec] bg-white p-4 shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
        <h3 className="text-base font-black text-[#101828]">安全操作</h3>
        <UserAdminForm
          canManageRole={canManageRole}
          canManageStatus={canManageStatus}
          isSelf={isSelf}
          name={user.name}
          role={user.role}
          status={user.status}
          userId={user.id}
        />
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

function StatusPill({ value, tone = "slate" }: { value: string; tone?: "blue" | "green" | "red" | "slate" }) {
  const className =
    tone === "blue"
      ? "bg-[#eef4ff] text-[#155eef]"
      : tone === "green"
        ? "bg-[#ecfdf3] text-[#079455]"
        : tone === "red"
          ? "bg-[#fff1f3] text-[#d92d20]"
          : "bg-[#f2f4f7] text-[#667085]";
  return <span className={`inline-flex w-fit whitespace-nowrap rounded-[6px] px-2 py-1 text-[11px] font-black ${className}`}>{value}</span>;
}

function buildTabs(users: AdminUser[]): Array<{ key: UserTab; label: string; count: number }> {
  return [
    { key: "ALL", label: "全部", count: users.length },
    { key: "ACTIVE", label: "启用", count: users.filter((user) => user.status.toUpperCase() === "ACTIVE").length },
    { key: "DISABLED", label: "禁用", count: users.filter((user) => user.status.toUpperCase() !== "ACTIVE").length },
    { key: "ADMIN", label: "管理员", count: users.filter((user) => isAdminRole(user.role)).length },
    { key: "RISK", label: "风险用户", count: users.filter((user) => getAfterSalesCount(user) >= 3 || user.status.toUpperCase() !== "ACTIVE").length },
  ];
}

function matchesTab(user: AdminUser, tab: UserTab) {
  if (tab === "ALL") return true;
  if (tab === "ACTIVE") return user.status.toUpperCase() === "ACTIVE";
  if (tab === "DISABLED") return user.status.toUpperCase() !== "ACTIVE";
  if (tab === "ADMIN") return isAdminRole(user.role);
  return getAfterSalesCount(user) >= 3 || user.status.toUpperCase() !== "ACTIVE";
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function getUserEmail(user: AdminUser) {
  return user.email ?? undefined;
}

function getOrderCount(user: AdminUser) {
  return user.orderCount ?? user._count?.orders ?? 0;
}

function getAfterSalesCount(user: AdminUser) {
  return user.afterSalesCount ?? user._count?.afterSalesRequests ?? 0;
}

function isAdminRole(role: string) {
  const normalized = role.toUpperCase();
  return normalized === "ADMIN" || normalized === "OWNER";
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
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

import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { AdminProfileForm } from "@/app/admin/profile/admin-profile-form";
import { fetchAdminJson } from "@/app/admin/_lib/admin-page-fetch";
import { formatRoleLabel, formatStatusLabel } from "@/lib/display-labels";

type AdminMeResponse = {
  ok: boolean;
  password: {
    hasPassword: boolean;
  };
  user: {
    email?: string | null;
    id: string;
    name: string;
    phone?: string | null;
    role: string;
    status: string;
    updatedAt: string;
  };
};

export const dynamic = "force-dynamic";

export const metadata = {
  title: "个人资料 | MerchantKit Admin",
  description: "编辑当前 MerchantKit 后台账号的个人资料、手机号、邮箱和登录密码。",
};

export default async function AdminProfilePage() {
  const { password, user } = await fetchAdminJson<AdminMeResponse>("/api/admin/me");

  const frameMetrics = [
    { label: "账号", value: user.name },
    { label: "角色", value: formatRoleLabel(user.role) },
    { label: "状态", value: formatStatusLabel(user.status) },
    { label: "手机号", value: user.phone || "未绑定" },
    { label: "密码", value: password.hasPassword ? "已设置" : "未设置" },
  ];

  return (
    <AdminFrame active="settings" metrics={frameMetrics} title="个人资料" subtitle="编辑当前后台账号的姓名、手机号、邮箱和登录密码；角色和状态仍由用户管理页控制。">
      <section className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
        <AdminProfileForm email={user.email} hasPassword={password.hasPassword} name={user.name} phone={user.phone} />
        <section className="rounded-[8px] border border-[#d8dde5] bg-white p-5">
          <h2 className="text-base font-black">账号信息</h2>
          <dl className="mt-4 grid gap-3 text-sm font-bold text-[#344054]">
            <Info label="用户 ID" value={user.id} />
            <Info label="手机号" value={user.phone || "未绑定"} />
            <Info label="邮箱" value={user.email ?? "未填写"} />
            <Info label="登录密码" value={password.hasPassword ? "已设置" : "未设置"} />
            <Info label="角色" value={formatRoleLabel(user.role)} />
            <Info label="状态" value={formatStatusLabel(user.status)} />
            <Info label="更新时间" value={formatDate(user.updatedAt)} />
          </dl>
        </section>
      </section>
    </AdminFrame>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1">
      <dt className="text-xs font-black text-[#697386]">{label}</dt>
      <dd className="break-all">{value}</dd>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

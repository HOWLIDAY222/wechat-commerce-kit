import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { fetchAdminJson } from "@/app/admin/_lib/admin-page-fetch";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { listCustomerCareOverview } from "@/lib/services/customer-care-service";
import { writeAdminAudit } from "@/lib/services/admin-ops-service";
import { UserAdminTable } from "./user-admin-table";
import { CustomerCarePanel } from "./customer-care-panel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "用户管理 | MerchantKit Admin",
  description: "MerchantKit 后台用户管理，查看用户、角色、状态和账户维护操作。",
};

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

type UsersResponse = {
  ok: boolean;
  users: AdminUser[];
  audit: {
    actorId: string;
    action: string;
    createdAt: string;
  };
};

export default async function AdminUsersPage() {
  const [{ users }, currentAdmin, overview] = await Promise.all([
    fetchAdminJson<UsersResponse>("/api/admin/users"),
    readCurrentAdminSession(),
    listCustomerCareOverview(),
  ]);
  if (currentAdmin) await writeAdminAudit(currentAdmin.userId, "admin.customer.overview.viewed", "customer_overview", "customers", { includes: ["users", "inquiries", "subscriptions"] });
  const activeCount = users.filter((user) => user.status.toUpperCase() === "ACTIVE").length;
  const disabledCount = users.length - activeCount;
  const adminCount = users.filter((user) => isAdminRole(user.role)).length;
  const riskCount = users.filter((user) => (user.afterSalesCount ?? user._count?.afterSalesRequests ?? 0) >= 3 || user.status.toUpperCase() !== "ACTIVE").length;
  const frameMetrics = [
    { label: "用户总数", value: users.length.toString(), hint: `管理员 ${adminCount}`, tone: "blue" as const },
    { label: "启用账户", value: activeCount.toString(), hint: "可正常登录", tone: "green" as const },
    { label: "禁用账户", value: disabledCount.toString(), hint: "当前禁止登录", tone: "red" as const },
    { label: "风险用户", value: riskCount.toString(), hint: `管理员 ${adminCount}`, tone: "orange" as const },
  ];

  return (
    <AdminFrame active="users" metrics={frameMetrics} title="用户管理" subtitle="管理平台用户，查看用户数据与行为，维护用户关系与安全。">
      <UserAdminTable currentAdmin={currentAdmin ? { role: currentAdmin.role, userId: currentAdmin.userId } : null} users={users} />
      <CustomerCarePanel
        campaigns={overview.campaigns.map((item) => ({ id: item.id, subject: item.subject, status: item.status, sentAt: item.sentAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString(), deliveryCount: "_count" in item ? item._count.deliveries : 0 }))}
        emailProviderConfigured={overview.emailProvider.configured}
        inquiries={overview.inquiries.map((item) => ({ id: item.id, name: item.name, contact: item.contact, message: item.message, status: item.status, adminNote: item.adminNote, createdAt: item.createdAt.toISOString() }))}
        isOwner={currentAdmin?.role === "owner"}
        subscriptions={overview.subscriptions.map((item) => ({ id: item.id, email: item.email, status: item.status, subscribedAt: item.subscribedAt.toISOString() }))}
      />
    </AdminFrame>
  );
}

function isAdminRole(role: string) {
  const normalized = role.toUpperCase();
  return normalized === "ADMIN" || normalized === "OWNER";
}

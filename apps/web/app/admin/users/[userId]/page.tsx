import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminFrame } from "@/app/admin/_components/admin-frame";
import { fetchAdminJson } from "@/app/admin/_lib/admin-page-fetch";
import {
  formatAfterSalesTypeLabel,
  formatFulfillmentStatusLabel,
  formatOrderStatusLabel,
  formatPaymentStatusLabel,
  formatRoleLabel,
  formatStatusLabel,
} from "@/lib/display-labels";
import { getCustomerAnalyticsProfile } from "@/lib/services/analytics-service";
import { MemberProfilePanel } from "@/app/admin/users/member-profile-panel";

type AdminUserDetailProps = {
  params: Promise<{ userId: string }>;
};

type AdminUserDetail = {
  id: string;
  phone?: string | null;
  email?: string | null;
  name: string;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt?: string | null;
  customerProfile?: {
    birthYear?: number | null;
    countryCode?: string | null;
    gender?: string | null;
    marketingGranted?: boolean;
    personalizationGranted?: boolean;
    preferredLocale?: string | null;
  } | null;
  addresses?: Array<{
    id: string;
    name: string;
    phone: string;
    province: string;
    city: string;
    district?: string | null;
    detail: string;
    isDefault: boolean;
    updatedAt: string;
  }>;
  orders?: Array<{
    id: string;
    orderNo: string;
    status: string;
    paymentStatus: string;
    fulfillmentStatus: string;
    payableAmountCents: number;
    currency: string;
    createdAt: string;
    items?: Array<{
      id: string;
      productName: string;
      color: string;
      size: string;
      quantity: number;
    }>;
  }>;
  afterSalesRequests?: Array<{
    id: string;
    afterSalesNo: string;
    orderNo?: string;
    order?: { orderNo: string };
    type: string;
    reason: string;
    status: string;
    refundAmountCents: number;
    createdAt: string;
  }>;
  loginLogs?: Array<{
    id: string;
    phone?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    success: boolean;
    failureReason?: string | null;
    createdAt: string;
  }>;
  sessions?: Array<{
    id: string;
    expiresAt: string;
    ip?: string | null;
    userAgent?: string | null;
    createdAt: string;
  }>;
  auditLogs?: Array<{
    id: string;
    action: string;
    targetType: string;
    targetId?: string | null;
    createdAt: string;
  }>;
  _count?: {
    orders: number;
    addresses: number;
    afterSalesRequests: number;
    sessions: number;
    loginLogs: number;
    auditLogs: number;
  };
};

type UserDetailResponse = {
  ok: boolean;
  user?: AdminUserDetail;
};

export const dynamic = "force-dynamic";

export const metadata = {
  title: "用户详情 | MerchantKit Admin",
  description: "MerchantKit 后台用户详情页，用于核对用户资料、订单、售后、地址、登录日志和审计记录。",
};

export default async function AdminUserDetailPage({ params }: AdminUserDetailProps) {
  const { userId } = await params;
  const { user } = await fetchAdminJson<UserDetailResponse>(`/api/admin/users/${encodeURIComponent(userId)}`);
  if (!user) notFound();
  const behavior = await getCustomerAnalyticsProfile(user.id);

  const orders = user.orders ?? [];
  const afterSalesRequests = user.afterSalesRequests ?? [];
  const addresses = user.addresses ?? [];
  const loginLogs = user.loginLogs ?? [];
  const sessions = user.sessions ?? [];
  const auditLogs = user.auditLogs ?? [];

  const frameMetrics = [
    { label: "角色", value: formatRoleLabel(user.role) },
    { label: "状态", value: formatStatusLabel(user.status) },
    { label: "订单", value: (user._count?.orders ?? orders.length).toString() },
    { label: "售后", value: (user._count?.afterSalesRequests ?? afterSalesRequests.length).toString() },
  ];

  return (
    <AdminFrame active="users" metrics={frameMetrics} title="用户详情" subtitle="用户详情只用于核对和受控维护，不提供删除用户或清空订单等危险操作。">
      <section className="border border-[#d8dde5] bg-white px-4 py-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <Link className="vk-admin-link" href="/admin/users">返回用户管理</Link>
            <h1 className="mt-3 break-all text-2xl font-black">{user.name}</h1>
            <p className="mt-2 text-xs font-bold text-[#697386]">
              创建：{formatDate(user.createdAt)} / 更新：{formatDate(user.updatedAt)}
            </p>
          </div>
          <Link className="vk-button vk-button-light" href="/admin/settings#audit">
            查看审计日志
          </Link>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <section className="rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4">
            <h2 className="text-base font-black">基础信息</h2>
            <dl className="mt-3 grid gap-3 text-xs font-bold">
              <Info label="用户 ID" value={user.id} />
              <Info label="账户绑定手机号" value={user.phone || "未填写"} />
              <Info label="邮箱" value={user.email ?? "未填写"} />
              <Info label="角色" value={formatRoleLabel(user.role)} />
              <Info label="状态" value={formatStatusLabel(user.status)} />
              <Info label="最后登录" value={user.lastLoginAt ? formatDate(user.lastLoginAt) : "未记录"} />
              <Info label="出生年份" value={user.customerProfile?.birthYear ? `${user.customerProfile.birthYear}（约 ${new Date().getFullYear() - user.customerProfile.birthYear} 岁）` : "未填写"} />
              <Info label="性别" value={formatGender(user.customerProfile?.gender)} />
              <Info label="国家/地区" value={user.customerProfile?.countryCode ?? "未填写"} />
              <Info label="偏好语言" value={user.customerProfile?.preferredLocale ?? "未填写"} />
              <Info label="个性化授权" value={user.customerProfile?.personalizationGranted ? "已同意" : "未同意"} />
              <Info label="营销授权" value={user.customerProfile?.marketingGranted ? "已同意" : "未同意"} />
              <Info label="地址数量" value={(user._count?.addresses ?? addresses.length).toString()} />
              <Info label="会话数量" value={(user._count?.sessions ?? sessions.length).toString()} />
            </dl>
          </section>

          <section className="rounded-[8px] border border-[#d8dde5] bg-white p-4">
            <h2 className="text-base font-black">订单记录</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-[780px] w-full text-left text-xs">
                <thead className="text-[#697386]">
                  <tr className="border-b border-[#d8dde5]">
                    <th className="py-2 pr-3">订单号</th>
                    <th className="py-2 pr-3">金额</th>
                    <th className="py-2 pr-3">状态</th>
                    <th className="py-2 pr-3">商品</th>
                    <th className="py-2 pr-3">时间</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e6eaf0]">
                  {orders.map((order) => (
                    <tr key={order.id}>
                      <td className="py-3 pr-3 font-black">
                        <Link className="underline underline-offset-4" href={`/admin/orders/${encodeURIComponent(order.orderNo)}`}>
                          {order.orderNo}
                        </Link>
                      </td>
                      <td className="py-3 pr-3 font-black">{formatMoney(order.payableAmountCents)}</td>
                      <td className="py-3 pr-3">
                        <div className="flex flex-wrap gap-1">
                          <Pill value={formatOrderStatusLabel(order.status)} />
                          <Pill tone="muted" value={formatPaymentStatusLabel(order.paymentStatus)} />
                          <Pill tone="muted" value={formatFulfillmentStatusLabel(order.fulfillmentStatus)} />
                        </div>
                      </td>
                      <td className="py-3 pr-3 font-bold text-[#697386]">{summarizeItems(order.items ?? [])}</td>
                      <td className="py-3 pr-3 font-bold text-[#697386]">{formatDate(order.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {orders.length === 0 ? <EmptyText>暂无订单记录。</EmptyText> : null}
            </div>
          </section>
        </div>

        <MemberProfilePanel key={user.id} userId={user.id} />

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Panel title="售后记录" empty="暂无售后记录。">
            {afterSalesRequests.map((request) => (
              <RecordLine
                href={`/admin/after-sales/${encodeURIComponent(request.afterSalesNo)}`}
                key={request.id}
                label={`${request.afterSalesNo} / ${formatAfterSalesTypeLabel(request.type)}`}
                value={`${formatStatusLabel(request.status)} / ${request.order?.orderNo ?? request.orderNo ?? "未绑定订单"} / ${formatMoney(request.refundAmountCents)}`}
              />
            ))}
          </Panel>

          <Panel title="地址记录" empty="暂无地址记录。">
            {addresses.map((address) => (
              <RecordLine
                key={address.id}
                label={`${address.name} / ${address.phone || "未填写"}${address.isDefault ? " / 默认" : ""}`}
                value={maskAddress(`${address.province}${address.city}${address.district ?? ""}${address.detail}`)}
              />
            ))}
          </Panel>

          <Panel title="登录日志" empty="暂无登录日志。">
            {loginLogs.map((log) => (
              <RecordLine
                key={log.id}
                label={`${log.success ? "成功" : "失败"} / ${formatDate(log.createdAt)}`}
                value={`${log.phone || "未填写"} / ${log.ip ?? "未记录 IP"} / ${log.failureReason ?? "无失败原因"}`}
              />
            ))}
          </Panel>

          <Panel title="当前会话" empty="暂无会话记录。">
            {sessions.map((session) => (
              <RecordLine
                key={session.id}
                label={`创建 ${formatDate(session.createdAt)}`}
                value={`过期 ${formatDate(session.expiresAt)} / ${session.ip ?? "未记录 IP"}`}
              />
            ))}
          </Panel>
        </div>

        <section className="mt-4 rounded-[8px] border border-[#d8dde5] bg-white p-4">
          <h2 className="text-base font-black">访问与偏好概览</h2>
          <p className="mt-1 text-xs font-bold leading-5 text-[#697386]">只展示用户同意分析后与登录账户关联的汇总行为，不显示原始设备指纹。</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <BehaviorStat label="首次访问" value={behavior.firstSeenAt ? formatDate(behavior.firstSeenAt) : "未记录"} />
            <BehaviorStat label="最近访问" value={behavior.lastSeenAt ? formatDate(behavior.lastSeenAt) : "未记录"} />
            <BehaviorStat label="访问次数" value={behavior.sessions.toString()} />
            <BehaviorStat label="已识别设备" value={behavior.devices.toString()} />
          </div>
          <div className="mt-3 grid gap-2">{behavior.topPaths.map((row) => <p className="flex justify-between gap-3 rounded-[8px] bg-[#f8fafc] px-3 py-2 text-xs font-bold" key={row.label}><span className="truncate">{row.label}</span><span>{row.value}</span></p>)}{behavior.topPaths.length === 0 ? <p className="text-xs font-bold text-[#697386]">暂无已授权访问数据。</p> : null}</div>
        </section>

        <section className="mt-4 rounded-[8px] border border-[#d8dde5] bg-[#f8fafc] p-4">
          <h2 className="text-base font-black">审计记录</h2>
          <div className="mt-3 grid gap-2">
            {auditLogs.map((entry) => (
              <p className="text-xs font-bold text-[#697386]" key={entry.id}>
                {formatDate(entry.createdAt)} / {entry.action} / {entry.targetType}
                {entry.targetId ? ` / ${entry.targetId}` : ""}
              </p>
            ))}
            {auditLogs.length === 0 ? <p className="text-xs font-bold text-[#697386]">暂无关联审计记录。</p> : null}
          </div>
        </section>
      </section>
    </AdminFrame>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[76px_minmax(0,1fr)] gap-3">
      <dt className="text-[#697386]">{label}</dt>
      <dd className="break-all text-[#111827]">{value}</dd>
    </div>
  );
}

function Panel({ children, empty, title }: { children: React.ReactNode; empty: string; title: string }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <section className="rounded-[8px] border border-[#d8dde5] bg-white p-4">
      <h2 className="text-base font-black">{title}</h2>
      <div className="mt-3 grid gap-2">{items.length > 0 ? items : <EmptyText>{empty}</EmptyText>}</div>
    </section>
  );
}

function RecordLine({ href, label, value }: { href?: string; label: string; value: string }) {
  const content = (
    <span className="grid gap-1 rounded-[8px] bg-[#f8fafc] px-3 py-2 text-xs font-bold">
      <span className="font-black text-[#111827]">{label}</span>
      <span className="break-all text-[#697386]">{value}</span>
    </span>
  );
  return href ? (
    <Link className="block" href={href}>
      {content}
    </Link>
  ) : (
    content
  );
}

function EmptyText({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-bold text-[#697386]">{children}</p>;
}

function Pill({ value, tone = "dark" }: { value: string; tone?: "dark" | "muted" }) {
  return (
    <span
      className={
        tone === "dark"
          ? "inline-flex w-fit rounded-full bg-[#111827] px-2.5 py-1 text-[11px] font-black text-white"
          : "inline-flex w-fit rounded-full bg-[#eef1f5] px-2.5 py-1 text-[11px] font-black text-[#697386]"
      }
    >
      {value}
    </span>
  );
}

function summarizeItems(items: NonNullable<AdminUserDetail["orders"]>[number]["items"]) {
  if (!items?.length) return "无商品快照";
  return items.map((item) => `${item.productName} ${item.color}/${item.size} x${item.quantity}`).join("；");
}

function maskAddress(value: string) {
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 6)}****${value.slice(-3)}`;
}

function formatGender(value: string | null | undefined) {
  return ({ MALE: "男", FEMALE: "女", NON_BINARY: "非二元", PREFER_NOT_TO_SAY: "不愿透露" } as Record<string, string>)[value ?? ""] ?? "未填写";
}

function BehaviorStat({ label, value }: { label: string; value: string }) { return <div className="rounded-[8px] bg-[#f8fafc] p-3"><p className="text-xs font-bold text-[#697386]">{label}</p><p className="mt-1 text-sm font-black">{value}</p></div>; }

function formatMoney(cents: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
  }).format(cents / 100);
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

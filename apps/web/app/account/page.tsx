import Link from "next/link";
import { ArrowRight, CreditCard, Heart, RotateCcw, Settings, ShieldCheck, ShoppingBag, Truck, UserRound, type LucideIcon } from "lucide-react";
import { fetchAccountJson } from "@/app/account/_lib/account-page-fetch";
import { LogoutButton } from "@/app/account/logout-button";
import { AccountShell } from "@/components/storefront/account-shell";
import { formatMoney } from "@/components/storefront/storefront-ui";
import { formatFulfillmentStatusLabel, formatPaymentStatusLabel, formatStatusLabel, normalizeStatusKey } from "@/lib/display-labels";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "用户中心",
  description: "MerchantKit 用户中心入口，管理订单、地址、售后、收藏和账户安全设置。",
};

type AccountProfile = {
  createdAt: Date | string;
  email: string | null;
  id: string;
  name: string;
  phone: string | null;
};

type AccountOrder = {
  createdAt: Date | string;
  fulfillmentStatus: string;
  items: Array<{ productName: string; quantity: number }>;
  orderNo: string;
  payableAmountCents: number;
  paymentStatus: string;
  status: string;
};

type AccountAddress = {
  city: string;
  detail: string;
  district?: string | null;
  id: string;
  isDefault: boolean;
  name: string;
  phone: string;
  province: string;
};

type AfterSalesRequest = {
  afterSalesNo: string;
  createdAt: Date | string;
  orderNo: string;
  refundAmountCents: number;
  status: string;
  type: string;
};

type FavoriteProduct = { favoriteCreatedAt: Date | string; name: string; slug: string };
type PrimaryTask = { body: string; href: string; label: string; urgent: boolean };
type ActivityItem = { date: Date | string; href: string; meta: string; title: string; type: "order" | "after-sales" };

export default async function AccountPage() {
  const [{ profile }, { password }, { orders }, { addresses }, { afterSales }, { favorites }] = await Promise.all([
    fetchAccountJson<{ ok: boolean; profile: AccountProfile }>("/api/account/profile"),
    fetchAccountJson<{ ok: boolean; password: { hasPassword: boolean } }>("/api/account/password"),
    fetchAccountJson<{ ok: boolean; orders: AccountOrder[] }>("/api/account/orders"),
    fetchAccountJson<{ ok: boolean; addresses: AccountAddress[] }>("/api/account/addresses"),
    fetchAccountJson<{ ok: boolean; afterSales: AfterSalesRequest[] }>("/api/account/after-sales"),
    fetchAccountJson<{ ok: boolean; favorites: FavoriteProduct[] }>("/api/account/favorites"),
  ]);

  const pendingPaymentOrders = orders.filter(canPayOrder);
  const inFulfillmentOrders = orders.filter(isInFulfillmentOrder);
  const activeAfterSales = afterSales.filter((request) => !["COMPLETED", "REJECTED"].includes(normalizeStatusKey(request.status)));
  const defaultAddress = addresses.find((address) => address.isDefault) ?? addresses[0];
  const primaryTask = buildPrimaryTask({
    activeAfterSalesCount: activeAfterSales.length,
    addressCount: addresses.length,
    hasEmail: Boolean(profile.email),
    hasPassword: password.hasPassword,
    orderCount: orders.length,
    pendingPaymentCount: pendingPaymentOrders.length,
  });
  const activityItems = buildActivityItems(orders, afterSales);

  return (
    <AccountShell
      actions={<><Link href="/account/membership" className="vk-button vk-button-dark">会员与优惠券</Link><LogoutButton /></>}
      active="overview"

      description="查看订单、配送和售后进度。"
      eyebrow="会员中心"
      title="我的账户"
    >
      <div className="grid gap-10">
        <section className="flex flex-col gap-5 border-b border-line pb-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-[#f1f1f1]"><UserRound className="h-7 w-7" /></span>
            <div className="min-w-0">
              <h2 className="break-all text-xl font-semibold">{profile.name || maskPhone(profile.phone)}</h2>
              <p className="mt-1 text-sm font-semibold text-muted">{maskPhone(profile.phone)}{profile.email ? ` · ${profile.email}` : ""}</p>
              <p className="mt-1 text-xs font-semibold text-muted">加入时间：{formatDate(profile.createdAt)}</p>
            </div>
          </div>
          <Link className="inline-flex items-center gap-2 text-sm font-bold underline underline-offset-4" href="/account/settings"><Settings className="h-4 w-4" />编辑个人资料</Link>
        </section>

        <section className={`border-y px-0 py-6 ${primaryTask.urgent ? "border-[#d92d20]" : "border-[#111]"}`}>
          <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div>
              <p className={`text-xs font-bold uppercase ${primaryTask.urgent ? "text-[#b42318]" : "text-muted"}`}>当前事项</p>
              <h2 className="mt-2 text-2xl font-semibold">{primaryTask.label}</h2>
              <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-muted">{primaryTask.body}</p>
            </div>
            <Link className="vk-button vk-button-dark w-full md:w-auto" href={primaryTask.href}>立即处理<ArrowRight className="h-4 w-4" /></Link>
          </div>
        </section>

        <div className="grid gap-10 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] xl:gap-14">
          <section aria-labelledby="account-services-title">
            <div className="mb-4 flex items-end justify-between gap-4 border-b border-line pb-3">
              <div><p className="text-xs font-bold uppercase text-muted">Orders & service</p><h2 className="mt-1 text-xl font-semibold" id="account-services-title">订单与服务</h2></div>
              <Link className="text-sm font-bold underline underline-offset-4" href="/account/orders">全部订单</Link>
            </div>
            <div>
              <ServiceRow count={pendingPaymentOrders.length} href="/account/orders" icon={CreditCard} label="待付款" note="继续支付或取消未支付订单" />
              <ServiceRow count={inFulfillmentOrders.length} href="/account/orders" icon={Truck} label="配送进度" note="查看备货、发货与签收状态" />
              <ServiceRow count={activeAfterSales.length} href="/account/after-sales" icon={RotateCcw} label="售后处理" note="查看退换货、补发和退款进度" />
              <ServiceRow count={favorites.length} href="/account/favorites" icon={Heart} label="收藏商品" note="返回已收藏的商品" />
            </div>
          </section>

          <section aria-labelledby="account-details-title">
            <div className="mb-4 flex items-end justify-between gap-4 border-b border-line pb-3">
              <div><p className="text-xs font-bold uppercase text-muted">Account details</p><h2 className="mt-1 text-xl font-semibold" id="account-details-title">账户资料</h2></div>
              <ShieldCheck className="h-5 w-5" />
            </div>
            <dl>
              <AccountFact label="手机号" value={maskPhone(profile.phone)} />
              <AccountFact label="联系邮箱" value={profile.email ?? "未填写"} />
              <AccountFact label="登录密码" value={password.hasPassword ? "已设置" : "未设置"} />
              <AccountFact label="默认地址" value={defaultAddress ? `${defaultAddress.province}${defaultAddress.city} · ${defaultAddress.name}` : "未保存"} />
            </dl>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Link className="vk-button vk-button-light" href="/account/settings">账户设置</Link>
              <Link className="vk-button vk-button-light" href="/account/addresses">地址管理</Link>
            </div>
          </section>
        </div>

        <section aria-labelledby="account-activity-title">
          <div className="mb-4 border-b border-line pb-3"><p className="text-xs font-bold uppercase text-muted">Recent activity</p><h2 className="mt-1 text-xl font-semibold" id="account-activity-title">最近记录</h2></div>
          {activityItems.length ? <div>{activityItems.map((item) => <ActivityRow item={item} key={`${item.type}-${item.title}`} />)}</div> : (
            <div className="grid min-h-[180px] place-items-center border-b border-line text-center"><div><ShoppingBag className="mx-auto h-6 w-6" /><p className="mt-3 text-sm font-semibold text-muted">还没有订单或售后记录。</p><Link className="mt-4 inline-block text-sm font-bold underline underline-offset-4" href="/shop">浏览商品</Link></div></div>
          )}
        </section>
      </div>
    </AccountShell>
  );
}

function ServiceRow({ count, href, icon: Icon, label, note }: { count: number; href: string; icon: LucideIcon; label: string; note: string }) {
  return <Link className="group grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line py-4" href={href}><Icon className="h-5 w-5" /><span><strong className="block text-sm font-semibold">{label}</strong><span className="mt-1 block text-xs font-semibold leading-5 text-muted">{note}</span></span><span className="flex items-center gap-3 text-lg font-semibold">{count}<ArrowRight className="h-4 w-4 text-muted group-hover:text-foreground" /></span></Link>;
}

function AccountFact({ label, value }: { label: string; value: string }) {
  return <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-b border-line py-3 text-sm"><dt className="font-semibold text-muted">{label}</dt><dd className="min-w-0 break-words text-right font-semibold">{value}</dd></div>;
}

function ActivityRow({ item }: { item: ActivityItem }) {
  return <Link className="group grid gap-2 border-b border-line py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" href={item.href}><span><strong className="block text-sm font-semibold">{item.title}</strong><span className="mt-1 block text-xs font-semibold leading-5 text-muted">{item.meta}</span></span><span className="flex items-center justify-between gap-3 text-xs font-semibold text-muted sm:justify-end">{formatDate(item.date)}<ArrowRight className="h-4 w-4 group-hover:text-foreground" /></span></Link>;
}

function buildPrimaryTask({ activeAfterSalesCount, addressCount, hasEmail, hasPassword, orderCount, pendingPaymentCount }: { activeAfterSalesCount: number; addressCount: number; hasEmail: boolean; hasPassword: boolean; orderCount: number; pendingPaymentCount: number }): PrimaryTask {
  if (pendingPaymentCount > 0) return { body: "有订单尚未完成支付，进入订单页可继续支付宝支付或取消订单。", href: "/account/orders", label: `${pendingPaymentCount} 个订单待付款`, urgent: true };
  if (activeAfterSalesCount > 0) return { body: "售后申请正在处理中，可查看审核、退款或补发进度。", href: "/account/after-sales", label: `${activeAfterSalesCount} 个售后处理中`, urgent: true };
  if (orderCount === 0) return { body: "选购 X1 Air，订单的付款、配送和售后进度会显示在这里。", href: "/products/x1-air-white", label: "开始选购", urgent: false };
  if (addressCount === 0) return { body: "保存常用地址，便于管理收货资料。", href: "/account/addresses", label: "补充收货地址", urgent: false };
  if (!hasPassword) return { body: "设置后可使用手机号与密码登录，验证码登录仍然可用。", href: "/account/settings", label: "设置登录密码", urgent: false };
  if (!hasEmail) return { body: "联系邮箱用于客服回访和售后资料补充，不会公开展示。", href: "/account/settings", label: "补充联系邮箱", urgent: false };
  return { body: "当前没有待付款或处理中售后，可继续查看订单和新品。", href: "/account/orders", label: "账户状态正常", urgent: false };
}

function buildActivityItems(orders: AccountOrder[], afterSales: AfterSalesRequest[]) {
  const orderActivity: ActivityItem[] = orders.slice(0, 4).map((order) => ({ date: order.createdAt, href: `/account/orders/${encodeURIComponent(order.orderNo)}`, meta: `${formatPaymentStatusLabel(order.paymentStatus)} · ${formatFulfillmentStatusLabel(order.fulfillmentStatus)} · ${formatMoney(order.payableAmountCents)}`, title: `订单 ${order.orderNo}`, type: "order" }));
  const afterSalesActivity: ActivityItem[] = afterSales.slice(0, 4).map((request) => ({ date: request.createdAt, href: `/account/after-sales/${encodeURIComponent(request.afterSalesNo)}`, meta: `${formatStatusLabel(request.status)} · 关联订单 ${request.orderNo} · ${formatMoney(request.refundAmountCents)}`, title: `售后 ${request.afterSalesNo}`, type: "after-sales" }));
  return [...orderActivity, ...afterSalesActivity].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()).slice(0, 5);
}

function canPayOrder(order: AccountOrder) {
  return ["NOT_STARTED", "PENDING"].includes(normalizeStatusKey(order.paymentStatus)) && !["CANCELLED", "CLOSED"].includes(normalizeStatusKey(order.status));
}

function isInFulfillmentOrder(order: AccountOrder) {
  return ["PROCESSING", "SHIPPED"].includes(normalizeStatusKey(order.fulfillmentStatus));
}

function maskPhone(phone: string | null | undefined) {
  if (!phone) return "未绑定手机号";
  if (phone.length < 7) return phone;
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(value));
}

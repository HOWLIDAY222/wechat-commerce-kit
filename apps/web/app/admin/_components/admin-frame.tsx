import { BrandLogo } from "@/components/brand-logo";
import Link from "next/link";
import { AdminProfileCard } from "@/app/admin/_components/admin-profile-card";
import {
  Boxes,
  ClipboardCheck,
  HeartHandshake,
  LayoutDashboard,
  LayoutTemplate,
  BarChart3,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";

type AdminFrameProps = {
  active: string;
  children: React.ReactNode;
  metrics: Array<{
    label: string;
    value: string;
    hint?: string;
    tone?: "blue" | "green" | "orange" | "purple" | "red" | "slate";
  }>;
  title?: string;
  subtitle?: string;
};

type NavItem = { key: string; href: string; label: string; icon: LucideIcon; activeKeys?: string[] };

const primaryNav: NavItem[] = [
  { key: "home", href: "/admin", label: "工作台", icon: LayoutDashboard },
  { key: "orders", href: "/admin/orders", label: "订单与发货", icon: ClipboardCheck },
  { key: "after-sales", href: "/admin/after-sales", label: "售后服务", icon: HeartHandshake },
  { key: "products", href: "/admin/products", label: "商品与库存", icon: Boxes, activeKeys: ["product-new"] },
  { key: "membership", href: "/admin/membership", label: "会员、积分与券", icon: Users },
  { key: "gifts", href: "/admin/gifts", label: "商品礼品卡", icon: HeartHandshake },
  { key: "users", href: "/admin/users", label: "客户", icon: Users },
  { key: "design", href: "/admin/design/pages/home", label: "店铺内容", icon: LayoutTemplate, activeKeys: ["design-pages", "design-navigation", "design-footer", "design-media", "design-seo", "design-versions"] },
  { key: "analytics", href: "/admin/analytics", label: "数据分析", icon: BarChart3 },
  { key: "settings", href: "/admin/settings", label: "店铺设置", icon: Settings },
  { key: "careers", href: "/admin/careers", label: "人才储备", icon: Users },
];

const navGroups = [
  { label: "日常经营", keys: ["home", "orders", "after-sales", "products"] },
  { label: "客户与权益", keys: ["membership", "gifts", "users"] },
  { label: "内容与店铺", keys: ["design", "analytics", "settings", "careers"] },
];

const areaLinks: Record<string, Array<{ href: string; label: string }>> = {
  orders: [{ href: "/admin/orders", label: "全部订单" }, { href: "/admin/orders?tab=PENDING_SHIPMENT", label: "待发货" }, { href: "/admin/orders?tab=WECHAT_SYNC", label: "微信同步待处理" }],
  products: [{ href: "/admin/products", label: "商品列表" }, { href: "/admin/products/new", label: "新建商品" }, { href: "/admin/inventory/logs", label: "库存流水" }],
  membership: [{ href: "/admin/membership", label: "会员与券" }, { href: "/admin/member-operations", label: "会员任务与社区" }, { href: "/admin/subscriptions", label: "微信订阅提醒" }, { href: "/admin/gifts", label: "商品礼品卡" }, { href: "/admin/users", label: "客户档案" }],
};

export function AdminFrame({ active, children, metrics, subtitle = "处理真实业务数据与当前待办。", title = "MerchantKit 后台" }: AdminFrameProps) {
  const area = primaryNav.find((item) => isNavItemActive(item, active));
  const currentArea = area?.label ?? "店铺管理";
  const dateLabel = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

  return (
    <main className="vk-admin-frame min-h-screen w-full max-w-full overflow-x-hidden bg-[#f7f9fc] text-[#111827]">
      <div className="vk-admin-grid grid min-h-screen min-w-0 lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside aria-label="后台导航与账户" tabIndex={0} className="vk-admin-sidebar min-w-0 border-b border-[#e4e7ec] bg-white lg:sticky lg:top-0 lg:h-screen lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="flex min-h-full flex-col">
            <div className="border-b border-[#eef1f5] px-4 py-4">
              <Link className="grid gap-3" href="/admin" aria-label="MerchantKit 后台">
                <BrandLogo size="compact" decorative />
                <span className="text-xs font-bold text-[#697386]">店铺管理中心</span>
              </Link>
            </div>

            <nav aria-label="后台功能" className="flex shrink-0 gap-1 overflow-x-auto px-3 py-3 lg:grid lg:flex-1 lg:grid-cols-1 lg:auto-rows-min lg:overflow-visible" data-admin-mobile-nav="true">
              {navGroups.map(group => <div className="flex shrink-0 gap-1 lg:mb-4 lg:grid lg:gap-1" key={group.label}>
                <p className="hidden px-3 pb-1 pt-2 text-[11px] font-black text-[#98a2b3] lg:block">{group.label}</p>
                {primaryNav.filter(item => group.keys.includes(item.key)).map(item => <NavLink active={isNavItemActive(item, active)} item={item} key={item.key} />)}
              </div>)}
            </nav>

            <div className="mt-auto hidden gap-3 border-t border-[#eef1f5] p-3 lg:grid">
              <Link className="grid gap-1 rounded-[8px] border border-[#e4e7ec] bg-white px-4 py-3 shadow-sm" href="/" target="_blank">
                <span className="text-sm font-black">打开 MerchantKit 店铺</span>
                <span className="text-[11px] font-bold text-[#155eef]">查看当前已发布版本</span>
              </Link>
              <AdminProfileCard />
            </div>
          </div>
        </aside>

        <section aria-label="后台工作区" tabIndex={0} className="vk-admin-content min-w-0 overflow-x-hidden">
          <header className="z-20 border-b border-[#eef1f5] bg-white/95 px-4 py-3 backdrop-blur md:px-6 md:py-4 lg:sticky lg:top-0">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-black text-[#155eef]">店铺管理 · {currentArea}</p>
                <h1 className="mt-1 text-xl font-black text-[#101828] md:text-2xl">{title}</h1>
                <p className="mt-1 line-clamp-2 max-w-4xl text-xs font-bold leading-5 text-[#697386] md:line-clamp-none md:text-sm md:leading-6">{subtitle}</p>
              </div>
              <div className="hidden min-h-10 items-center rounded-[8px] border border-[#d8dde5] bg-white px-3 text-xs font-black text-[#475467] md:flex">
                数据日期 {dateLabel}
              </div>
            </div>
          </header>

          <div className="px-4 py-5 md:px-6">
            {area && areaLinks[area.key] ? <nav aria-label="当前模块快捷入口" className="mb-4 flex flex-wrap gap-2">
              {areaLinks[area.key].map(link => <Link className="rounded-[6px] border border-[#d8dde5] bg-white px-3 py-2 text-xs font-bold text-[#344054] hover:border-[#155eef] hover:text-[#155eef]" href={link.href} key={link.href}>{link.label}</Link>)}
            </nav> : null}
            {metrics.length ? (
              <section className="mb-5 grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4 2xl:grid-cols-6">
                {metrics.map((metric, index) => (
                  <article className="min-w-0 border-l-2 border-[#d6e4ff] bg-white px-3 py-3 md:px-4" key={`${metric.label}-${index}`}>
                    <p className="truncate text-xs font-bold text-[#667085]">{metric.label}</p>
                    <p className="mt-1 truncate text-lg font-black text-[#101828] md:text-xl">{metric.value}</p>
                    {metric.hint ? <p className="mt-1 line-clamp-1 text-[11px] font-bold leading-5 text-[#697386] md:line-clamp-2">{metric.hint}</p> : null}
                  </article>
                ))}
              </section>
            ) : null}
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}

function NavLink({ active, item }: { active: boolean; item: NavItem }) {
  const Icon = item.icon;
  return (
    <Link aria-current={active ? "page" : undefined} className={active ? "flex min-w-fit shrink-0 items-center gap-2 rounded-[6px] bg-[#eef4ff] px-3 py-2.5 text-sm font-black text-[#155eef] ring-1 ring-[#d6e4ff] lg:min-w-0 lg:gap-3" : "flex min-w-fit shrink-0 items-center gap-2 rounded-[6px] px-3 py-2.5 text-sm font-bold text-[#344054] hover:bg-[#f8fafc] hover:text-[#155eef] lg:min-w-0 lg:gap-3"} href={item.href}>
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2.1} />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function isNavItemActive(item: NavItem, active: string) {
  return item.key === active || item.activeKeys?.includes(active) === true;
}

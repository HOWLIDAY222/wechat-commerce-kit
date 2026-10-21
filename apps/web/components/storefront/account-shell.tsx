import Link from "next/link";
import type { ReactNode } from "react";
import { Heart, Home, MapPin, RotateCcw, Settings, ShoppingBag } from "lucide-react";
import { StorefrontPage } from "@/components/storefront/storefront-ui";

type AccountNavKey = "overview" | "orders" | "addresses" | "after-sales" | "settings" | "favorites";

type AccountShellProps = {
  actions?: ReactNode;
  active: AccountNavKey;
  children: ReactNode;
  description: string;
  eyebrow?: string;
  title: string;
};

const navItems = [
  { href: "/account", icon: Home, key: "overview", label: "账户首页" },
  { href: "/account/orders", icon: ShoppingBag, key: "orders", label: "我的订单" },
  { href: "/account/addresses", icon: MapPin, key: "addresses", label: "地址管理" },
  { href: "/account/after-sales", icon: RotateCcw, key: "after-sales", label: "我的售后" },
  { href: "/account/settings", icon: Settings, key: "settings", label: "账户设置" },
  { href: "/account/favorites", icon: Heart, key: "favorites", label: "我的收藏" },
] as const;

export function AccountShell({ actions, active, children, description, eyebrow = "MerchantKit Account", title }: AccountShellProps) {
  return (
    <StorefrontPage>
      <section className="mb-5 grid gap-4 border-b border-line pb-5 md:mb-8 md:gap-5 md:pb-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div>
          <p className="sr-only">{eyebrow}</p>
          <h1 className="mt-2 break-words text-[30px] font-black leading-tight md:mt-3 md:text-[44px]">{title}</h1>
          <p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-muted">{description}</p>
        </div>
        {actions ? <div className="flex flex-wrap gap-3 lg:justify-end">{actions}</div> : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-[224px_minmax(0,1fr)] lg:gap-8">
        <aside className="min-w-0">
          <nav tabIndex={0} aria-label="账户导航" className="account-navigation -mx-2 flex gap-1 overflow-x-auto border-b border-line px-2 pb-2 lg:sticky lg:top-[84px] lg:mx-0 lg:grid lg:grid-cols-1 lg:overflow-visible lg:border-b-0 lg:border-r lg:px-0 lg:pb-0 lg:pr-5">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.key === active;
                return (
                  <Link
                    className={`flex min-h-10 shrink-0 items-center justify-center gap-2 border-b-2 px-3 text-xs font-bold lg:w-full lg:justify-start lg:border-b-0 lg:border-l-2 lg:text-sm ${
                      isActive ? "border-[#111] text-foreground" : "border-transparent text-muted hover:text-foreground"
                    }`}
                    aria-current={isActive ? "page" : undefined}
                    href={item.href}
                    key={item.key}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
          </nav>
        </aside>

        <section className="min-w-0">{children}</section>
      </div>
    </StorefrontPage>
  );
}

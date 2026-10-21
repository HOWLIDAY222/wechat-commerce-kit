import { BrandLabel } from "@/components/brand-logo";
import Link from "next/link";
import type { ReactNode } from "react";
import { Building2, CreditCard, FileText, HelpCircle, RefreshCw, Ruler, ShieldCheck, ShoppingBag, Truck } from "lucide-react";
import { InfoPanel, StorefrontPage } from "@/components/storefront/storefront-ui";

type PolicyKey =
  | "shopping"
  | "size"
  | "shipping"
  | "payment"
  | "returns"
  | "after-sales-policy"
  | "after-sales-process"
  | "faq"
  | "contact"
  | "about"
  | "channels"
  | "privacy"
  | "terms";

type PolicyShellProps = {
  active: PolicyKey;
  children: ReactNode;
  description: string;
  eyebrow?: string;
  title: string;
};

const policyNav = [
  { href: "/shopping-guide", icon: ShoppingBag, key: "shopping", label: "选购帮助" },
  { href: "/size-guide", icon: Ruler, key: "size", label: "尺码指南" },
  { href: "/shipping-policy", icon: Truck, key: "shipping", label: "配送方式" },
  { href: "/payment-methods", icon: CreditCard, key: "payment", label: "支付方式" },
  { href: "/return-policy", icon: RefreshCw, key: "returns", label: "退换货政策" },
  { href: "/after-sales-process", icon: ShieldCheck, key: "after-sales-process", label: "售后流程" },
  { href: "/faq", icon: HelpCircle, key: "faq", label: "常见问题" },
  { href: "/contact", icon: HelpCircle, key: "contact", label: "联系我们" },
  { href: "/about", icon: Building2, key: "about", label: "品牌故事" },
  { href: "/official-channels", icon: Building2, key: "channels", label: "官方渠道" },
  { href: "/privacy-policy", icon: FileText, key: "privacy", label: "隐私政策" },
  { href: "/terms", icon: FileText, key: "terms", label: "服务条款" },
] as const;

export function PolicyShell({ active, children, description, eyebrow = "MerchantKit Service", title }: PolicyShellProps) {
  return (
    <StorefrontPage>
      <section className="mb-8 border-b border-line pb-8">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-brand"><BrandLabel>{eyebrow}</BrandLabel></p>
        <h1 className="mt-3 text-[34px] font-black leading-tight md:text-[44px]">{title}</h1>
        <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-muted">{description}</p>
      </section>

      <div className="grid gap-8 lg:grid-cols-[224px_minmax(0,1fr)]">
        <aside aria-label="服务导航与说明" tabIndex={0} className="vk-policy-sidebar grid content-start gap-4">
          <InfoPanel className="p-3">
            <nav className="grid gap-1">
              {policyNav.map((item) => {
                const Icon = item.icon;
                const isActive = item.key === active;
                return (
                  <Link
                    className={`flex min-h-10 items-center gap-3 rounded-[6px] px-3 text-sm font-black ${
                      isActive ? "bg-[#eef4ff] text-brand" : "text-[#344054] hover:bg-soft"
                    }`}
                    href={item.href}
                    key={item.key}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </InfoPanel>
          <InfoPanel className="p-4">
            <p className="text-sm font-black">服务承诺</p>
            <p className="mt-2 text-xs font-bold leading-5 text-muted">页面内容用于说明购买、配送、退换和账户服务流程；具体订单以订单详情和客服审核结果为准。</p>
          </InfoPanel>
        </aside>
        <section className="min-w-0">{children}</section>
      </div>
    </StorefrontPage>
  );
}

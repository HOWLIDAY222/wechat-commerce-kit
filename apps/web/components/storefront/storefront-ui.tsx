import type { ReactNode } from "react";
import Link from "next/link";
import { PackageCheck } from "lucide-react";

export function StorefrontPage({ children, fullBleed = false, narrow = false }: { children: ReactNode; fullBleed?: boolean; narrow?: boolean }) {
  const className = fullBleed ? "vk-storefront" : narrow ? "vk-storefront vk-container-narrow py-10 md:py-14" : "vk-storefront vk-container py-10 md:py-14";
  return <main className={className}>{children}</main>;
}

export function SectionHeader({
  actionHref,
  actionLabel,
  eyebrow,
  title,
}: {
  actionHref?: string;
  actionLabel?: string;
  eyebrow?: string;
  title: string;
}) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        {eyebrow ? <p className="sr-only">{eyebrow}</p> : null}
        <h2 className="text-[28px] font-black leading-tight text-foreground md:text-[32px]">{title}</h2>
      </div>
      {actionHref && actionLabel ? (
        <Link className="text-sm font-black text-brand hover:underline" href={actionHref}>
          {actionLabel} &gt;
        </Link>
      ) : null}
    </div>
  );
}

export function InfoPanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`border-y border-line bg-white ${className}`}>{children}</section>;
}

export function CategoryTile({
  href,
  image,
  subtitle,
  title,
}: {
  href: string;
  image: string;
  subtitle: string;
  title: string;
}) {
  return (
    <Link className="group grid min-h-[88px] grid-cols-[1fr_128px] overflow-hidden rounded-[8px] border border-line bg-soft" href={href}>
      <span className="grid content-center px-5">
        <strong className="text-lg font-black">{title}</strong>
        <span className="mt-1 text-xs font-bold text-muted">{subtitle}</span>
        <span className="mt-3 text-xs font-black text-brand group-hover:underline">立即选购 &gt;</span>
      </span>
      <span className="bg-center bg-cover" style={{ backgroundImage: `url(${image})` }} />
    </Link>
  );
}

export function StorefrontNotice({ children }: { children: ReactNode }) {
  return (
    <div className="border-l-2 border-black bg-soft px-4 py-3 text-sm leading-6 text-foreground">
      {children}
    </div>
  );
}

export function EmptyState({ actionHref, actionLabel, body, title }: { actionHref: string; actionLabel: string; body?: string; title: string }) {
  return (
    <div className="py-14 text-center">
      <PackageCheck className="mx-auto h-9 w-9 stroke-[1.6]" />
      <p className="mt-3 font-black">{title}</p>
      {body ? <p className="mx-auto mt-2 max-w-md text-sm font-bold leading-6 text-muted">{body}</p> : null}
      <Link className="vk-button vk-button-dark mt-5" href={actionHref}>
        {actionLabel}
      </Link>
    </div>
  );
}

export function formatMoney(cents: number) {
  return new Intl.NumberFormat("zh-CN", { currency: "CNY", style: "currency" }).format(cents / 100);
}

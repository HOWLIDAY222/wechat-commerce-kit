"use client";

import { BrandLabel } from "@/components/brand-logo";
import Link from "next/link";
import { domesticPurchaseLink } from "@/lib/storefront-market";
import { usePathname } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { OfficialSocialLogo } from "@/components/layout/official-social-logo";
import type { FooterNavigationColumn, SocialChannel } from "@/lib/site-management";
import { isEnglishStorefrontPath } from "@/lib/storefront-locale";

type SiteFooterClientProps = {
  domestic?: boolean;
  brandText: string;
  footerNavigation: FooterNavigationColumn[];
  legalLinks: Array<{ label: string; href: string }>;
  socialChannels: SocialChannel[];
  xProfileUrl: string;
};

const englishFooterNavigation: FooterNavigationColumn[] = [
  { title: "Shopping", links: [{ label: "X1 Air White", href: "/en/products/x1-air-white" }, { label: "Size guide", href: "/en/size-guide" }, { label: "Shipping", href: "/en/shipping-policy" }, { label: "Payment", href: "/en/payment-methods" }] },
  { title: "Customer care", links: [{ label: "Returns", href: "/en/return-policy" }, { label: "After-sales", href: "/en/after-sales-process" }, { label: "FAQ", href: "/en/faq" }, { label: "Contact", href: "/en/contact" }] },
  { title: "MerchantKit", links: [{ label: "Our story", href: "/en/about" }, { label: "Official channels", href: "/en/official-channels" }, { label: "Privacy", href: "/en/privacy-policy" }, { label: "Terms", href: "/en/terms" }] },
];

export function SiteFooterClient({ footerNavigation, legalLinks, socialChannels, xProfileUrl, domestic = false }: SiteFooterClientProps) {
  const pathname = usePathname();
  const isEnglish = isEnglishStorefrontPath(pathname);
  const [newsletterMessage, setNewsletterMessage] = useState(isEnglish ? "Register your email for launch updates." : "登记邮箱，获取新品与发售动态。");
  const [newsletterTone, setNewsletterTone] = useState<"idle" | "success" | "error">("idle");
  const [newsletterSubmitting, setNewsletterSubmitting] = useState(false);

  useEffect(() => {
    const openNewsletter = () => {
      if (window.location.hash === "#newsletter") document.querySelector<HTMLDetailsElement>("details#newsletter")?.setAttribute("open", "");
    };
    openNewsletter();
    window.addEventListener("hashchange", openNewsletter);
    return () => window.removeEventListener("hashchange", openNewsletter);
  }, [pathname]);

  async function subscribeNewsletter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setNewsletterSubmitting(true);
    setNewsletterTone("idle");
    setNewsletterMessage(isEnglish ? "Submitting..." : "正在提交...");
    try {
    const response = await fetch("/api/newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: String(form.get("email") ?? "") }),
    });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setNewsletterSubmitting(false);
    if (!response.ok || !result.ok) {
      setNewsletterTone("error");
      setNewsletterMessage(result.error === "INVALID_NEWSLETTER_EMAIL" ? (isEnglish ? "Enter a valid email address." : "请输入有效邮箱地址。") : (isEnglish ? "Subscription failed. Please try again later." : "订阅失败，请稍后重试。"));
      return;
    }
    formElement.reset();
    setNewsletterTone("success");
    setNewsletterMessage(isEnglish ? "You're registered. Launch updates will also be published here." : "订阅已登记。发售动态也会同步在官网公布。");
    } catch {
      setNewsletterTone("error");
      setNewsletterMessage(isEnglish ? "Connection failed. Please try again." : "连接失败，请重试。");
    } finally { setNewsletterSubmitting(false); }
  }

  if (pathname.startsWith("/admin") || pathname.startsWith("/preview")) return null;

  const visibleSocialChannels = isEnglish
    ? xProfileUrl ? [{ label: "X", account: "", url: xProfileUrl, visible: true }] : []
    : socialChannels.filter((channel) => channel.visible && channel.url);
  const currentFooterNavigation = (isEnglish ? englishFooterNavigation : footerNavigation).map(column => domestic ? { ...column, links: column.links.map(domesticPurchaseLink) } : column);
  const currentLegalLinks = isEnglish ? [{ label: "Privacy", href: "/en/privacy-policy" }, { label: "Terms", href: "/en/terms" }] : [...legalLinks, ...(!legalLinks.some(link => link.href === "/miniprogram-privacy") ? [{ label: "小程序隐私说明", href: "/miniprogram-privacy" }] : [])];

  return <footer className="minimal-footer">
    <div className="minimal-footer-top">
      <Link href={isEnglish ? "/en/contact" : "/contact"}>{isEnglish ? "Contact" : "联系我们"}</Link>
      <Link href={isEnglish ? "/en/careers" : "/careers"}>{isEnglish ? "Join us" : "加入我们"}</Link>
      <details className="minimal-footer-help"><summary>{isEnglish ? "Customer care" : "帮助与服务"}</summary><div className="minimal-footer-links">
        {currentFooterNavigation.map((column) => <nav key={column.title} aria-label={column.title}><strong><BrandLabel>{column.title}</BrandLabel></strong>{column.links.map((link) => <Link href={link.href} key={link.href + link.label}>{link.label}</Link>)}</nav>)}
      </div></details>
      <details id="newsletter" className="minimal-newsletter"><summary>{isEnglish ? "Brand updates" : "订阅品牌资讯"}</summary>
        <form onSubmit={subscribeNewsletter}><label htmlFor="footer-email">{isEnglish ? "Email address" : "邮箱地址"}</label><div className="flex gap-2"><input id="footer-email" className="vk-store-input min-w-0 flex-1" disabled={newsletterSubmitting} name="email" required type="email" /><button className="minimal-primary px-5" disabled={newsletterSubmitting} type="submit">{newsletterSubmitting ? (isEnglish ? "Submitting…" : "提交中…") : (isEnglish ? "Subscribe" : "订阅")}</button></div><p className={newsletterStatusClass(newsletterTone)} role="status">{newsletterMessage}</p></form>
      </details>
      {visibleSocialChannels.length > 0 ? <div className="minimal-footer-social">{visibleSocialChannels.map((channel) => <a className="minimal-social-link" key={channel.label} href={channel.url} rel="noreferrer" target="_blank" title={channel.label} data-vk-event="social_click" aria-label={isEnglish ? "Follow on " + channel.label : "在" + channel.label + "关注我们"}><OfficialSocialLogo label={channel.label} /></a>)}</div> : null}
    </div>
    <div className="minimal-footer-bottom"><span>{isEnglish ? "© 2026 " + BRAND_NAME + ". Demo Merchant" : "© 2026 演示商家"}</span><div>{currentLegalLinks.map((link) => <Link href={link.href} key={link.href + link.label}>{link.label}</Link>)}<Link href={`${isEnglish ? "/en/feedback" : "/feedback"}?page=${encodeURIComponent(pathname)}`}>{isEnglish ? "Website feedback" : "网站反馈"}</Link><button onClick={() => window.dispatchEvent(new CustomEvent("vk:privacy-open"))} type="button">{isEnglish ? "Privacy choices" : "隐私偏好"}</button></div></div>
  </footer>;

}

function newsletterStatusClass(tone: "idle" | "success" | "error") {
  if (tone === "success") return "mt-2 rounded-[8px] bg-[#ecfdf3] px-3 py-2 text-xs font-black text-[#027a48] md:mt-3";
  if (tone === "error") return "mt-2 rounded-[8px] bg-[#fff1f3] px-3 py-2 text-xs font-black text-[#b42318] md:mt-3";
  return "mt-2 text-xs font-bold leading-5 text-muted md:mt-3";
}

"use client";
import Link from "next/link";
import { MINI_PROGRAM_PATH } from "@/lib/storefront-market";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BRAND_NAME } from "@/lib/brand";
import { BrandLogo } from "@/components/brand-logo";
import { CART_CHANGED_EVENT } from "@/lib/client/cart-cookie";
import { getLanguageSwitchHref, isEnglishStorefrontPath } from "@/lib/storefront-locale";
import styles from "./site-header-overlay.module.css";

export function SiteHeaderClient({ navigation, domestic = false }: { navigation: Array<{ label: string; href: string }>; domestic?: boolean }) {
  const pathname = usePathname();
  const isEnglish = isEnglishStorefrontPath(pathname);
  const isHome = pathname === "/" || pathname === "/en" || pathname === "/en/";
  const [cartCount, setCartCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const hidden = pathname.startsWith("/admin") || pathname.startsWith("/preview");
  useEffect(() => { document.documentElement.lang = isEnglish ? "en" : "zh-CN"; }, [isEnglish]);
  useEffect(() => {
    if (isEnglish || hidden) return;
    let cancelled = false;
    let revision = 0;
    const refresh = async () => {
      const current = ++revision;
      try {
        const response = await fetch("/api/cart", { cache: "no-store", credentials: "same-origin" });
        const result = await response.json();
        if (!cancelled && current === revision && result?.ok && result.cart?.itemCount != null) setCartCount(Number(result.cart.itemCount) || 0);
      } catch { /* Keep the last confirmed count while offline. */ }
    };
    void refresh();
    window.addEventListener(CART_CHANGED_EVENT, refresh);
    return () => { cancelled = true; window.removeEventListener(CART_CHANGED_EVENT, refresh); };
  }, [isEnglish, hidden, pathname]);
  if (hidden) return null;
  const prefix = isEnglish ? "/en" : "";
  const links = [
    { label: isEnglish ? "Products" : "产品", href: prefix + "/products/x1-air-white" },
    { label: isEnglish ? "About" : "关于", href: isEnglish ? "/en/about" : navigation.find((item) => item.href === "/about")?.href ?? "/about" },
    { label: isEnglish ? "Help" : "帮助", href: prefix + "/shopping-guide" },
  ];
  if (domestic) links.push({ label: isEnglish ? "WeChat store" : "小程序购买", href: MINI_PROGRAM_PATH });
  const close = () => setMenuOpen(false);
  return <header className={`minimal-header${isHome ? ` ${styles.overlayHeader}` : ""}`} data-menu-open={menuOpen} onKeyDown={(event) => { if (event.key === "Escape" && menuOpen) { close(); event.currentTarget.querySelector<HTMLButtonElement>(".minimal-menu-button")?.focus(); } }}>
    <div className="minimal-header-inner">
      <Link className="minimal-wordmark" href={prefix || "/"} aria-label={BRAND_NAME + (isEnglish ? " home" : " 首页")} onClick={close}><BrandLogo /></Link>
      <nav className="minimal-desktop-nav" aria-label={isEnglish ? "Main navigation" : "主导航"}>
        {links.map((link) => <Link href={link.href} key={link.href} aria-current={pathname === link.href ? "page" : undefined}>{link.label}</Link>)}
      </nav>
      <div className="minimal-utilities">
        <Link href={getLanguageSwitchHref(pathname)} aria-label={isEnglish ? "Switch to Chinese" : "切换至英文"} data-vk-event="language_switch" onClick={close}>{isEnglish ? "中文" : "EN"}</Link>
        <Link className="minimal-account" href={isEnglish ? "/en/availability" : "/account"} onClick={close}>{isEnglish ? "Account" : "账户"}</Link>
        <Link href={isEnglish ? "/en/availability" : "/bag"} aria-label={isEnglish ? "International checkout availability" : "购物袋 " + cartCount} onClick={close}>{isEnglish ? "Bag" : "购物袋"} ({isEnglish ? 0 : cartCount})</Link>
        <button className="minimal-menu-button" aria-label={isEnglish ? (menuOpen ? "Close navigation" : "Open navigation") : (menuOpen ? "关闭导航" : "打开导航")} aria-expanded={menuOpen} aria-controls="minimal-mobile-nav" onClick={() => setMenuOpen(!menuOpen)} type="button"><span className="minimal-menu-icon" aria-hidden="true"><span /><span /></span></button>
      </div>
    </div>
    <div className="minimal-mobile-nav-shell" data-open={menuOpen} inert={!menuOpen} aria-hidden={!menuOpen}><div className="minimal-mobile-nav-clip"><nav className="minimal-mobile-nav" id="minimal-mobile-nav" aria-label={isEnglish ? "Mobile navigation" : "移动导航"}>{[...links, { label: isEnglish ? "Join us" : "加入我们", href: prefix + "/careers" }, { label: isEnglish ? "Account" : "账户", href: isEnglish ? "/en/availability" : "/account" }].map((link) => <Link href={link.href} key={link.href} onClick={close} aria-current={pathname === link.href ? "page" : undefined}>{link.label}</Link>)}</nav></div></div>
  </header>;
}

"use client";

import { BrandLabel } from "@/components/brand-logo";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { AnalyticsEventName, ConsentPreferences } from "@/lib/analytics-contract";

const storageKey = "vk_privacy_preferences_2026_08_19";
const acceptedPreferences: ConsentPreferences = { analytics: true, personalization: true, device: true, marketing: true };
const declinedPreferences: ConsentPreferences = { analytics: false, personalization: false, device: false, marketing: false };

export function AnalyticsProvider({ initialPreferences }: { initialPreferences: ConsentPreferences | null }) {
  const pathname = usePathname();
  const [preferences, setPreferences] = useState<ConsentPreferences | null>(initialPreferences);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const pageStartedAt = useRef(0);
  const excluded = pathname.startsWith("/admin") || pathname.startsWith("/preview");
  const locale = pathname === "/en" || pathname.startsWith("/en/") ? "en" : "zh-CN";

  useEffect(() => {
    if (excluded || !preferences?.analytics) return;
    pageStartedAt.current = Date.now();
    void sendEvent("page_view", pathname, preferences);
    const productMatch = pathname.match(/^\/(?:en\/)?products\/([^/]+)$/);
    if (productMatch) void sendEvent("product_view", pathname, preferences, { productId: productMatch[1] });
    return () => {
      const durationSeconds = Math.max(0, Math.round((Date.now() - pageStartedAt.current) / 1000));
      void sendEvent("page_leave", pathname, preferences, { durationSeconds });
    };
  }, [excluded, pathname, preferences]);

  useEffect(() => {
    if (excluded || !preferences?.analytics) return;
    const activePreferences = preferences;
    function trackCustom(event: Event) {
      const detail = (event as CustomEvent<{ name?: AnalyticsEventName; properties?: Record<string, string | number | boolean> }>).detail;
      if (!detail?.name) return;
      void sendEvent(detail.name, pathname, activePreferences, { properties: detail.properties });
    }
    window.addEventListener("vk:analytics", trackCustom);
    return () => window.removeEventListener("vk:analytics", trackCustom);
  }, [excluded, pathname, preferences]);

  useEffect(() => {
    if (excluded || !preferences?.analytics) return;
    const activePreferences = preferences;
    function trackClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-vk-event],a,button") : null;
      if (!target) return;
      const href = target instanceof HTMLAnchorElement ? target.href : "";
      const explicit = target.dataset.vkEvent as AnalyticsEventName | undefined;
      let name = explicit;
      const properties: Record<string, string> = {};
      if (!name && /x\.com\/merchantkit|xhslink\.cn/.test(href)) name = "social_click";
      if (!name && (href.endsWith("/en") || href.includes("/en/")) && !pathname.startsWith("/en")) name = "language_switch";
      if (!name && href && pathname.startsWith("/en") && new URL(href).pathname === "/") name = "language_switch";
      if (!name) return;
      for (const [key, value] of Object.entries(target.dataset)) {
        if (key.startsWith("vk") && key !== "vkEvent" && value) properties[key.slice(2).replace(/^./, (char) => char.toLowerCase())] = value;
      }
      if (name === "social_click") properties.channel = href.includes("xhslink.cn") ? "xiaohongshu" : "x";
      void sendEvent(name, pathname, activePreferences, { properties });
    }
    document.addEventListener("click", trackClick, { capture: true });
    return () => document.removeEventListener("click", trackClick, { capture: true });
  }, [excluded, pathname, preferences]);

  useEffect(() => {
    if (excluded) return;
    function openPrivacyPreferences() {
      setChoiceOpen(true);
    }
    window.addEventListener("vk:privacy-open", openPrivacyPreferences);
    return () => window.removeEventListener("vk:privacy-open", openPrivacyPreferences);
  }, [excluded]);

  const declined = Boolean(preferences && !preferences.analytics && !preferences.personalization && !preferences.device && !preferences.marketing);
  const gateVisible = !excluded && (!preferences || choiceOpen || declined);

  useEffect(() => {
    if (!gateVisible) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [gateVisible]);

  async function commitPreferences(nextPreferences: ConsentPreferences) {
    if (saving) return;
    setSaving(true); setSaveError(false);
    try {
      if (!await savePreferences(nextPreferences, locale, setPreferences)) throw new Error("Consent save failed");
      setChoiceOpen(false);
    } catch { setSaveError(true); }
    finally { setSaving(false); }
  }

  if (!gateVisible) return null;
  const english = locale === "en";

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/55 p-3 backdrop-blur-[2px] sm:items-center sm:p-6">
      <aside aria-label={english ? "Privacy consent" : "隐私同意"} aria-modal="true" className="vk-privacy-panel w-full max-w-2xl rounded-[4px] border border-black bg-white p-5 text-[#111111] shadow-2xl sm:p-7" role="dialog">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#6b6b6b]"><BrandLabel>MerchantKit Privacy</BrandLabel></p>
        <h2 className="mt-2 text-xl font-normal tracking-[-0.02em] sm:text-2xl">
          {declined ? (english ? "Consent is required to continue" : "需要同意后才能继续") : (english ? "Choose whether to continue" : "请选择是否同意并继续")}
        </h2>
        <p className="mt-3 text-sm font-normal leading-6 text-[#595959]">
          {declined
            ? (english ? "You chose not to consent, so access to the site is paused. Agree to enable the site and continue." : "你已选择不同意，因此网站已暂停使用。同意后即可恢复并继续访问。")
            : (english ? "We use cookies for site operation, analytics, personalization and device recognition. Agree to continue; declining will prevent use of the site." : "我们会使用 Cookie 维持网站运行，并进行访问分析、个性化与设备识别。同意后可继续使用；不同意将无法使用网站。")}
        </p>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button aria-busy={saving} disabled={saving} className="vk-button min-h-12 w-full border-black bg-black px-5 text-sm text-white hover:bg-[#222222]" onClick={() => void commitPreferences(acceptedPreferences)} type="button">{saving && <span className="vk-spinner" aria-hidden="true" />}{saving ? (english ? "Saving…" : "正在保存…") : (english ? "Agree and continue" : "同意并继续")}</button>
          <button aria-pressed={declined} className="vk-button min-h-12 w-full border-black bg-white px-5 text-sm text-black hover:bg-[#f2f2f2] disabled:cursor-not-allowed disabled:border-[#b5b5b5] disabled:bg-[#eeeeee] disabled:text-[#777777]" disabled={declined || saving} onClick={() => void commitPreferences(declinedPreferences)} type="button">{english ? "Decline" : "不同意"}</button>
        </div>
        {saveError && <p className="mt-4 text-sm" role="alert">{english ? "Could not save your choice. Please try again." : "暂时无法保存选择，请重试。"}</p>}
      </aside>
    </div>
  );
}

async function savePreferences(preferences: ConsentPreferences, locale: "en" | "zh-CN", setPreferences: (value: ConsentPreferences) => void) {
  const response = await fetch("/api/privacy/consent", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...preferences, locale }) });
  if (!response.ok) return false;
  try { window.localStorage.setItem(storageKey, JSON.stringify(preferences)); } catch { /* The server cookie remains authoritative if storage is unavailable. */ }
  setPreferences(preferences);
  return true;
}

async function sendEvent(name: AnalyticsEventName, path: string, preferences: ConsentPreferences, extra: { durationSeconds?: number; productId?: string; properties?: Record<string, string | number | boolean> } = {}) {
  const query = new URLSearchParams(window.location.search);
  const payload = {
    name,
    path,
    locale: path === "/en" || path.startsWith("/en/") ? "en" : "zh-CN",
    referrer: document.referrer,
    source: query.get("utm_source") || undefined,
    medium: query.get("utm_medium") || undefined,
    campaign: query.get("utm_campaign") || undefined,
    deviceSignal: preferences.device ? [navigator.userAgent, navigator.language, Intl.DateTimeFormat().resolvedOptions().timeZone, screen.width, screen.height, screen.colorDepth, navigator.hardwareConcurrency].join("|") : undefined,
    ...extra,
  };
  const body = JSON.stringify(payload);
  if (name === "page_leave" && navigator.sendBeacon) {
    navigator.sendBeacon("/api/analytics/events", new Blob([body], { type: "application/json" }));
    return;
  }
  await fetch("/api/analytics/events", { method: "POST", credentials: "same-origin", keepalive: true, headers: { "Content-Type": "application/json" }, body }).catch(() => undefined);
}

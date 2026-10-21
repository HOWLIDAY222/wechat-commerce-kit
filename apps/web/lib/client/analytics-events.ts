import type { AnalyticsEventName } from "@/lib/analytics-contract";

export function trackStorefrontEvent(name: AnalyticsEventName, properties?: Record<string, string | number | boolean>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("vk:analytics", { detail: { name, properties } }));
}

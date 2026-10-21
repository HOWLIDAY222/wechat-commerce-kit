export const CART_CHANGED_EVENT = "vk:cart-changed";

export function persistCartCookie(key?: string) {
  if (!key) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `merchantkit_cart=${encodeURIComponent(key)}; Max-Age=${60 * 60 * 24 * 30}; Path=/; SameSite=Lax${secure}`;
  window.dispatchEvent(new Event(CART_CHANGED_EVENT));
}

export const adminCapabilities = [
  "operate_catalog",
  "operate_orders",
  "operate_after_sales",
  "moderate_customers",
  "publish_storefront",
  "manage_commerce_mode",
  "send_newsletter_campaign",
  "manage_admin_privileges",
  "execute_real_refund",
] as const;

export type AdminCapability = (typeof adminCapabilities)[number];

const ownerOnlyCapabilities = new Set<AdminCapability>([
  "manage_commerce_mode",
  "send_newsletter_campaign",
  "manage_admin_privileges",
  "execute_real_refund",
]);

export function hasAdminCapability(role: string, capability: AdminCapability) {
  const normalizedRole = role.toLowerCase();
  if (normalizedRole === "owner") return true;
  if (normalizedRole !== "admin") return false;
  return !ownerOnlyCapabilities.has(capability);
}

export function canExecuteProviderRefund(role: string, provider: string) {
  return !["alipay", "wechat_pay"].includes(provider.toLowerCase()) || hasAdminCapability(role, "execute_real_refund");
}

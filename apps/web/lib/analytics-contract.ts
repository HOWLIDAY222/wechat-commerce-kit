export const analyticsEventNames = [
  "page_view",
  "page_leave",
  "product_view",
  "select_pack",
  "select_color",
  "select_size",
  "add_to_bag",
  "begin_checkout",
  "order_created",
  "payment_attempt",
  "payment_success",
  "language_switch",
  "social_click",
] as const;

export type AnalyticsEventName = (typeof analyticsEventNames)[number];

export type ConsentPreferences = {
  analytics: boolean;
  personalization: boolean;
  device: boolean;
  marketing: boolean;
};

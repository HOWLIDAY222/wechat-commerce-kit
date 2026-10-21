export const OFFICIAL_EMAILS = {
  sales: "sales@example.invalid",
  noreply: "noreply@example.invalid",
  postmaster: "postmaster@example.invalid",
  support: "support@example.invalid",
  finance: "finance@example.invalid",
  marketing: "marketing@example.invalid",
  hr: "hr@example.invalid",
  info: "info@example.invalid",
} as const;

export function emailSubjectHref(email: string, subject: string) {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}

import { z } from "zod";

export const MEMBER_REWARD_POLICY_KEY = "memberRewardPolicy";
export const REFERRAL_COUPON_TEMPLATE_ID = "rewards-v3-referral-600-200";
const integer = (maximum: number) => z.number().int().min(0).max(maximum);
const referralSchema = z.object({
  enabled: z.boolean(),
  activatedAt: z.iso.datetime().nullable(),
  newMemberPoints: integer(100_000),
  newMemberRewardMode: z.enum(["ADDITIONAL", "NEWCOMER_TOTAL"]),
  inviterRegistrationPoints: integer(100_000),
  inviterRegistrationLimit: integer(1_000_000),
  purchaseCouponTemplateId: z.string().regex(/^[A-Za-z0-9_-]{1,120}$/),
  purchaseCouponAmountCents: integer(100_000_000),
  purchaseCouponMinimumCents: integer(100_000_000),
  purchaseCouponValidityMonths: z.number().int().min(1).max(120),
}).strict().refine(value => !value.enabled || value.activatedAt !== null,
  "An enabled referral program requires its activation time");

// Other reward programs own their own fields. Reading referrals must preserve
// those fields, and must never replace a saved policy with these defaults.
export const memberRewardPolicySchema = z.object({ version: z.literal(1), referral: referralSchema }).passthrough();
export type MemberRewardPolicy = z.infer<typeof memberRewardPolicySchema>;
export type ReferralRewardPolicy = MemberRewardPolicy["referral"];
export function defaultMemberRewardPolicy(): MemberRewardPolicy {
  return { version: 1, referral: { enabled: false, activatedAt: null, newMemberPoints: 100, newMemberRewardMode: "ADDITIONAL",
    inviterRegistrationPoints: 100, inviterRegistrationLimit: 20,
    purchaseCouponTemplateId: REFERRAL_COUPON_TEMPLATE_ID,
    purchaseCouponAmountCents: 20_000, purchaseCouponMinimumCents: 60_000, purchaseCouponValidityMonths: 2 } };
}
export function parseMemberRewardPolicy(value: unknown): MemberRewardPolicy {
  if (value === null || value === undefined) return defaultMemberRewardPolicy();
  if (typeof value !== "object" || Array.isArray(value)) throw Error("INVALID_MEMBER_REWARD_POLICY");
  const source = value as Record<string, unknown>;
  if (Object.hasOwn(source, "referral") && (!source.referral || typeof source.referral !== "object" || Array.isArray(source.referral))) throw Error("INVALID_MEMBER_REWARD_POLICY");
  const parsed = memberRewardPolicySchema.safeParse({ ...defaultMemberRewardPolicy(), ...source,
    referral: { ...defaultMemberRewardPolicy().referral,
      ...(source.referral && typeof source.referral === "object" && !Array.isArray(source.referral) ? source.referral : {}) } });
  if (!parsed.success) throw Error("INVALID_MEMBER_REWARD_POLICY");
  return parsed.data;
}
export function referralProgramActive(rule: ReferralRewardPolicy, now = new Date()): boolean {
  return rule.enabled && !!rule.activatedAt && new Date(rule.activatedAt).getTime() <= now.getTime();
}
export function referralNetGoodsCents(order: { payableAmountCents: number; shippingFeeCents: number }, refundedCents: number): number {
  return Math.max(0, order.payableAmountCents - order.shippingFeeCents - Math.max(0, refundedCents));
}
export function addUtcCalendarMonths(value: Date, months: number): Date {
  if (!Number.isFinite(value.getTime()) || !Number.isInteger(months) || months < 1 || months > 120) throw Error("INVALID_MEMBER_REWARD_EXPIRY");
  const absoluteMonth = value.getUTCFullYear() * 12 + value.getUTCMonth() + months;
  const year = Math.floor(absoluteMonth / 12), month = absoluteMonth % 12;
  const day = Math.min(value.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day, value.getUTCHours(), value.getUTCMinutes(), value.getUTCSeconds(), value.getUTCMilliseconds()));
}

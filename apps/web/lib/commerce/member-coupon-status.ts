export type MemberCouponStatus = "VOID" | "USED" | "HELD" | "EXPIRED" | "INELIGIBLE" | "AVAILABLE";
type Claim = { voided: boolean; expiresAt: Date | null; template: { endsAt: Date; newcomerOnly?: boolean }; heldOrder: { paymentStatus: string } | null };
export function memberCouponStatus(claim: Claim, now = new Date(), hasPaidOrder = false): MemberCouponStatus {
  if (claim.voided) return "VOID";
  if (claim.heldOrder) return ["PAID", "REFUNDED", "PARTIALLY_REFUNDED"].includes(claim.heldOrder.paymentStatus) ? "USED" : "HELD";
  if (claim.template.endsAt <= now || claim.expiresAt && claim.expiresAt <= now) return "EXPIRED";
  if (claim.template.newcomerOnly && hasPaidOrder) return "INELIGIBLE";
  return "AVAILABLE";
}
export const memberCouponStatusLabels: Record<MemberCouponStatus, string> = { VOID: "已失效", USED: "已使用", HELD: "订单占用", EXPIRED: "已过期", INELIGIBLE: "不符合首购条件", AVAILABLE: "未使用" };
export const memberCouponSourceLabels: Record<string, string> = { PUBLIC: "主动领取", JOIN: "入会赠送", FIRST_ORDER: "首单收货", MANUAL: "后台发放", POINTS: "积分兑换", STUDENT: "学生认证奖励", REFERRAL: "邀请消费奖励" };

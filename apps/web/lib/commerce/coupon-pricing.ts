import { calculateCartPricing } from "./quantity-pricing";

type Item = Parameters<typeof calculateCartPricing>[0][number];
export type CouponCandidate = {
  id: string;
  title: string;
  amountCents: number;
  minimumCents: number;
  productIds: string[];
  endsAt: Date;
  newcomerOnly?:boolean;
};

/** One coupon or quantity pricing, never both. Ties preserve the coupon. */
export function chooseCouponPricing(items: Item[], coupons: CouponCandidate[]) {
  const base = calculateCartPricing(items);
  let result = { ...base, couponClaimId: null as string | null, discountLabel: base.discountCents ? "组合优惠" : "" };
  for (const coupon of [...coupons].sort((a, b) => Number(Boolean(b.newcomerOnly))-Number(Boolean(a.newcomerOnly)) || a.endsAt.getTime() - b.endsAt.getTime() || a.id.localeCompare(b.id))) {
    const eligible = items.filter(item => !coupon.productIds.length || coupon.productIds.includes(item.productId));
    const eligibleSubtotal = eligible.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
    if (eligibleSubtotal < coupon.minimumCents) continue;
    // The existing checkout requires a positive payable merchandise amount.
    const discount = Math.min(coupon.amountCents, eligibleSubtotal, Math.max(0, base.subtotalCents - 1));
    if (discount <= result.discountCents) continue;
    const shares: Record<string, number> = {};
    let allocated = 0;
    const sorted = [...eligible].sort((a, b) => a.id.localeCompare(b.id));
    for (const item of sorted) {
      const share = Math.floor(discount * item.quantity * item.unitPriceCents / eligibleSubtotal);
      shares[item.id] = share;
      allocated += share;
    }
    // Largest possible rounding remainder is less than the number of lines.
    for (const item of sorted) {
      if (allocated >= discount) break;
      if (shares[item.id] < item.quantity * item.unitPriceCents) { shares[item.id]++; allocated++; }
    }
    result = { subtotalCents: base.subtotalCents, discountCents: discount, payableAmountCents: base.subtotalCents - discount,
      itemDiscountShares: shares, couponClaimId: coupon.id, discountLabel: coupon.title };
  }
  return result;
}

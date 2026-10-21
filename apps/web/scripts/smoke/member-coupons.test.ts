import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseCouponPricing } from "../../lib/commerce/coupon-pricing";
const item = (id = "a", price = 4900, qty = 1) => ({ id, productId: id, quantity: qty, unitPriceCents: price, product: {} });
const coupon = (amount = 1000, minimum = 0, productIds: string[] = []) => ({ id: "coupon", title: "会员券", amountCents: amount, minimumCents: minimum, productIds, endsAt: new Date("2030-01-01") });
test("quantity discount wins; tie does not consume a coupon", () => {
  const items = [{ ...item("a", 4900, 2), product: { quantityPricing: { maxQuantity: 3, tiers: [{ quantity: 2, totalPriceCents: 7900 }] } } }];
  assert.equal(chooseCouponPricing(items, [coupon(1000)]).payableAmountCents, 7900);
  assert.equal(chooseCouponPricing(items, [coupon(1900)]).couponClaimId, null);
  assert.equal(chooseCouponPricing(items, [coupon(2000)]).payableAmountCents, 7800);
});
test("threshold and discount use eligible products only", () => {
  assert.equal(chooseCouponPricing([item("a", 1000), item("b", 9000)], [coupon(2000, 2000, ["a"])]).discountCents, 0);
  const quote = chooseCouponPricing([item("a", 1000), item("b", 9000)], [coupon(2000, 0, ["a"])]);
  assert.equal(quote.discountCents, 1000); assert.equal(quote.itemDiscountShares.b, undefined);
});
test("full-value coupon leaves one cent; eligible allocations never exceed a line", () => {
  for (let total = 1; total < 100; total++) {
    const quote = chooseCouponPricing([item("a", total), item("b", 1), item("c", 1)], [coupon(10000)]);
    assert.equal(quote.payableAmountCents, 1);
    assert.equal(Object.values(quote.itemDiscountShares).reduce((a, b) => a + b, 0), quote.discountCents);
    assert(quote.itemDiscountShares.a <= total); assert(quote.itemDiscountShares.b <= 1); assert(quote.itemDiscountShares.c <= 1);
  }
});
test("equal coupons consume the one expiring first, stable by id", () => {
  const early = { ...coupon(), id: "early", endsAt: new Date("2029-01-01") };
  assert.equal(chooseCouponPricing([item()], [coupon(), early]).couponClaimId, "early");
});

test('equal first-purchase and points coupons use the first-purchase coupon before it becomes ineligible',()=>{
  const first={...coupon(500,4900),id:'first',newcomerOnly:true,endsAt:new Date('2030-01-01')};
  const points={...coupon(500,4900),id:'points',newcomerOnly:false,endsAt:new Date('2029-01-01')};
  assert.equal(chooseCouponPricing([item()], [points,first]).couponClaimId,'first');
  assert.equal(chooseCouponPricing([item()], [first,{...points,amountCents:1000}]).couponClaimId,'points');
});

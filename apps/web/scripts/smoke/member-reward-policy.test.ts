import assert from "node:assert/strict";
import { test } from "node:test";
import { addUtcCalendarMonths, defaultMemberRewardPolicy, parseMemberRewardPolicy, referralNetGoodsCents, referralProgramActive } from "@/lib/commerce/member-reward-policy";

test("referral rewards stay disabled until activation and defaults are independent", () => {
  const first = defaultMemberRewardPolicy(); first.referral.enabled = true;
  const second = defaultMemberRewardPolicy();
  assert.equal(second.referral.enabled, false);
  assert.equal(second.referral.newMemberRewardMode, "ADDITIONAL");
  assert.equal(second.referral.newMemberPoints, 100);
  assert.equal(second.referral.inviterRegistrationPoints, 100);
  assert.equal(second.referral.inviterRegistrationLimit, 20);
  assert.equal(referralProgramActive(second.referral), false);
});
test("policy upgrades preserve unrelated reward programs and explicit merchant values", () => {
  const source = { version: 1, referral: { inviterRegistrationLimit: 17 }, studentBenefits: { validDays: 180, enabled: true } };
  const result = parseMemberRewardPolicy(source);
  assert.deepEqual(result.studentBenefits, source.studentBenefits);
  assert.equal(result.referral.inviterRegistrationLimit, 17);
  assert.equal(result.referral.enabled, false);
  assert.equal(result.referral.purchaseCouponAmountCents, 20_000);
});
test("invalid saved policies fail closed instead of silently activating or resetting programs", () => {
  for (const value of [true, [], { referral: false }, { referral: null }, { version: 2 }, { referral: { enabled: true } },
    { referral: { newMemberPoints: -1 } }, { referral: { inviterRegistrationLimit: 1.5 } }, { referral: { unknown: true } },
    { referral: { activatedAt: "not-a-date" } }, { referral: { purchaseCouponTemplateId: "../bad" } }]) {
    assert.throws(() => parseMemberRewardPolicy(value), /INVALID_MEMBER_REWARD_POLICY/);
  }
});
test("an activation timestamp is honored at its exact boundary", () => {
  const rule = { ...defaultMemberRewardPolicy().referral, enabled: true, activatedAt: "2026-10-18T12:00:00.000Z" };
  assert.equal(referralProgramActive(rule, new Date("2026-10-18T11:59:59.999Z")), false);
  assert.equal(referralProgramActive(rule, new Date("2026-10-18T12:00:00.000Z")), true);
  assert.equal(referralProgramActive({ ...rule, enabled: false }, new Date("2026-10-18T12:00:01.000Z")), false);
});
test("successful refund net payment excludes shipping and clamps at zero", () => {
  const order = { payableAmountCents: 6_000, shippingFeeCents: 1_000 };
  assert.equal(referralNetGoodsCents(order, 0), 5_000);
  assert.equal(referralNetGoodsCents(order, 4_999), 1);
  assert.equal(referralNetGoodsCents(order, 5_000), 0);
  assert.equal(referralNetGoodsCents(order, 6_000), 0);
  assert.equal(referralNetGoodsCents(order, -5), 5_000);
});
test("two calendar months preserve UTC time and clamp to the destination month end", () => {
  for (const [before, after] of [["2026-10-18T12:34:56.789Z", "2026-12-18T12:34:56.789Z"],
    ["2026-12-31T23:59:59.000Z", "2027-02-28T23:59:59.000Z"], ["2027-12-31T00:00:00.000Z", "2028-02-29T00:00:00.000Z"],
    ["2026-07-31T00:00:00.000Z", "2026-09-30T00:00:00.000Z"]]) {
    const source = new Date(before); assert.equal(addUtcCalendarMonths(source, 2).toISOString(), after); assert.equal(source.toISOString(), before);
  }
  assert.throws(() => addUtcCalendarMonths(new Date(), 0), /INVALID_MEMBER_REWARD_EXPIRY/);
  assert.throws(() => addUtcCalendarMonths(new Date(NaN), 2), /INVALID_MEMBER_REWARD_EXPIRY/);
});

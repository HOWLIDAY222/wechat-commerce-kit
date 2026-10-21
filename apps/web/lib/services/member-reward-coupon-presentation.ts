import { prisma } from "@/lib/db/prisma";
import { defaultMemberOperationsConfig, memberOperationsConfigSchema } from "@/lib/commerce/member-operations";
import { studentValidityDays } from "@/lib/commerce/member-student";
import { readMemberRewardPolicy } from "@/lib/services/member-automation-rewards-service";

export async function getMemberRewardCouponPresentation(): Promise<Record<string, { condition: string; validity: string }>> {
  const [rows, policy] = await Promise.all([
    prisma.$queryRaw<Array<{ config: unknown }>>`SELECT config FROM member_operation_settings WHERE id='member-operations'`,
    readMemberRewardPolicy(prisma),
  ]);
  const config = memberOperationsConfigSchema.parse(rows[0]?.config ?? defaultMemberOperationsConfig());
  const rules: Record<string, { condition: string; validity: string }> = {};
  for (const id of config.studentBenefits.couponTemplateIds) rules[id] = { condition: "微信学生认证通过后，按认证周期发放", validity: `每张券有效期${studentValidityDays}天，与认证周期一致` };
  rules[policy.referral.purchaseCouponTemplateId] = { condition: "邀请好友入会并完成有效消费后自动发放", validity: `每张券自发放起${policy.referral.purchaseCouponValidityMonths}个月内有效` };
  return rules;
}

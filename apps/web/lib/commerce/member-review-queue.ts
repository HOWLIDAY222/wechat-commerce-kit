export const memberReviewPageSize = 50;
export const memberReviewStatuses = ["PENDING", "APPROVED", "REJECTED", "REWARDED", "ALL"] as const;
export type MemberReviewQuery = { status?: string; page?: number };
export function normalizeMemberReviewQuery(input: MemberReviewQuery = {}) {
  const status = input.status ?? "PENDING", page = input.page ?? 1;
  if (!(memberReviewStatuses as readonly string[]).includes(status) || !Number.isSafeInteger(page) || page < 1 || page > 100000) throw Error("INVALID_MEMBER_OPERATION");
  return { status, page };
}

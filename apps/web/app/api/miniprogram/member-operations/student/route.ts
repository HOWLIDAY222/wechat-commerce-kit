import { NextResponse } from "next/server";
import { readRequestUserSession } from "@/lib/auth/session";
import { hasSameHostMemberProfileOrigin } from "@/lib/commerce/member-profile";
import { studentVerificationInputSchema } from "@/lib/commerce/member-student";
import { verifyWeChatStudent } from "@/lib/services/member-operations-service";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };
export async function POST(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401, headers });
  if (!hasSameHostMemberProfileOrigin(request)) return NextResponse.json({ ok: false, error: "INVALID_ORIGIN" }, { status: 403, headers });
  const input = studentVerificationInputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ ok: false, error: "INVALID_STUDENT_VERIFICATION" }, { status: 400, headers });
  try { return NextResponse.json({ ok: true, ...await verifyWeChatStudent(session.userId, input.data) }, { headers }); }
  catch (error) {
    const code = error instanceof Error && /^(?:WECHAT_STUDENT_[A-Z_]+|WECHAT_MINIPROGRAM_NOT_CONFIGURED|MEMBER_STUDENT_[A-Z_]+|MEMBER_OPERATIONS_[A-Z_]+|MEMBER_PHONE_REQUIRED|MEMBER_CUSTOMER_REQUIRED|MEMBERSHIP_REQUIRED|ACCOUNT_NOT_FOUND|COUPON_SOLD_OUT|MEMBER_REWARD_COUPON_UNAVAILABLE)$/.test(error.message) ? error.message : "WECHAT_STUDENT_UNAVAILABLE";
    return NextResponse.json({ ok: false, error: code }, { status: code === "WECHAT_STUDENT_RATE_LIMITED" ? 429 : 409, headers });
  }
}

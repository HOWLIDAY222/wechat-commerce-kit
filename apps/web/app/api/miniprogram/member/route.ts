import { NextResponse } from "next/server";
import { z } from "zod";
import { readBearerUserSession } from "@/lib/auth/session";
import { getMemberOverview, joinMembership, claimMemberCoupon, redeemMemberCoupon,claimNewcomerBenefits } from "@/lib/services/membership-service";

const schema = z.discriminatedUnion("action", [z.object({ action: z.literal("join") }),z.object({action:z.literal("newcomer")}), z.object({ action: z.literal("claim"), templateId: z.string().min(1).max(100) }), z.object({action:z.literal("redeem"),templateId:z.string().min(1).max(100),requestId:z.uuid()})]);
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function GET(request: Request) {
  const session = await readBearerUserSession(request);
  if (!session) return json({ ok: false, error: "AUTH_REQUIRED" }, 401);
  return json({ ok: true, ...await getMemberOverview(session.userId) });
}
export async function POST(request: Request) {
  const session = await readBearerUserSession(request);
  if (!session) return json({ ok: false, error: "AUTH_REQUIRED" }, 401);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ ok: false, error: "INVALID_MEMBER_REQUEST" }, 400);
  try {
    if (parsed.data.action === "join") await joinMembership(session.userId);
    else if(parsed.data.action==="newcomer")await claimNewcomerBenefits(session.userId);
    else if(parsed.data.action==="claim") await claimMemberCoupon(session.userId, parsed.data.templateId);
    else await redeemMemberCoupon(session.userId,parsed.data.templateId,parsed.data.requestId);
    return json({ ok: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const expected = ["MEMBER_PHONE_REQUIRED", "MEMBERSHIP_REQUIRED", "COUPON_UNAVAILABLE", "COUPON_NEWCOMER_ONLY", "COUPON_SOLD_OUT","POINTS_INSUFFICIENT","COUPON_DELIVERY_FORBIDDEN","MEMBER_CUSTOMER_REQUIRED","MEMBER_REQUEST_CHANGED","INVALID_REDEMPTION","NEWCOMER_UNAVAILABLE","NEWCOMER_ALREADY_CLAIMED","COUPON_MEMBER_LIMIT"];
    return json({ ok: false, error: expected.includes(code) ? code : "MEMBER_ACTION_FAILED" }, expected.includes(code) ? 400 : 503);
  }
}

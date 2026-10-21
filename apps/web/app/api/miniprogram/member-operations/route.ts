import { NextResponse } from "next/server";
import { readRequestUserSession } from "@/lib/auth/session";
import { hasSameHostMemberProfileOrigin } from "@/lib/commerce/member-profile";
import { memberOperationInputSchema } from "@/lib/commerce/member-operations";
import { getMemberOperations, performMemberOperation } from "@/lib/services/member-operations-service";

const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "MEMBER_OPERATIONS_UNAVAILABLE";
  const safe = /^(?:MEMBER_OPERATIONS_[A-Z_]+|INVALID_MEMBER_OPERATION|MEMBER_CUSTOMER_REQUIRED|MEMBER_PHONE_REQUIRED|MEMBERSHIP_REQUIRED|POINTS_INSUFFICIENT|ACCOUNT_NOT_FOUND)$/.test(code) ? code : "MEMBER_OPERATIONS_UNAVAILABLE";
  const status = safe === "INVALID_MEMBER_OPERATION" ? 400 : safe === "ACCOUNT_NOT_FOUND" || safe === "MEMBER_OPERATIONS_NOT_FOUND" ? 404 : safe === "MEMBER_OPERATIONS_UNAVAILABLE" ? 503 : 409;
  return NextResponse.json({ ok: false, error: safe }, { status, headers });
}
export async function GET(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401, headers });
  try { return NextResponse.json({ ok: true, ...await getMemberOperations(session.userId) }, { headers }); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401, headers });
  if (!hasSameHostMemberProfileOrigin(request)) return NextResponse.json({ ok: false, error: "INVALID_ORIGIN" }, { status: 403, headers });
  const parsed = memberOperationInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_MEMBER_OPERATION" }, { status: 400, headers });
  try { return NextResponse.json({ ok: true, ...await performMemberOperation(session.userId, parsed.data) }, { headers }); } catch (error) { return failure(error); }
}

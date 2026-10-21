import { NextResponse } from "next/server";
import { readRequestUserSession } from "@/lib/auth/session";
import { hasSameHostMemberProfileOrigin, parseMemberProfileInput } from "@/lib/commerce/member-profile";
import { getMemberAccountProfile, saveMemberAccountProfile } from "@/lib/services/member-profile-service";
import { getMemberAvatar } from "@/lib/services/member-avatar-service";
import { memberAvatarDto } from "@/lib/commerce/member-avatar";

const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "MEMBER_PROFILE_UNAVAILABLE";
  const status = code === "ACCOUNT_NOT_FOUND" ? 404 : code === "INVALID_MEMBER_PROFILE" ? 400 : ["MEMBER_PROFILE_REVISION_CONFLICT", "MEMBER_PROFILE_PHONE_REQUIRED"].includes(code) ? 409 : 503;
  return NextResponse.json({ ok: false, error: status === 503 ? "MEMBER_PROFILE_UNAVAILABLE" : code }, { status, headers });
}
export async function GET(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401, headers });
  try {
    const profile = await getMemberAccountProfile(session.userId);
    const avatar = await getMemberAvatar(session.userId).catch(() => memberAvatarDto(null, false));
    return NextResponse.json({ ok: true, ...profile, avatar }, { headers });
  }
  catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401, headers });
  if (!hasSameHostMemberProfileOrigin(request)) return NextResponse.json({ ok: false, error: "INVALID_ORIGIN" }, { status: 403, headers });
  const input = parseMemberProfileInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ ok: false, error: "INVALID_MEMBER_PROFILE" }, { status: 400, headers });
  try { return NextResponse.json({ ok: true, ...await saveMemberAccountProfile(session.userId, input) }, { headers }); }
  catch (error) { return failure(error); }
}

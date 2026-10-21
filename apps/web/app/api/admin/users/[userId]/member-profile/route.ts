import { NextResponse } from "next/server";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { getAdminMemberAccountProfile } from "@/lib/services/member-profile-service";

const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
type Props = { params: Promise<{ userId: string }> };
export async function GET(_request: Request, { params }: Props) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401, headers });
  try {
    const { userId } = await params;
    return NextResponse.json({ ok: true, ...await getAdminMemberAccountProfile(userId, session.userId) }, { headers });
  } catch (error) {
    const code = error instanceof Error ? error.message : "MEMBER_PROFILE_UNAVAILABLE";
    const status = code === "ACCOUNT_NOT_FOUND" ? 404 : code === "ADMIN_REQUIRED" ? 403 : 503;
    return NextResponse.json({ ok: false, error: status === 503 ? "MEMBER_PROFILE_UNAVAILABLE" : code }, { status, headers });
  }
}

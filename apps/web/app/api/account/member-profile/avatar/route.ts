import { NextResponse } from "next/server";
import { readRequestUserSession } from "@/lib/auth/session";
import { hasSameHostMemberProfileOrigin } from "@/lib/commerce/member-profile";
import { parseAvatarRevision } from "@/lib/commerce/member-avatar";
import { readMemberAvatar, removeMemberAvatar, uploadMemberAvatar } from "@/lib/services/member-avatar-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization", "X-Content-Type-Options": "nosniff" };
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "MEMBER_AVATAR_UNAVAILABLE";
  const status = ["MEMBER_AVATAR_NOT_FOUND", "ACCOUNT_NOT_FOUND"].includes(code) ? 404 : ["MEMBER_AVATAR_REVISION_CONFLICT", "MEMBER_PROFILE_PHONE_REQUIRED"].includes(code) ? 409 : code.startsWith("IMAGE_") || code.startsWith("INVALID_MEMBER_AVATAR") ? 400 : 503;
  return NextResponse.json({ ok: false, error: status === 503 ? "MEMBER_AVATAR_UNAVAILABLE" : code }, { status, headers });
}
export async function GET(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401, headers });
  try { const bytes = await readMemberAvatar(session.userId); return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "image/webp", "Content-Length": String(bytes.length) } }); }
  catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401, headers });
  if (!hasSameHostMemberProfileOrigin(request)) return NextResponse.json({ ok: false, error: "INVALID_ORIGIN" }, { status: 403, headers });
  const size = Number(request.headers.get("content-length"));
  if (size > 3 * 1024 * 1024 + 16384) return NextResponse.json({ ok: false, error: "IMAGE_FILE_SIZE_INVALID" }, { status: 413, headers });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file"), revisionText = form?.get("expectedRevision");
  const revision = typeof revisionText === "string" && /^(0|[1-9]\d*)$/.test(revisionText) ? parseAvatarRevision(Number(revisionText)) : null;
  if (!(file instanceof File) || revision === null || [...(form?.keys() ?? [])].some(key => !["file", "expectedRevision"].includes(key))) return NextResponse.json({ ok: false, error: "INVALID_MEMBER_AVATAR" }, { status: 400, headers });
  try { return NextResponse.json({ ok: true, avatar: await uploadMemberAvatar(session.userId, revision, file) }, { headers }); }
  catch (error) { return failure(error); }
}
export async function DELETE(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401, headers });
  if (!hasSameHostMemberProfileOrigin(request)) return NextResponse.json({ ok: false, error: "INVALID_ORIGIN" }, { status: 403, headers });
  const body = await request.json().catch(() => null);
  const revision = parseAvatarRevision(body?.expectedRevision);
  if (revision === null || Object.keys(body).some(key => key !== "expectedRevision")) return NextResponse.json({ ok: false, error: "INVALID_MEMBER_AVATAR" }, { status: 400, headers });
  try { return NextResponse.json({ ok: true, avatar: await removeMemberAvatar(session.userId, revision) }, { headers }); }
  catch (error) { return failure(error); }
}

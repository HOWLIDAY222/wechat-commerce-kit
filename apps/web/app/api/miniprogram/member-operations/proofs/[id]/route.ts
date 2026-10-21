import { NextResponse } from "next/server";
import { readRequestUserSession, readCurrentAdminSession } from "@/lib/auth/session";
import { hasSameHostMemberProfileOrigin } from "@/lib/commerce/member-profile";
import { readSocialProof, deleteSocialProof } from "@/lib/services/member-social-proof-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization", "X-Content-Type-Options": "nosniff" };
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const session = request.headers.has("authorization") ? await readRequestUserSession(request) : await readCurrentAdminSession() ?? await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401, headers });
  try { const bytes = await readSocialProof(session.userId, (await context.params).id); return new Response(new Uint8Array(bytes), { headers: { ...headers, "Content-Type": "image/webp", "Content-Length": String(bytes.length) } }); }
  catch { return NextResponse.json({ ok: false, error: "MEMBER_OPERATIONS_PROOF_NOT_FOUND" }, { status: 404, headers }); }
}
export async function DELETE(request: Request, context: Context) {
  const session = await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401, headers });
  if (!hasSameHostMemberProfileOrigin(request)) return NextResponse.json({ ok: false, error: "INVALID_ORIGIN" }, { status: 403, headers });
  try { return NextResponse.json({ ok: true, ...await deleteSocialProof(session.userId, (await context.params).id) }, { headers }); }
  catch { return NextResponse.json({ ok: false, error: "MEMBER_OPERATIONS_PROOF_NOT_FOUND" }, { status: 404, headers }); }
}

import { NextResponse } from "next/server";
import { readRequestUserSession } from "@/lib/auth/session";
import { hasSameHostMemberProfileOrigin } from "@/lib/commerce/member-profile";
import { uploadSocialProof } from "@/lib/services/member-social-proof-service";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };
export async function POST(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401, headers });
  if (!hasSameHostMemberProfileOrigin(request)) return NextResponse.json({ ok: false, error: "INVALID_ORIGIN" }, { status: 403, headers });
  if (Number(request.headers.get("content-length")) > 3 * 1024 * 1024 + 16384) return NextResponse.json({ ok: false, error: "IMAGE_FILE_SIZE_INVALID" }, { status: 413, headers });
  const form = await request.formData().catch(() => null), file = form?.get("file"), requestId = form?.get("requestId");
  const purpose = form?.get("purpose") ?? "SOCIAL";
  if (!(file instanceof File) || typeof requestId !== "string" || !["SOCIAL", "STUDENT", "ENTERPRISE"].includes(String(purpose)) || [...(form?.keys() ?? [])].some(key => !["file", "requestId", "purpose"].includes(key)) || form?.getAll("file").length !== 1 || form?.getAll("requestId").length !== 1 || (form?.getAll("purpose").length ?? 0) > 1) return NextResponse.json({ ok: false, error: "INVALID_MEMBER_OPERATION" }, { status: 400, headers });
  try { return NextResponse.json({ ok: true, proof: await uploadSocialProof(session.userId, requestId, file, purpose as "SOCIAL" | "STUDENT" | "ENTERPRISE") }, { headers }); }
  catch (error) { const code = error instanceof Error ? error.message : "MEMBER_OPERATIONS_PROOF_UNAVAILABLE"; const safe = /^(?:MEMBER_OPERATIONS_[A-Z_]+|IMAGE_[A-Z_]+|INVALID_MEMBER_OPERATION|MEMBER_CUSTOMER_REQUIRED|MEMBER_PHONE_REQUIRED|MEMBERSHIP_REQUIRED)$/.test(code) ? code : "MEMBER_OPERATIONS_PROOF_UNAVAILABLE"; return NextResponse.json({ ok: false, error: safe }, { status: safe.endsWith("UNAVAILABLE") ? 503 : safe.startsWith("IMAGE_") || safe.startsWith("INVALID_") ? 400 : 409, headers }); }
}

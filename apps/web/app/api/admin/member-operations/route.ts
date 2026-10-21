import { NextResponse } from "next/server";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { hasSameHostMemberProfileOrigin } from "@/lib/commerce/member-profile";
import { memberOperationsAdminInputSchema } from "@/lib/commerce/member-operations";
import { getAdminMemberOperations, reviewMemberOperation, saveMemberOperationsConfig } from "@/lib/services/member-operations-service";

const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie" };
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "MEMBER_OPERATIONS_UNAVAILABLE";
  const safe = /^(?:MEMBER_OPERATIONS_[A-Z_]+|INVALID_MEMBER_OPERATION|INVALID_MEMBER_OPERATIONS_CONFIG|ADMIN_REQUIRED|MEMBER_CUSTOMER_REQUIRED|MEMBER_PHONE_REQUIRED|MEMBERSHIP_REQUIRED)$/.test(code) ? code : "MEMBER_OPERATIONS_UNAVAILABLE";
  const status = safe.startsWith("INVALID_") ? 400 : safe === "ADMIN_REQUIRED" ? 403 : safe === "MEMBER_OPERATIONS_NOT_FOUND" ? 404 : safe === "MEMBER_OPERATIONS_UNAVAILABLE" ? 503 : 409;
  return NextResponse.json({ ok: false, error: safe }, { status, headers });
}
export async function GET(request: Request) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401, headers });
  const query = new URL(request.url).searchParams;
  const page = query.get("page");
  if (page !== null && !/^[1-9]\d{0,5}$/.test(page)) return failure(Error("INVALID_MEMBER_OPERATION"));
  try { return NextResponse.json({ ok: true, ...await getAdminMemberOperations(session.userId, { status: query.get("status") ?? "PENDING", page: page === null ? 1 : Number(page) }) }, { headers }); } catch (error) { return failure(error); }
}
export async function PUT(request: Request) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401, headers });
  if (!hasSameHostMemberProfileOrigin(request)) return NextResponse.json({ ok: false, error: "INVALID_ORIGIN" }, { status: 403, headers });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Object.keys(body).sort().join(",") !== "config,expectedRevision") return NextResponse.json({ ok: false, error: "INVALID_MEMBER_OPERATIONS_CONFIG" }, { status: 400, headers });
  try { return NextResponse.json({ ok: true, ...await saveMemberOperationsConfig(session.userId, body.config, body.expectedRevision) }, { headers }); } catch (error) { return failure(error); }
}
export async function POST(request: Request) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401, headers });
  if (!hasSameHostMemberProfileOrigin(request)) return NextResponse.json({ ok: false, error: "INVALID_ORIGIN" }, { status: 403, headers });
  const parsed = memberOperationsAdminInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_MEMBER_OPERATION" }, { status: 400, headers });
  try { return NextResponse.json({ ok: true, ...await reviewMemberOperation(session.userId, parsed.data) }, { headers }); } catch (error) { return failure(error); }
}

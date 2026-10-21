import { NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { performReshipmentAction } from "@/lib/services/after-sales-service";

const actionSchema = z.object({
  action: z.enum(["ship", "deliver", "mark-returned"]),
  trackingCompany: z.string().min(1).max(80).optional(),
  trackingNo: z.string().min(1).max(120).optional(),
  note: z.string().max(500).optional(),
});
type Props = { params: Promise<{ reshipmentId: string }> };

export async function POST(request: Request, { params }: Props) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_RESHIPMENT_ACTION" }, { status: 400 });
  try {
    const { reshipmentId } = await params;
    return NextResponse.json({ ok: true, reshipment: await performReshipmentAction(reshipmentId, parsed.data, session.userId) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "RESHIPMENT_ACTION_FAILED" }, { status: 400 });
  }
}

export async function PATCH() {
  return NextResponse.json({ ok: false, error: "RESHIPMENT_STATUS_DIRECT_EDIT_FORBIDDEN" }, { status: 405 });
}

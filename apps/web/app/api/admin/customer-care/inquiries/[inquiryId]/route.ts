import { NextResponse } from "next/server";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { updateContactInquiry } from "@/lib/services/customer-care-service";

const schema = z.object({
  status: z.enum(["NEW", "IN_PROGRESS", "RESOLVED"]),
  adminNote: z.string().trim().max(2000).optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ inquiryId: string }> }) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_CONTACT_UPDATE" }, { status: 400 });
  try {
    const inquiry = await updateContactInquiry((await params).inquiryId, parsed.data, session.userId);
    return NextResponse.json({ ok: true, inquiry });
  } catch (error) {
    const code = error instanceof Error ? error.message : "CONTACT_UPDATE_FAILED";
    return NextResponse.json({ ok: false, error: code }, { status: code === "CONTACT_INQUIRY_NOT_FOUND" ? 404 : 400 });
  }
}

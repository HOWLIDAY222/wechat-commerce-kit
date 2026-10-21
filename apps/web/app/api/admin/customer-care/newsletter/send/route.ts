import { NextResponse } from "next/server";
import { z } from "zod";
import { hasAdminCapability } from "@/lib/admin/permission-policy";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { sendNewsletterCampaign } from "@/lib/services/customer-care-service";

const schema = z.object({
  subject: z.string().trim().min(2).max(120),
  body: z.string().trim().min(10).max(6000),
  confirmation: z.literal("SEND_VALSENN_KROVEN_NEWSLETTER"),
});

export async function POST(request: Request) {
  const session = await readCurrentAdminSession();
  if (!session) return NextResponse.json({ ok: false, error: "ADMIN_UNAUTHORIZED" }, { status: 401 });
  if (!hasAdminCapability(session.role, "send_newsletter_campaign")) {
    return NextResponse.json({ ok: false, error: "ADMIN_OWNER_REQUIRED_FOR_NEWSLETTER" }, { status: 403 });
  }
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_NEWSLETTER_CAMPAIGN" }, { status: 400 });
  try {
    const result = await sendNewsletterCampaign(parsed.data, session.userId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "NEWSLETTER_CAMPAIGN_FAILED" }, { status: 400 });
  }
}

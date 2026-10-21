import { NextResponse } from "next/server";
import { z } from "zod";
import { subscribeToNewsletter } from "@/lib/services/customer-care-service";

const newsletterSchema = z.object({
  email: z.string().trim().email().max(160),
});

export async function POST(request: Request) {
  const parsed = newsletterSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_NEWSLETTER_EMAIL" }, { status: 400 });

  const result = await subscribeToNewsletter({
    email: parsed.data.email,
    source: "site-footer",
    ip: getClientIp(request),
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  return NextResponse.json({ ok: true, outcome: result.outcome });
}

function getClientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? undefined;
}

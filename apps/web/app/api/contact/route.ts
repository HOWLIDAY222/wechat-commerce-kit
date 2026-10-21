import { NextResponse } from "next/server";
import { z } from "zod";
import { createContactInquiry } from "@/lib/services/customer-care-service";

const contactSchema = z.object({
  name: z.string().trim().min(1).max(80),
  contact: z.string().trim().min(5).max(120),
  message: z.string().trim().min(5).max(1000),
});

export async function POST(request: Request) {
  const parsed = contactSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_CONTACT_REQUEST" }, { status: 400 });

  const inquiry = await createContactInquiry({
    ...parsed.data,
    ip: getClientIp(request),
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  return NextResponse.json({ ok: true, inquiryId: inquiry.id }, { status: 201 });
}

function getClientIp(request: Request) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-real-ip") ?? undefined;
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { unsubscribeFromNewsletter } from "@/lib/services/customer-care-service";

const unsubscribeSchema = z.object({ token: z.string().trim().min(16).max(200) });

export async function POST(request: Request) {
  const parsed = unsubscribeSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "INVALID_UNSUBSCRIBE_REQUEST" }, { status: 400 });
  try {
    await unsubscribeFromNewsletter(parsed.data.token);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code = error instanceof Error ? error.message : "NEWSLETTER_UNSUBSCRIBE_FAILED";
    return NextResponse.json({ ok: false, error: code }, { status: code === "NEWSLETTER_SUBSCRIPTION_NOT_FOUND" ? 404 : 400 });
  }
}

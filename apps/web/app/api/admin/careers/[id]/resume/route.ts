import { NextResponse } from "next/server";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { readCareerResume } from "@/lib/services/career-application-service";
import { writeAdminAudit } from "@/lib/services/admin-ops-service";
import { z } from "zod";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await readCurrentAdminSession();
  if (!session || session.role !== "owner") return NextResponse.json({ ok: false }, { status: 403 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new Response(null, { status: 404 });
  const resume = await readCareerResume(id);
  if (!resume) return new Response(null, { status: 404 });
  await writeAdminAudit(session.userId, "admin.careers.resume.downloaded", "career_application", id, {});
  return new Response(new Uint8Array(resume), { headers: {
    "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="application-${id}.pdf"`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox",
  } });
}

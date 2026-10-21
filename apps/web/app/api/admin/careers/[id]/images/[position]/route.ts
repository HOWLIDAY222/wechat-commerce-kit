import { NextResponse } from "next/server";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { readCareerImage } from "@/lib/services/career-application-service";
import { writeAdminAudit } from "@/lib/services/admin-ops-service";
import { z } from "zod";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; position: string }> }) {
  const session = await readCurrentAdminSession();
  if (!session || session.role !== "owner") return NextResponse.json({ ok: false }, { status: 403 });
  const { id, position } = await params;
  if (!z.string().uuid().safeParse(id).success || !/^[0-4]$/.test(position)) return new Response(null, { status: 404 });
  const image = await readCareerImage(id, Number(position));
  if (!image) return new Response(null, { status: 404 });
  await writeAdminAudit(session.userId, "admin.careers.image.downloaded", "career_application", id, { position });
  return new Response(new Uint8Array(image.bytes), { headers: {
    "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="application-${id}-${Number(position) + 1}.${image.extension}"`,
    "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox",
  } });
}

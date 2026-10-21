import { NextResponse } from "next/server";
import { appConfig } from "@/lib/config";
import { applicationSchema, checkPortfolio, checkResume, MAX_RESUME_BYTES, MAX_IMAGE_BYTES, MAX_IMAGES } from "@/lib/career-application";
import { checkCareerImage, type CareerImage } from "@/lib/career-image";
import { saveCareerApplication } from "@/lib/services/career-application-service";

export const runtime = "nodejs";
const attempts = new Map<string, { count: number; expires: number }>();
const fail = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(appConfig.APP_BASE_URL).origin) return fail("INVALID_ORIGIN", 403);
  if (!request.headers.get("content-type")?.startsWith("multipart/form-data;")) return fail("INVALID_APPLICATION", 400);
  // Read only the last proxy-appended address, not a client-supplied leading address.
  const ip = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
  const now = Date.now();
  for (const [key, value] of attempts) if (value.expires < now) attempts.delete(key);
  const bucket = attempts.get(ip) ?? { count: 0, expires: now + 60_000 };
  if (bucket.count >= 10 || attempts.size >= 10_000) return fail("RATE_LIMIT", 429);
  bucket.count++; attempts.set(ip, bucket);
  const maxBody = MAX_RESUME_BYTES + MAX_IMAGE_BYTES * MAX_IMAGES + 64 * 1024;
  if (Number(request.headers.get("content-length")) > maxBody) return fail("BODY_TOO_LARGE", 413);
  try {
    if (!request.body) return fail("INVALID_APPLICATION", 400);
    const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > maxBody) { await reader.cancel(); return fail("BODY_TOO_LARGE", 413); }
      chunks.push(value);
    }
    const form = await new Response(new Uint8Array(Buffer.concat(chunks)), { headers: { "Content-Type": request.headers.get("content-type")! } }).formData();
    if (form.get("website")) return fail("INVALID_APPLICATION", 400);
    const parsed = applicationSchema.safeParse(Object.fromEntries(form.entries()));
    if (!parsed.success) return fail("INVALID_APPLICATION", 400);
    const file = form.get("resume"); let resume: Buffer | null = null; let filename: string | null = null;
    if (file instanceof File && file.size) {
      resume = Buffer.from(await file.arrayBuffer()); checkResume(resume, file.name);
      filename = file.name.replace(/[\u0000-\u001f\/\\]/g, "_").slice(0, 180);
    }
    const imageFiles = form.getAll("images").filter((value): value is File => value instanceof File && value.size > 0);
    if (imageFiles.length > MAX_IMAGES) return fail("TOO_MANY_IMAGES", 400);
    const images: CareerImage[] = [];
    for (const image of imageFiles) images.push(await checkCareerImage(Buffer.from(await image.arrayBuffer()), image.name));
    checkPortfolio(parsed.data, Boolean(resume) || images.length > 0);
    const result = await saveCareerApplication(parsed.data, resume, filename, ip, images);
    return NextResponse.json({ ok: true, id: result.id }, { status: result.duplicate ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "RATE_LIMIT") return fail(code, 429);
    if (["INVALID_PDF", "INVALID_IMAGE", "WORK_REQUIRED", "APPLICATION_CONFLICT"].includes(code)) return fail(code, 400);
    // Do not expose application data, filenames, database errors or connection details.
    return fail("APPLICATION_UNAVAILABLE", 503);
  }
}

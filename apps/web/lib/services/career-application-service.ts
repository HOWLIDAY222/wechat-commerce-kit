import { createHash, createHmac } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { appConfig } from "@/lib/config";
import type { CareerApplicationInput } from "@/lib/career-application";
import type { CareerImage } from "@/lib/career-image";

export type ApplicationDetails = Omit<CareerApplicationInput, "id">;
export type ApplicationRow = { id: string; details: ApplicationDetails; resume_name: string | null; status: string; created_at: Date; images: { position: number; filename: string }[] };

export async function saveCareerApplication(input: CareerApplicationInput, resume: Buffer | null, filename: string | null, ip: string, images: CareerImage[] = []) {
  const { id, ...details } = input;
  const hash = createHash("sha256").update(JSON.stringify(details)).update(resume ?? Buffer.alloc(0));
  for (const image of images) hash.update(JSON.stringify([image.filename, image.bytes.length])).update(image.bytes);
  const fingerprint = hash.digest("hex");
  const ipHash = createHmac("sha256", appConfig.SESSION_SECRET).update(ip).digest("hex");
  return prisma.$transaction(async tx => {
    // Keep duplicate detection and both submission limits atomic across workers.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(20260915, 522)`;
    const existing = await tx.$queryRaw<{ fingerprint: string }[]>`SELECT fingerprint FROM career_applications WHERE id=${id}::uuid`;
    if (existing.length) {
      if (existing[0].fingerprint !== fingerprint) throw new Error("APPLICATION_CONFLICT");
      return { id, duplicate: true };
    }
    const counts = await tx.$queryRaw<{ total: number; same_ip: number }[]>`SELECT count(*)::int AS total, count(*) FILTER (WHERE ip_hash=${ipHash})::int AS same_ip FROM career_applications WHERE created_at > NOW() - INTERVAL '1 hour'`;
    if (counts[0].total >= 60 || counts[0].same_ip >= 3) throw new Error("RATE_LIMIT");
    await tx.$executeRaw`INSERT INTO career_applications (id,details,resume,resume_name,ip_hash,fingerprint) VALUES (${id}::uuid,${JSON.stringify(details)}::jsonb,${resume},${filename},${ipHash},${fingerprint})`;
    for (const [position, image] of images.entries()) await tx.$executeRaw`INSERT INTO career_images (application_id,position,filename,extension,bytes) VALUES (${id}::uuid,${position},${image.filename},${image.extension},${image.bytes})`;
    return { id, duplicate: false };
  }, { timeout: 30000 });
}

export async function listCareerApplications(page: number) {
  const offset = (page - 1) * 25;
  const [rows, counts] = await Promise.all([
    prisma.$queryRaw<ApplicationRow[]>`SELECT a.id,a.details,a.resume_name,a.status,a.created_at,COALESCE((SELECT jsonb_agg(jsonb_build_object('position',i.position,'filename',i.filename) ORDER BY i.position) FROM career_images i WHERE i.application_id=a.id),'[]'::jsonb) AS images FROM career_applications a ORDER BY a.created_at DESC,a.id DESC LIMIT 25 OFFSET ${offset}`,
    prisma.$queryRaw<{ total: number; pending: number }[]>`SELECT count(*)::int AS total,count(*) FILTER (WHERE status='NEW')::int AS pending FROM career_applications`,
  ]);
  return { rows, ...counts[0] };
}

export async function readCareerResume(id: string) {
  const rows = await prisma.$queryRaw<{ resume: Buffer | null }[]>`SELECT resume FROM career_applications WHERE id=${id}::uuid`;
  return rows[0]?.resume;
}

export async function markCareerApplication(id: string, status: "NEW" | "REVIEWED") {
  return prisma.$executeRaw`UPDATE career_applications SET status=${status},updated_at=NOW() WHERE id=${id}::uuid`;
}

export async function readCareerImage(id: string, position: number) {
  return (await prisma.$queryRaw<{ bytes: Buffer; extension: string }[]>`SELECT bytes,extension FROM career_images WHERE application_id=${id}::uuid AND position=${position}`)[0];
}

import { authorizeEvidenceRead } from "@/lib/services/evidence-access-service";
import { readUpload } from "@/lib/uploads/read-upload";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return readUpload(path, { root: process.env.UPLOAD_DIR || "public/uploads", authorizeEvidence: segments => authorizeEvidenceRead(request, segments) });
}

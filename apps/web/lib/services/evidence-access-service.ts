import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { readBearerUserSession, readCurrentAdminSession, readCurrentUserSession } from "@/lib/auth/session";

export function mayReadEvidence(session: { userId: string; role: string } | null, ownerId: string | null) {
  return Boolean(session && ownerId && (session.userId === ownerId || session.role === "admin" || session.role === "owner"));
}

export async function authorizeEvidenceRead(request: Request, segments: string[]) {
  const session = request.headers.has("authorization")
    ? await readBearerUserSession(request)
    : await readCurrentAdminSession() || await readCurrentUserSession();
  if (!session || appConfig.COMMERCE_STORAGE !== "prisma") return false;
  const path = `/${appConfig.UPLOAD_PUBLIC_PATH.replace(/^\/+|\/+$/g, "")}/${segments.join("/")}`;
  const image = await prisma.afterSalesImage.findFirst({
    where: { imageUrl: { in: [path, new URL(path, appConfig.APP_BASE_URL).href] } },
    select: { afterSales: { select: { userId: true } } },
  });
  return mayReadEvidence(session, image?.afterSales.userId ?? null);
}

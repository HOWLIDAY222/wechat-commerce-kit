"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { readCurrentAdminSession } from "@/lib/auth/session";
import { markCareerApplication } from "@/lib/services/career-application-service";
import { writeAdminAudit } from "@/lib/services/admin-ops-service";

export async function setReviewStatus(form: FormData) {
  const session = await readCurrentAdminSession();
  if (!session || session.role !== "owner") throw new Error("FORBIDDEN");
  const input = z.object({ id: z.string().uuid(), status: z.enum(["NEW", "REVIEWED"]) }).parse(Object.fromEntries(form.entries()));
  await markCareerApplication(input.id, input.status);
  await writeAdminAudit(session.userId, "admin.careers.review.updated", "career_application", input.id, { status: input.status });
  revalidatePath("/admin/careers");
}

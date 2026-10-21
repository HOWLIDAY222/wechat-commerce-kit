import { z } from "zod";
import { getTalentRole, talentRoleIds } from "@/lib/careers-content";

export const MAX_RESUME_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES = 5;
export const applicationSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(80),
  contact: z.string().trim().min(5).max(120).refine(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || /^\+?[\d ()-]{7,30}$/.test(value)),
  role: z.string().refine(value => talentRoleIds.includes(value)),
  intro: z.string().trim().min(20).max(2000),
  portfolio: z.string().trim().max(1000).refine(value => !value || /^https?:\/\//i.test(value) && URL.canParse(value)),
  availability: z.string().trim().min(1).max(200),
  consent: z.literal("yes"), locale: z.enum(["zh", "en"]),
});
export type CareerApplicationInput = z.infer<typeof applicationSchema>;
export function checkResume(bytes: Uint8Array, filename: string) {
  if (!bytes.length || bytes.length > MAX_RESUME_BYTES || !/\.pdf$/i.test(filename) || Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-" || !Buffer.from(bytes.subarray(Math.max(0, bytes.length - 1024))).toString().includes("%%EOF")) throw new Error("INVALID_PDF");
}
export function checkPortfolio(input: CareerApplicationInput, hasResume: boolean) {
  if (getTalentRole(input.role)?.creative && !input.portfolio && !hasResume) throw new Error("WORK_REQUIRED");
}

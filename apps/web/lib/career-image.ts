import sharp from "sharp";
import { MAX_IMAGE_BYTES } from "@/lib/career-application";

export type CareerImage = { bytes: Buffer; filename: string; extension: string };
export async function checkCareerImage(bytes: Buffer, filename: string): Promise<CareerImage> {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("INVALID_IMAGE");
  try {
    const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    const extensions: Record<string, RegExp> = { jpeg: /\.jpe?g$/i, png: /\.png$/i, webp: /\.webp$/i };
    if (!metadata.format || !extensions[metadata.format]?.test(filename) || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1) throw new Error();
    return { bytes, filename: filename.replace(/[\u0000-\u001f\/\\]/g, "_").slice(0, 180), extension: metadata.format === "jpeg" ? "jpg" : metadata.format };
  } catch { throw new Error("INVALID_IMAGE"); }
}

import { createHash } from "node:crypto";
import sharp from "sharp";

const supportedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

export type NormalizedImage = {
  buffer: Buffer;
  checksum: string;
  extension: ".webp";
  height: number;
  mimeType: "image/webp";
  sizeBytes: number;
  sourceMimeType: string;
  width: number;
};

export async function normalizeUploadedImage(file: File, options: { maxBytes: number; maxDimension?: number; maxPixels?: number }): Promise<NormalizedImage> {
  if (file.size <= 0 || file.size > options.maxBytes) throw new Error("IMAGE_FILE_SIZE_INVALID");
  const source = Buffer.from(await file.arrayBuffer());
  const detectedMimeType = detectImageMimeType(source);
  if (!detectedMimeType || !supportedMimeTypes.has(detectedMimeType)) throw new Error("IMAGE_SIGNATURE_NOT_SUPPORTED");
  if (file.type && file.type !== detectedMimeType) throw new Error("IMAGE_MIME_SIGNATURE_MISMATCH");

  let metadata: { width?: number; height?: number };
  try {
    metadata = await sharp(source, { failOn: "warning", limitInputPixels: options.maxPixels ?? 40_000_000 }).metadata();
  } catch {
    throw new Error("IMAGE_DECODE_FAILED");
  }
  if (!metadata.width || !metadata.height) throw new Error("IMAGE_DIMENSIONS_INVALID");
  if (metadata.width * metadata.height > (options.maxPixels ?? 40_000_000)) throw new Error("IMAGE_PIXEL_LIMIT_EXCEEDED");

  const { data, info } = await sharp(source, { failOn: "warning", limitInputPixels: options.maxPixels ?? 40_000_000 })
    .rotate()
    .resize({ width: options.maxDimension ?? 2400, height: options.maxDimension ?? 2400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 84, effort: 5, smartSubsample: true })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    checksum: createHash("sha256").update(data).digest("hex"),
    extension: ".webp",
    height: info.height,
    mimeType: "image/webp",
    sizeBytes: data.byteLength,
    sourceMimeType: detectedMimeType,
    width: info.width,
  };
}

export function detectImageMimeType(buffer: Buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    const brand = buffer.toString("ascii", 8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
  }
  return null;
}

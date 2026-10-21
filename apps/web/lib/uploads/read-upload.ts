import { readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const types: Record<string, string> = { ".avif": "image/avif", ".gif": "image/gif", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
export async function readUpload(path: string[], options: { root: string; authorizeEvidence: (path: string[]) => Promise<boolean> }) {
  const notFound = () => Response.json({ ok: false, error: "UPLOAD_NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  const segments = path.filter(Boolean);
  if (!segments.length || segments.some(s => s === "." || s === ".." || s.includes("/") || s.includes("\\"))) return notFound();
  const root = resolve(/* turbopackIgnore: true */ options.root);
  const target = resolve(/* turbopackIgnore: true */ root, ...segments);
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || rel.includes(`..${sep}`)) return notFound();
  const contentType = types[target.slice(target.lastIndexOf(".")).toLowerCase()];
  if (!contentType) return notFound();
  const privateImage = segments[0] === "after-sales";
  if (privateImage && !await options.authorizeEvidence(segments)) return notFound();
  try {
    if (!(await stat(/* turbopackIgnore: true */ target)).isFile()) return notFound();
    const file = await readFile(/* turbopackIgnore: true */ target);
    return new Response(file, { headers: { "Content-Type": contentType, "Content-Length": String(file.length),
      "X-Content-Type-Options": "nosniff", "Cache-Control": privateImage ? "private, no-store" : "public, max-age=31536000, immutable",
      ...(privateImage ? { Vary: "Cookie, Authorization" } : {}) } });
  } catch { return notFound(); }
}

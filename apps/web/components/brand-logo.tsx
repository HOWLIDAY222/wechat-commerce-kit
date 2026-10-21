import Image from "next/image";
import { BRAND_NAME } from "@/lib/brand";

type BrandLogoProps = {
  loading?: boolean;
  size?: "header" | "compact" | "hero" | "footer";
  className?: string;
  inverted?: boolean;
  decorative?: boolean;
};

const widths = { header: "clamp(128px, 23vw, 240px)", compact: "180px", hero: "100%", footer: "240px" };

// The supplied artwork is the single source for every displayed brand signature.
export function BrandLogo({ loading = false, size = "header", className = "", inverted = false, decorative = false }: BrandLogoProps) {
  return <span className={`minimal-logo-frame${loading ? " vk-loading-logo" : ""} ${className}`}
    aria-hidden={decorative || loading ? true : undefined}
    style={{ display: "block", width: loading ? "100%" : widths[size], maxWidth: "100%", aspectRatio: "1715 / 225", flexShrink: 0 }}>
    <Image alt={decorative || loading ? "" : BRAND_NAME} src="/assets/optimized/20260915/wordmark.webp"
      width={1715} height={225} unoptimized priority={loading || size === "header" || size === "hero" || size === "compact"}
      style={{ display: "block", width: "100%", height: "auto", filter: inverted ? "invert(1)" : undefined }} />
  </span>;
}

// Brand-prefixed labels use the artwork, even inside an uppercase section label.
export function BrandLabel({ children, inverted = false }: { children: string; inverted?: boolean }) {
  const match = children.match(/^Valsenn\s+Kroven(?:\s+(.*))?$/i);
  if (!match) return <>{children}</>;
  return <span className="flex max-w-full flex-wrap items-center gap-x-4 gap-y-3">
    <BrandLogo size="compact" inverted={inverted} />
    {match[1] ? <span>{match[1]}</span> : null}
  </span>;
}

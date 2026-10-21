import { BrandLogo } from "@/components/brand-logo";

type BrandWordmarkProps = {
  className?: string;
  size?: "header" | "footer" | "loading";
};

export function BrandWordmark({ className = "", size = "header" }: BrandWordmarkProps) {
  return <BrandLogo className={className} loading={size === "loading"} size={size === "footer" ? "footer" : "header"} />;
}

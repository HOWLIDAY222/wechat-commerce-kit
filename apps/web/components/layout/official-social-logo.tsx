import Image from "next/image";

export function OfficialSocialLogo({ label }: { label: string }) {
  const normalizedLabel = label.trim().toLowerCase();

  if (normalizedLabel === "x" || normalizedLabel === "twitter") {
    return <Image alt="" aria-hidden="true" height={20} src="/assets/brand/social/x.svg" unoptimized width={20} />;
  }

  if (normalizedLabel === "小红书" || normalizedLabel === "xiaohongshu" || normalizedLabel === "rednote") {
    return <Image alt="" aria-hidden="true" height={24} src="/assets/brand/social/xiaohongshu.svg" unoptimized width={24} />;
  }

  return <span>{label}</span>;
}

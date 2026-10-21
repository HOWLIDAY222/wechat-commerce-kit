"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export function StorefrontFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const internal = pathname.startsWith("/admin") || pathname.startsWith("/preview");
  return <div className={internal ? undefined : "consumer-site"}>{children}</div>;
}

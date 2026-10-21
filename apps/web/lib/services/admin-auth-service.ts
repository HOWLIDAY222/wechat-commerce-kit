import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { normalizeMainlandPhone } from "@/lib/providers/sms";
import type { SessionRole } from "@/lib/auth/session";

export type AdminAuthTarget = {
  userId: string;
  phone: string;
  role: Extract<SessionRole, "admin" | "owner">;
};

export async function resolveAdminAuthTarget(phone: string): Promise<AdminAuthTarget | null> {
  const normalized = normalizeMainlandPhone(phone);
  if (appConfig.COMMERCE_STORAGE === "prisma") {
    const user = await prisma.user.findUnique({
      where: { phone: normalized },
      select: { id: true, phone: true, role: true, status: true },
    });
    if (!user || user.status !== "ACTIVE") return null;
    if (user.role !== "ADMIN" && user.role !== "OWNER") return null;
    return {
      userId: user.id,
      phone: user.phone ?? normalized,
      role: user.role === "OWNER" ? "owner" : "admin",
    };
  }

  if (!appConfig.ADMIN_PHONE_ALLOWLIST.includes(normalized)) return null;
  return {
    userId: `admin-${normalized}`,
    phone: normalized,
    role: "admin",
  };
}

export function maskPhone(phone: string) {
  return normalizeMainlandPhone(phone).replace(/^(\d{3})\d{4}(\d{4})$/, "$1****$2");
}

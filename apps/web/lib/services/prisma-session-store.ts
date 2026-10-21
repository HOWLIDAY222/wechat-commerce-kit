import { hashToken, type SessionMetadata, type SessionPayload, type SessionRole } from "@/lib/auth/session";
import { prisma } from "@/lib/db/prisma";

function toDbRole(role: SessionRole) {
  if (role === "owner") return "OWNER";
  if (role === "admin") return "ADMIN";
  return "CUSTOMER";
}

function fromDbRole(role: "CUSTOMER" | "ADMIN" | "OWNER"): SessionRole {
  if (role === "OWNER") return "owner";
  if (role === "ADMIN") return "admin";
  return "customer";
}

export async function persistPrismaSession(
  token: string,
  expiresAt: Date,
  payload: Omit<SessionPayload, "expiresAt">,
  metadata: SessionMetadata = {},
) {
  const user = await resolvePrismaSessionUser(payload);

  await prisma.$transaction(async (tx) => {
    await tx.session.upsert({
      where: { tokenHash: hashToken(token) },
      update: {
        userId: user.userId,
        expiresAt,
        ip: metadata.ip,
        userAgent: metadata.userAgent,
      },
      create: {
        userId: user.userId,
        tokenHash: hashToken(token),
        expiresAt,
        ip: metadata.ip,
        userAgent: metadata.userAgent,
      },
    });
  });
}

export async function resolvePrismaSessionUser(
  payload: Omit<SessionPayload, "expiresAt">,
): Promise<Omit<SessionPayload, "expiresAt">> {
  const requestedRole = toDbRole(payload.role);
  const name = payload.phone ? `User ${payload.phone.slice(-4)}` : requestedRole.toLowerCase();

  if (payload.phone) {
    const existing = await prisma.user.findUnique({
      where: { phone: payload.phone },
      select: { id: true, role: true, status: true },
    });

    if (existing) {
      if (existing.status !== "ACTIVE") throw Error("ACCOUNT_DISABLED");
      const updated = await prisma.user.updateMany({
        where: { id: existing.id, status: "ACTIVE" },
        data: {
          lastLoginAt: new Date(),
        },
      });
      if (updated.count !== 1) throw Error("ACCOUNT_DISABLED");
      return {
        ...payload,
        userId: existing.id,
        role: fromDbRole(existing.role),
      };
    }
  }

  const createdOrUpdated = await prisma.user.upsert({
    where: { id: payload.userId },
    update: {
      phone: payload.phone,
      lastLoginAt: new Date(),
    },
    create: {
      id: payload.userId,
      phone: payload.phone,
      name,
      role: requestedRole,
      status: "ACTIVE",
      lastLoginAt: new Date(),
    },
    select: { id: true, role: true, status: true },
  });
  if (createdOrUpdated.status !== "ACTIVE") throw Error("ACCOUNT_DISABLED");

  return {
    ...payload,
    userId: createdOrUpdated.id,
    role: fromDbRole(createdOrUpdated.role),
  };
}

export async function readPrismaSession(token: string): Promise<SessionPayload | null> {
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now() || session.user.status !== "ACTIVE") {
    await prisma.session.delete({ where: { tokenHash } }).catch(() => null);
    return null;
  }

  return {
    userId: session.userId,
    phone: session.user.phone ?? undefined,
    role: fromDbRole(session.user.role),
    expiresAt: session.expiresAt.toISOString(),
  };
}

export async function deletePrismaSession(token: string) {
  if (!token) return;
  await prisma.session.delete({ where: { tokenHash: hashToken(token) } }).catch(() => null);
}

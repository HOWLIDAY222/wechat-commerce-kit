import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  merchantkitPrisma?: PrismaClient;
};

const connectionString =
  process.env.DATABASE_URL ?? "postgresql://merchantkit:merchantkit@127.0.0.1:5432/merchantkit_next?schema=public";

const adapter = new PrismaPg({ connectionString });

export const prisma =
  globalForPrisma.merchantkitPrisma ??
  new PrismaClient({
    adapter,
    transactionOptions: {
      maxWait: 5_000,
      timeout: 30_000,
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.merchantkitPrisma = prisma;
}

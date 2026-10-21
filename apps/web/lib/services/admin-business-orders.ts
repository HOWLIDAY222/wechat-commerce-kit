import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

// Archived tests retain their original rows and audit trail. Never hide an order
// with payment, refund or shipment evidence, even if it was mistakenly archived.
export async function getAdminBusinessOrderFilter(): Promise<Prisma.OrderWhereInput> {
  const events = await prisma.auditLog.findMany({
    where: { targetType: "order", action: { in: ["admin.test_order.archived", "admin.test_order.restored"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { action: true, targetId: true },
  });
  const archived = new Set<string>();
  for (const event of events) {
    if (!event.targetId) continue;
    if (event.action === "admin.test_order.archived") archived.add(event.targetId);
    else archived.delete(event.targetId);
  }
  if (!archived.size) return {};
  return { NOT: {
    id: { in: [...archived] },
    paymentStatus: { in: ["NOT_STARTED", "PENDING", "FAILED", "CANCELLED"] },
    paymentIntents: { none: { status: "PAID" } },
    shipments: { none: {} },
    refunds: { none: {} },
    afterSalesRequests: { none: {} },
  } };
}

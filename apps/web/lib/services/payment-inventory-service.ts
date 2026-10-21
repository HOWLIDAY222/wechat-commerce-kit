import {grantOrderPoints} from "@/lib/services/member-points-service";
import {settleGiftPayment} from "@/lib/services/gift-card-service";
import type { Prisma } from "@prisma/client";

export async function settleOrderInventoryForPayment(
  tx: Prisma.TransactionClient,
  order: { id: string; orderNo: string; userId: string },
) {
  if(await settleGiftPayment(tx,order.id))return;
  await grantOrderPoints(tx, order.id);
  const note = `Paid order ${order.orderNo}`;
  const items = await tx.orderItem.findMany({
    where: { orderId: order.id },
    select: { quantity: true, skuId: true },
  });
  if (!items.length) throw new Error("ORDER_ITEMS_MISSING");

  const grouped=new Map<string,{skuId:string;quantity:number}>();
  for(const item of items){const row=grouped.get(item.skuId)??{skuId:item.skuId,quantity:0};row.quantity+=item.quantity;grouped.set(item.skuId,row);}
  for (const item of grouped.values()) {
    const existing = await tx.inventoryLog.findFirst({
      where: { skuId: item.skuId, action: "DEDUCT", note },
      select: { id: true },
    });
    if (existing) continue;

    const result = await tx.productSku.updateMany({
      where: {
        id: item.skuId,
        stockQuantity: { gte: item.quantity },
        reservedQuantity: { gte: item.quantity },
      },
      data: {
        stockQuantity: { decrement: item.quantity },
        reservedQuantity: { decrement: item.quantity },
      },
    });
    if (result.count !== 1) throw new Error("ORDER_INVENTORY_RESERVATION_INVALID");
    await tx.inventoryLog.create({
      data: {
        skuId: item.skuId,
        action: "DEDUCT",
        quantity: item.quantity,
        note,
        actorId: order.userId,
      },
    });
  }
}

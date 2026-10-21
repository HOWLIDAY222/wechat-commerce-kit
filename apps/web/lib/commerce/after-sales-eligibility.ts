type Line = { id: string; quantity: number; unitPriceCents: number; discountShareCents: number; refundAmountCents: number };
type Previous = { orderItemId: string; quantity: number; afterSales: { status: string; refunds: Array<{ refundStatus: string }> } };

export function calculateAfterSalesLines<T extends Line>(lines: T[], selected: Array<{ orderItemId: string; quantity: number }>, previous: Previous[]) {
  if (!selected.length) throw new Error("AFTER_SALES_ITEMS_REQUIRED");
  if (new Set(selected.map(item => item.orderItemId)).size !== selected.length) throw new Error("DUPLICATE_AFTER_SALES_ITEM");
  return selected.map(item => {
    const line = lines.find(line => line.id === item.orderItemId);
    if (!line) throw new Error("ORDER_ITEM_NOT_FOUND");
    const history = previous.filter(p => p.orderItemId === line.id);
    if (history.some(p => !["CANCELLED", "REJECTED", "COMPLETED", "REFUNDED"].includes(p.afterSales.status))) throw new Error("ORDER_ITEM_AFTER_SALES_CONFLICT");
    const refundedQuantity = history.filter(p => p.afterSales.status === "REFUNDED" || p.afterSales.refunds.some(r => r.refundStatus === "SUCCEEDED")).reduce((sum, p) => sum + p.quantity, 0);
    const remainingQuantity = Math.max(0, line.quantity - refundedQuantity);
    const remainingCents = Math.max(0, line.unitPriceCents * line.quantity - line.discountShareCents - line.refundAmountCents);
    if (!remainingQuantity || !remainingCents) throw new Error("ORDER_ITEM_ALREADY_REFUNDED");
    if (!Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > remainingQuantity) throw new Error("INVALID_AFTER_SALES_QUANTITY");
    const refundAmountCents = item.quantity === remainingQuantity ? remainingCents : Math.floor(remainingCents * item.quantity / remainingQuantity);
    if (!refundAmountCents) throw new Error("ORDER_ITEM_ALREADY_REFUNDED");
    return { orderItem: line, quantity: item.quantity, refundAmountCents };
  });
}

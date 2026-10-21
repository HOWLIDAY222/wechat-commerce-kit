import { createHash } from 'node:crypto';
import { z } from 'zod';

export const directPurchaseSelectionSchema = z.object({
  productSlug:z.string().trim().min(1).max(160),
  style:z.string().regex(/^[a-z][a-z0-9-]{0,30}$/).optional(),
  color:z.string().trim().min(1).max(32),size:z.string().trim().min(1).max(32),
  quantity:z.number().int().min(1).max(99),
}).strict();
export type DirectPurchaseSelection = z.infer<typeof directPurchaseSelectionSchema>;

export function directOrderReceipt(userId:string, selection:DirectPurchaseSelection, addressId:string, requestId:string, expectedPayableCents:number) {
  if(!z.uuid().safeParse(requestId).success || !addressId || !Number.isSafeInteger(expectedPayableCents) || expectedPayableCents<1)throw Error('INVALID_DIRECT_SELECTION');
  const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
  return {id:'direct-order-'+hash(userId+':'+requestId),hash:hash(JSON.stringify({selection:{productSlug:selection.productSlug,style:selection.style||'',color:selection.color,size:selection.size,quantity:selection.quantity},addressId,expectedPayableCents}))};
}

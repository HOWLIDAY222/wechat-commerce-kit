type OrderState = { status: string; paymentStatus: string; fulfillmentStatus: string; pickup?: {status:string;blocked?:boolean} | null };
export function needsPaymentReview(order: OrderState) {
  return !['CANCELLED','CLOSED'].includes(order.status.toUpperCase()) && !['PAID','REFUNDED'].includes(order.paymentStatus.toUpperCase());
}
export function fulfillmentActions(order: OrderState) {
  const status=order.status.toUpperCase(), payment=order.paymentStatus.toUpperCase(), fulfillment=order.fulfillmentStatus.toUpperCase();
  if (payment==='REFUNDED') return { ship:false, deliver:false, correct:false, reason:['PENDING','PROCESSING','UNFULFILLED'].includes(fulfillment)?'已退款，未发货':'' };
  if (['CANCELLED','CLOSED'].includes(status)) return { ship:false, deliver:false, correct:false, reason:'订单已关闭，无需履约' };
  if (payment!=='PAID') return { ship:false, deliver:false, correct:false, reason:'等待付款，暂不可发货' };
  if (order.pickup) return {ship:false,deliver:false,correct:false,reason:order.pickup.status==='COLLECTED'?'已取货':order.pickup.blocked?'自提暂停':order.pickup.status==='READY'?'待自提':'自提待备货'};
  if (status!=='CONFIRMED') return { ship:false, deliver:false, correct:false, reason:'请先确认订单，再安排发货' };
  return { ship:['PENDING','PROCESSING','UNFULFILLED'].includes(fulfillment), deliver:fulfillment==='SHIPPED', correct:fulfillment==='SHIPPED', reason:'' };
}
export function availableSkuStock(sku: {status:string;stockQuantity:number;reservedQuantity:number}) {
 return sku.status==='ACTIVE'?Math.max(0,sku.stockQuantity-sku.reservedQuantity):0;
}
export function inventoryAfter(stock:number,reserved:number,action:string,quantity:number) {
 if(!Number.isSafeInteger(quantity)||quantity<0||(action!=='ADJUST'&&quantity===0)||!['ADJUST','RESTOCK','DAMAGE'].includes(action)) throw Error('INVALID_INVENTORY_QUANTITY');
 const after=action==='ADJUST'?quantity:stock+(action==='RESTOCK'?quantity:-quantity);
 if(!Number.isSafeInteger(after)||after<reserved) throw Error('INVENTORY_BELOW_RESERVED');
 return after;
}

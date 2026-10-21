export function normalizePickupAvailability(value) {
  if (typeof value?.enabled !== 'boolean' || typeof value?.eligible !== 'boolean') throw Error('INVALID_PICKUP_RESPONSE');
  const point = value.point;
  if (value.eligible && (!value.enabled || !point || !['name','address'].every(key=>typeof point[key] === 'string' && point[key].trim()) || !['hours','phone'].every(key=>typeof point[key] === 'string') || !/^[a-f0-9]{64}$/.test(point.version))) throw Error('INVALID_PICKUP_RESPONSE');
  return {enabled:value.enabled,eligible:value.eligible,reason:String(value.reason||''),point:value.eligible?{name:point.name,address:point.address,hours:point.hours,phone:point.phone,detailsPending:point.detailsPending===true,version:point.version}:null};
}
export function pickupUnavailableLabel(pickup, address) {
  if (!address) return '请选择收货地址后查看自提服务';
  if (pickup?.reason === 'PICKUP_AREA_UNAVAILABLE') return '当前区域无法使用自提服务';
  if (pickup?.reason === 'PICKUP_LOAD_FAILED') return '自提信息暂未加载，请重试';
  return '线下自提暂未开放';
}
export function pickupOrderPresentation(order) {
  const pickup = order?.pickup;
  if (!pickup || !['WAITING','READY','COLLECTED'].includes(pickup.status)) return null;
  const paid = order.paymentStatus === 'PAID' && order.status === 'CONFIRMED';
  const blocked = !!pickup.blocked || !paid;
  const collected = pickup.status === 'COLLECTED';
  const ready = pickup.status === 'READY' && !blocked;
  return {...pickup,code:ready && /^\d{8}$/.test(pickup.code)?pickup.code:'',codeLabel:ready && /^\d{8}$/.test(pickup.code)?pickup.code.slice(0,4)+' '+pickup.code.slice(4):'',title:collected?'已取货':order.paymentStatus==='REFUNDED'?'自提已取消':!paid?'等待付款':blocked?'自提暂停':ready?'待自提':'待备货',copy:collected?'本次自提已完成。':!paid?'付款后安排备货。':blocked?'请先处理订单中的售后事项。':ready?pickup.detailsPending?'取货地点公布后，出示取货码领取。':'到店出示取货码，核销后领取商品。':'备好后可在这里查看取货码。',showCode:ready && /^\d{8}$/.test(pickup.code),showProgress:paid&&!blocked,steps:[{key:'paid',label:'已付款',complete:paid,current:false},{key:'ready',label:'待自提',complete:ready||collected,current:ready},{key:'collected',label:'已取货',complete:collected,current:collected,last:true}]};
}

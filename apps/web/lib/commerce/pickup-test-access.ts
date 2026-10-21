export function presentPickupPoint<T extends { name: string; address: string; hours: string; phone: string }>(point: T) {
  return { ...point, name: point.name.trim() || 'MerchantKit 自提点', address: point.address.trim() || '自提地点待公布', detailsPending: !point.address.trim() };
}

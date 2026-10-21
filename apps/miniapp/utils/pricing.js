// Prices and shared stock are validated again by the server.
export function selectedStyle(product,key){const styles=product.quantityPricing?.styles||[];if(!styles.length){if(key)throw Error('PRODUCT_STYLE_UNAVAILABLE');return null;}const style=key?styles.find(s=>s.key===key):styles[0];if(!style)throw Error('PRODUCT_STYLE_UNAVAILABLE');return style;}
export function unitForStyle(product,key,base){return selectedStyle(product,key)?.unitPriceCents??base??product.minPriceCents;}
export function totalForQuantity(product,quantity,unitPriceCents,styleKey){const q=Number(quantity);if(!Number.isInteger(q)||q<0)throw Error('INVALID_QUANTITY');const style=selectedStyle(product,styleKey);const unit=style?.unitPriceCents??(Number.isSafeInteger(unitPriceCents)?unitPriceCents:product.minPriceCents);if(!Number.isSafeInteger(unit)||unit<0)throw Error('INVALID_PRICE');const tier=(style?.tiers??product.quantityPricing?.tiers)?.find(t=>t.quantity===q);if(!product.quantityPricing?.repeatBundles)return tier&&Number.isSafeInteger(tier.totalPriceCents)?tier.totalPriceCents:unit*q;
 if(q>99)throw Error('INVALID_QUANTITY');
 const costs=Array(q+1).fill(Infinity);costs[0]=0;
 for(let count=1;count<=q;count++){costs[count]=costs[count-1]+unit;for(const t of (style?.tiers??product.quantityPricing?.tiers??[]))if(Number.isInteger(t.quantity)&&t.quantity>=2&&t.quantity<=count&&Number.isSafeInteger(t.totalPriceCents)&&t.totalPriceCents>0)costs[count]=Math.min(costs[count],costs[count-t.quantity]+t.totalPriceCents);}
 return costs[q];}
export function maxQuantity(product){return Math.max(1,Math.min(99,Number(product.quantityPricing?.maxQuantity)||99));}

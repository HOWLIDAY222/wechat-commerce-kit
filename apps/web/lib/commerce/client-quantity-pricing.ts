import type {QuantityPricing} from './quantity-pricing';
// Released older mini-programs calculate only exact tiers in their visitor bag.
// Keep their selection range safe until the updated client is published.
export function quantityPricingForClient(pricing:QuantityPricing|null,channel:string|null,capability:string|null){
 if(pricing?.repeatBundles&&channel==='wechat-miniprogram'&&capability!=='repeat-bundles-v1')return {...pricing,repeatBundles:false,maxQuantity:Math.max(1,...pricing.tiers.map(t=>t.quantity),...(pricing.styles??[]).flatMap(s=>s.tiers.map(t=>t.quantity)))};
 return pricing;
}

import type { QuantityPricing } from './quantity-pricing';
export const X1_AIR_WHITE_UNIT_PRICE_CENTS=4900;
export const X1_AIR_WHITE_QUANTITY_PRICING={maxQuantity:99,repeatBundles:true,tiers:[{quantity:2,totalPriceCents:8900},{quantity:3,totalPriceCents:12900},{quantity:4,totalPriceCents:16900}],styles:[
 {key:'regular',label:'常规款',summary:'基础裆部面料，透汗透气。',unitPriceCents:4900,tiers:[{quantity:2,totalPriceCents:8900},{quantity:3,totalPriceCents:12900},{quantity:4,totalPriceCents:16900}]},
 {key:'upgraded',label:'升级款',summary:'裆部升级为莫代尔与新疆棉面料，透汗透气。',unitPriceCents:6900,tiers:[{quantity:2,totalPriceCents:12900},{quantity:3,totalPriceCents:18900},{quantity:4,totalPriceCents:24900}]}
]} satisfies QuantityPricing;

import { z } from "zod";

const tierSchema = z.object({quantity:z.number().int().min(2).max(20),totalPriceCents:z.number().int().positive()}).strict();
const styleSchema = z.object({key:z.string().regex(/^[a-z][a-z0-9-]{0,30}$/),label:z.string().min(1).max(40),summary:z.string().max(200),unitPriceCents:z.number().int().positive(),tiers:z.array(tierSchema).max(19)}).strict();
const quantityPricingSchema = z.object({
  styles:z.array(styleSchema).min(1).max(6).optional(),
  compareAtUnitPriceCents: z.number().int().positive().optional(),
  maxQuantity: z.number().int().min(1).max(99),
  repeatBundles: z.boolean().optional(),
  tiers: z.array(z.object({
    quantity: z.number().int().min(2).max(20),
    totalPriceCents: z.number().int().positive(),
  }).strict()).max(19),
}).strict();

export type QuantityPricing = z.infer<typeof quantityPricingSchema>;

type PricingItem = {
  id: string;
  productId: string;
  style?: string;
  quantity: number;
  unitPriceCents: number;
  product: { quantityPricing?: unknown };
};

export type CartPricing = {
  discountCents: number;
  itemDiscountShares: Record<string, number>;
  payableAmountCents: number;
  subtotalCents: number;
};

export function getQuantityPriceOptions(unitPriceCents: number, pricing: QuantityPricing | null) {
  if (!pricing) return [];
  return [...pricing.tiers].sort((a,b)=>a.quantity-b.quantity).map(tier=>({quantity:tier.quantity,totalPriceCents:quantityTotal(unitPriceCents,tier.quantity,pricing)}));
}

// Opt-in keeps historical schemes' exact-tier behavior. Repeated bundles use
// dynamic programming so custom tier prices produce the cheapest exact quantity.
export function quantityTotal(unitPriceCents:number,quantity:number,pricing:QuantityPricing|null,styleKey?:string) {
  if(!Number.isSafeInteger(quantity)||quantity<0||quantity>99)throw Error('INVALID_QUANTITY');
  const style=resolveProductStyle(pricing,styleKey),unit=style?.unitPriceCents??unitPriceCents;
  if(!Number.isSafeInteger(unit)||unit<0)throw Error('INVALID_PRICE');
  const tiers=style?.tiers??pricing?.tiers??[];
  if(!pricing?.repeatBundles)return tiers.find(t=>t.quantity===quantity)?.totalPriceCents??unit*quantity;
  const costs=Array<number>(quantity+1).fill(Infinity);costs[0]=0;
  for(let q=1;q<=quantity;q++){
    costs[q]=costs[q-1]+unit;
    for(const tier of tiers)if(tier.quantity<=q)costs[q]=Math.min(costs[q],costs[q-tier.quantity]+tier.totalPriceCents);
  }
  return costs[quantity];
}

export function parseQuantityPricing(value: unknown): QuantityPricing | null {
  if (value === null || value === undefined) return null;
  const parsed = quantityPricingSchema.safeParse(value);
  if (!parsed.success) throw new Error("INVALID_QUANTITY_PRICING");

  const quantities = new Set<number>();
  for (const tier of parsed.data.tiers) {
    if (tier.quantity > parsed.data.maxQuantity || quantities.has(tier.quantity)) {
      throw new Error("INVALID_QUANTITY_PRICING");
    }
    quantities.add(tier.quantity);
  }
  const keys = new Set<string>();
  for(const style of parsed.data.styles??[]){
    if(keys.has(style.key))throw Error("INVALID_QUANTITY_PRICING");keys.add(style.key);
    const seen=new Set<number>();
    for(const tier of style.tiers){if(tier.quantity>parsed.data.maxQuantity||seen.has(tier.quantity)||tier.totalPriceCents>style.unitPriceCents*tier.quantity)throw Error("INVALID_QUANTITY_PRICING");seen.add(tier.quantity);}
  }
  if(parsed.data.styles?.length && JSON.stringify(parsed.data.tiers)!==JSON.stringify(parsed.data.styles[0].tiers))throw Error("INVALID_QUANTITY_PRICING");
  return parsed.data;
}

export function calculateCartPricing(items: PricingItem[]): CartPricing {
  const subtotalCents = items.reduce((total, item) => total + item.unitPriceCents * item.quantity, 0);
  const itemDiscountShares: Record<string, number> = Object.fromEntries(items.map((item) => [item.id, 0]));
  const groups = new Map<string, PricingItem[]>();

  for (const item of items) {
    const style=resolveProductStyle(item.product.quantityPricing,item.style);
    const key=JSON.stringify([item.productId,style?.key??'']);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  let discountCents = 0;
  for (const group of groups.values()) {
    const pricing = parseQuantityPricing(group[0]?.product.quantityPricing);
    if (!pricing) continue;

    const quantity = group.reduce((total, item) => total + item.quantity, 0);
    if (quantity > pricing.maxQuantity) throw new Error("PRODUCT_QUANTITY_LIMIT_EXCEEDED");

    const style=resolveProductStyle(pricing,group[0].style);
    const tier = (style?.tiers??pricing.tiers).find((candidate) => candidate.quantity === quantity);
    if (!tier && !pricing.repeatBundles) continue;

    const groupSubtotalCents = group.reduce((total, item) => total + item.unitPriceCents * item.quantity, 0);
    if(pricing.repeatBundles && group.some(item=>item.unitPriceCents!==group[0].unitPriceCents))throw Error('INVALID_QUANTITY_PRICING');
    const total=quantityTotal(group[0].unitPriceCents,quantity,pricing,style?.key);
    if (total > groupSubtotalCents) throw new Error("INVALID_QUANTITY_PRICING");
    const groupDiscountCents = groupSubtotalCents - total;
    discountCents += groupDiscountCents;

    allocateDiscount(group, groupSubtotalCents, groupDiscountCents, itemDiscountShares);
  }

  return {
    discountCents,
    itemDiscountShares,
    payableAmountCents: subtotalCents - discountCents,
    subtotalCents,
  };
}

function allocateDiscount(
  items: PricingItem[],
  subtotalCents: number,
  discountCents: number,
  shares: Record<string, number>,
) {
  if (discountCents <= 0) return;
  const ordered = [...items].sort((left, right) => left.id.localeCompare(right.id));
  let allocated = 0;

  ordered.forEach((item, index) => {
    const grossCents = item.unitPriceCents * item.quantity;
    const share = index === ordered.length - 1
      ? discountCents - allocated
      : Math.floor((discountCents * grossCents) / subtotalCents);
    if (share < 0 || share > grossCents) throw new Error("INVALID_QUANTITY_PRICING");
    shares[item.id] = share;
    allocated += share;
  });
}

export function assertQuantityPricingFitsSkus(value: unknown, skus: Array<{status?:string;priceCents:number}>) {
 const pricing=parseQuantityPricing(value);if(!pricing)return;
 const active=skus.filter(s=>s.status==='ACTIVE');if(!active.length)return;
 const minimum=Math.min(...active.map(s=>s.priceCents));
 if(pricing.repeatBundles&&active.some(s=>s.priceCents!==minimum))throw Error('STYLE_BASE_PRICE_MISMATCH');
 if(pricing.styles?.length && active.some(s=>s.priceCents!==pricing.styles![0].unitPriceCents))throw Error('STYLE_BASE_PRICE_MISMATCH');
 if(pricing.tiers.some(t=>t.totalPriceCents>minimum*t.quantity))throw Error('QUANTITY_PRICING_EXCEEDS_UNIT_PRICE');
}

// Missing style is the first/default style for older clients and historical carts.
export function resolveProductStyle(value:unknown,key?:string|null){
 const pricing=parseQuantityPricing(value),styles=pricing?.styles;
 if(!styles?.length){if(key)throw Error('PRODUCT_STYLE_UNAVAILABLE');return null;}
 const style=key?styles.find(s=>s.key===key):styles[0];
 if(!style)throw Error('PRODUCT_STYLE_UNAVAILABLE');return style;
}
export function productStylePrice(value:unknown,key:string|undefined|null,base:number){return resolveProductStyle(value,key)?.unitPriceCents??base;}
export function productStyleName(name:string,value:unknown,key?:string|null){const style=resolveProductStyle(value,key);return style?name+' · '+style.label:name;}

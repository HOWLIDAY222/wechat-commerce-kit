import { resolveProductImage } from '../utils/url';
import { formatMoney } from '../utils/money';

export function normalizeCart(cart) {
  const items = Array.isArray(cart?.items)
    ? cart.items.map((item) => ({
      ...item,
      lineTotal: formatMoney(item.unitPriceCents * item.quantity),
      productImage: resolveProductImage(item.productImage,256),
      unitPrice: formatMoney(item.unitPriceCents),
    }))
    : [];
  return {
    ...cart,
    items:quantityLimits(items),
    itemCount: Number(cart?.itemCount || 0),
    payableAmount: formatMoney(Number(cart?.payableAmountCents || 0)),
    subtotal: formatMoney(Number(cart?.payableAmountCents ?? cart?.subtotalCents ?? 0)),
  };
}

export function quantityLimits(items){return items.map(item=>{const sameStyle=items.filter(i=>i.productSlug===item.productSlug&&(i.style||'regular')===(item.style||'regular')&&i.id!==item.id).reduce((n,i)=>n+i.quantity,0);const sameSize=items.filter(i=>i.productSlug===item.productSlug&&i.color===item.color&&i.size===item.size&&i.id!==item.id).reduce((n,i)=>n+i.quantity,0);return {...item,quantityLimit:Math.max(0,Math.min(99,(item.maxProductQuantity??99)-sameStyle,(item.availableQuantity??99)-sameSize))};});}

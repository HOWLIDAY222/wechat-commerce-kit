import { formatMoney } from './money';
import { totalForQuantity, maxQuantity, selectedStyle,unitForStyle } from './pricing';
import { packImage } from './pack-media';

export function selectionState(product, size, color, requestedQuantity,styleKey) {
  const style=selectedStyle(product,styleKey);
  const variant=product.variants.find(v=>v.size===size && v.color===color);
  const limit=Math.min(maxQuantity(product),variant?.availableQuantity || 0);
  const requested=Number(requestedQuantity);
  const quantity=Math.max(1,Math.min(limit || 1,Number.isSafeInteger(requested)?requested:1));
  const unit=unitForStyle(product,styleKey,variant?.priceCents);
  const total=totalForQuantity(product,quantity,unit,styleKey);
  const saving=Math.max(0,unit*quantity-total);
  return {
    variant:variant || null,quantity,quantityLimit:limit,selectionImage:packImage(product,quantity),
    quantityHint:product.quantityPricing?.repeatBundles?'两条起享组合价，超过四条自动拆分最省组合。':'按所选数量计算总价。',
    selectedStyle:style?.key||'',selectedStyleLabel:style?.label||'',styleSummary:style?.summary||'',stylePriceLabel:formatMoney(unit),
    styles:(product.quantityPricing?.styles||[]).map(s=>({...s,selected:s.key===style?.key,priceLabel:formatMoney(s.unitPriceCents)})),
    sizes:product.sizes.map(value=>({size:value,selected:value===size,disabled:!product.variants.some(v=>v.size===value && v.color===color && !v.soldOut)})),
    packs:(product.quantityPricing?.repeatBundles?[1,...(style?.tiers??product.quantityPricing?.tiers??[]).map(t=>t.quantity)].sort((a,b)=>a-b):Array.from({length:Math.min(20,maxQuantity(product))},(_,i)=>i+1)).map(count=>{
      const price=totalForQuantity(product,count,unit,styleKey),saved=Math.max(0,unit*count-price);
      return {quantity:count,label:count+'条 '+formatMoney(price),priceLabel:formatMoney(price),unitLabel:'每条 '+formatMoney(Math.round(price/count)),savingLabel:saved?'比单买省 '+formatMoney(saved):'单条选购',selected:quantity===count,disabled:count>limit};
    }),
    totalLabel:formatMoney(total),unitLabel:'每条 '+formatMoney(Math.round(total/quantity)),
    savingLabel:saving?'比单条选购省 '+formatMoney(saving):'',
    selectionLabel:(style?style.label+' / ':'')+color+' / '+size+' / '+quantity+' 条',
  };
}

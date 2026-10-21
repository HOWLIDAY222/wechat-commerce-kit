import { fetchProducts } from './catalog';
import {quantityLimits} from '../models/cart';
import { formatMoney } from '../utils/money';
import { totalForQuantity, maxQuantity,selectedStyle,unitForStyle } from '../utils/pricing';
const KEY='merchantkit.guest-bag.v1';
export function readGuestItems(){const v=wx.getStorageSync(KEY);return Array.isArray(v)?v.filter(i=>i&&typeof i.productSlug==='string'&&typeof i.color==='string'&&typeof i.size==='string'&&Number.isInteger(i.quantity)&&i.quantity>0&&i.quantity<=99).slice(0,50):[];}
function save(items){wx.setStorageSync(KEY,items); updateBagBadge(items.reduce((n,i)=>n+i.quantity,0));}
export function updateBagBadge(count){if(count)wx.setTabBarBadge({index:2,text:String(count),fail:()=>{}});else wx.removeTabBarBadge({index:2,fail:()=>{}});}
export function clearGuestItems(){wx.removeStorageSync(KEY);updateBagBadge(0);}
function idFor(i){return [i.productSlug,i.color,i.size,...(i.style&&i.style!=='regular'?[i.style]:[])].map(encodeURIComponent).join('|');}
export async function writeGuestItem(input, replaceId){
 if(wx.getStorageSync('merchantkit.guest-import.v1'))throw new Error('CART_SYNC_PENDING');
 const products=await fetchProducts({force:true});const p=products.find(x=>x.slug===input.productSlug);
 const v=p?.variants.find(x=>x.color===input.color&&x.size===input.size);
 if(!p?.isPurchasable||!v)throw new Error('PRODUCT_NOT_PURCHASABLE');
 const style=selectedStyle(p,input.style)?.key||'';input={...input,style};
 const items=readGuestItems();const id=idFor(input);const source=replaceId?items.filter(i=>i.id!==replaceId):items;
 const existing=source.find(i=>i.id===id);const quantity=Number(input.quantity)+(existing?.quantity||0);
 if(!Number.isInteger(quantity)||quantity<1||quantity+source.filter(i=>i.id!==id&&i.productSlug===p.slug&&i.color===v.color&&i.size===v.size).reduce((n,i)=>n+i.quantity,0)>v.availableQuantity)throw new Error('INSUFFICIENT_INVENTORY');
 const total=source.filter(i=>i.productSlug===p.slug&&(i.style||'regular')===(style||'regular')&&i.id!==id).reduce((n,i)=>n+i.quantity,0)+quantity;
 if(total>maxQuantity(p))throw new Error('QUANTITY_LIMIT_EXCEEDED');
 save([...source.filter(i=>i.id!==id),{id,productSlug:p.slug,color:v.color,size:v.size,style,quantity}]);return fetchGuestCart(products);
}
export async function updateGuestQuantity(id,quantity){
 if(wx.getStorageSync('merchantkit.guest-import.v1'))throw new Error('CART_SYNC_PENDING');
 const items=readGuestItems();const item=items.find(i=>i.id===id);if(!item)throw new Error('CART_ITEM_NOT_FOUND');
 if(!Number.isInteger(quantity)||quantity<0)throw new Error('INVALID_QUANTITY');
 if(quantity===0){save(items.filter(i=>i.id!==id));return fetchGuestCart();}
 return writeGuestItem({...item,quantity},id);
}
export async function fetchGuestCart(catalog){
 const stored=readGuestItems();
 if(!stored.length){updateBagBadge(0);return {items:[],itemCount:0,subtotalCents:0,subtotal:formatMoney(0),hasUnavailable:false,guest:true};}
 const products=catalog||await fetchProducts({force:true});let subtotalCents=0;let hasUnavailable=false;
 const items=stored.map(i=>{const p=products.find(x=>x.slug===i.productSlug);const v=p?.variants.find(x=>x.color===i.color&&x.size===i.size);
 const groupQty=stored.filter(x=>x.productSlug===i.productSlug&&(x.style||'regular')===(i.style||'regular')).reduce((n,x)=>n+x.quantity,0);
 let style=null;try{style=p?selectedStyle(p,i.style):null;}catch{}
 const styleValid=!i.style||!!style;const sharedQuantity=stored.filter(x=>x.productSlug===i.productSlug&&x.color===i.color&&x.size===i.size).reduce((n,x)=>n+x.quantity,0);
 const available=!!(styleValid&&p?.isPurchasable&&v&&v.availableQuantity>=sharedQuantity&&groupQty<=maxQuantity(p)); if(!available)hasUnavailable=true;
 return {...i,maxProductQuantity:p?maxQuantity(p):99,availableQuantity:v?.availableQuantity||0,styleLabel:style?.label||'',productName:p?.name? p.name+(style?' · '+style.label:''):'商品已下架',productImage:p?.bagImage||p?.cardImage||p?.image||'',productCode:p?.code||'',unitPrice:available?formatMoney(unitForStyle(p,i.style,v.priceCents)):'',available};});
 for(const p of products){
 const keys=[...new Set(stored.filter(i=>i.productSlug===p.slug).map(i=>i.style||p.quantityPricing?.styles?.[0]?.key||''))];
 for(const style of keys){const selected=stored.filter(i=>i.productSlug===p.slug&&(i.style||p.quantityPricing?.styles?.[0]?.key||'')===style);const q=selected.reduce((n,i)=>n+i.quantity,0);
 try{const prices=selected.map(i=>unitForStyle(p,style,p.variants.find(v=>v.color===i.color&&v.size===i.size)?.priceCents));if(prices.every(x=>Number.isSafeInteger(x)))subtotalCents+=prices.every(x=>x===prices[0])?totalForQuantity(p,q,prices[0],style):selected.reduce((n,i,k)=>n+prices[k]*i.quantity,0);}catch{hasUnavailable=true;}
 }}
 const itemCount=stored.reduce((n,i)=>n+i.quantity,0);updateBagBadge(itemCount);
 return {items:quantityLimits(items),itemCount,subtotalCents,subtotal:formatMoney(subtotalCents),hasUnavailable,guest:true};
}

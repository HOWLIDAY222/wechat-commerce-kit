import type { PickupChoice } from '@/lib/commerce/offline-pickup';
import { requirePickupPoint } from '@/lib/services/offline-pickup-service';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { appConfig } from '@/lib/config';
import { directPurchaseSelectionSchema, type DirectPurchaseSelection } from '@/lib/commerce/direct-checkout';
import { assertProductPurchasable, getCommerceMode } from '@/lib/commerce/release-control';
import { isSupportedProductSpecification } from '@/lib/commerce/x1-specifications';
import { productStyleName, productStylePrice, resolveProductStyle } from '@/lib/commerce/product-style';
import { calculateCartPricing } from '@/lib/commerce/quantity-pricing';
import { getX1AirWhiteOfferImage } from '@/lib/commerce/x1-air-white-offers';
import { getShippingRateConfig } from '@/lib/commerce/shipping';
import { calculateShippingQuote } from '@/lib/commerce/shipping-rates';
import { getMemberPricing } from '@/lib/services/membership-service';

export async function resolveDirectPurchaseItem(tx:Prisma.TransactionClient, input:DirectPurchaseSelection) {
  const parsed=directPurchaseSelectionSchema.safeParse(input);
  if(!parsed.success)throw Error('INVALID_DIRECT_SELECTION');
  const selection=parsed.data;
  const sku=await tx.productSku.findFirst({where:{status:'ACTIVE',color:selection.color,size:selection.size,product:{slug:selection.productSlug,status:'ACTIVE'}},include:{product:true}});
  if(!sku||!isSupportedProductSpecification(sku.product.slug,sku.color,sku.size))throw Error('SKU_NOT_FOUND');
  const style=resolveProductStyle(sku.product.quantityPricing,selection.style)?.key||'';
  return {id:'direct-selection',skuId:sku.id,sku,style,quantity:selection.quantity,unitPriceCents:productStylePrice(sku.product.quantityPricing,style,sku.priceCents)};
}

/** Quotes only the selected line, without adding, importing or clearing bag items. */
export async function getDirectCheckoutForUser(userId:string, selection:DirectPurchaseSelection, addressId?:string, delivery:PickupChoice = {}) {
  if(appConfig.COMMERCE_STORAGE!=='prisma')throw Error('ORDER_QUOTE_REQUIRES_PRISMA');
  const item=await resolveDirectPurchaseItem(prisma,selection);
  assertProductPurchasable(item.sku.product,await getCommerceMode());
  if(item.sku.stockQuantity-item.sku.reservedQuantity<item.quantity)throw Error('INSUFFICIENT_INVENTORY');
  const pricingItem={id:item.id,productId:item.sku.productId,product:item.sku.product,style:item.style,quantity:item.quantity,unitPriceCents:item.unitPriceCents};
  const base=calculateCartPricing([pricingItem]);
  const product=item.sku.product;
  const cart={items:[{id:item.id,productSlug:product.slug,productCode:product.code,productName:productStyleName(product.name,product.quantityPricing,item.style),productImage:(product.slug==='x1-air-white'?getX1AirWhiteOfferImage(item.sku.color,item.quantity):null)||product.image||'',style:item.style,styleLabel:resolveProductStyle(product.quantityPricing,item.style)?.label||'',color:item.sku.color,size:item.sku.size,quantity:item.quantity,unitPriceCents:item.unitPriceCents,available:true,availableQuantity:item.sku.stockQuantity-item.sku.reservedQuantity}],itemCount:item.quantity,subtotalCents:base.subtotalCents,payableAmountCents:base.payableAmountCents,hasUnavailable:false};
  if(!addressId)return {cart,quote:null};
  const address=await prisma.address.findFirst({where:{id:addressId,userId}});
  if(!address)throw Error('ADDRESS_NOT_FOUND');
  const shippingConfig=await getShippingRateConfig();
  if(!shippingConfig && delivery.deliveryMethod !== 'PICKUP')throw Error('SHIPPING_FEE_CONFIGURATION_REQUIRED');
  if(delivery.deliveryMethod === 'PICKUP') await requirePickupPoint(prisma, delivery.pickupPointVersion, address);
  const shippingFeeCents=delivery.deliveryMethod === 'PICKUP' ? 0 : calculateShippingQuote(address.province,shippingConfig!).feeCents;
  const pricing=await getMemberPricing(prisma,userId,[pricingItem],true);
  return {cart,quote:{currency:'CNY',itemCount:item.quantity,subtotalCents:pricing.subtotalCents,discountCents:pricing.discountCents,discountLabel:pricing.discountLabel,couponClaimId:pricing.couponClaimId,shippingFeeCents,payableAmountCents:pricing.payableAmountCents+shippingFeeCents}};
}

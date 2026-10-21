import {createHash,randomUUID} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {prisma} from '@/lib/db/prisma';
import {appConfig} from '@/lib/config';
import {assertProductPurchasable,getCommerceMode} from '@/lib/commerce/release-control';
import {parseQuantityPricing,quantityTotal,resolveProductStyle} from '@/lib/commerce/quantity-pricing';
import {isSupportedProductSpecification} from '@/lib/commerce/x1-specifications';
import {getX1AirWhiteOfferImage} from '@/lib/commerce/x1-air-white-offers';
import {getShippingRateConfig} from '@/lib/commerce/shipping';
import {calculateShippingQuote} from '@/lib/commerce/shipping-rates';
import {GIFT_STATUS_LABELS,assertGiftRedeemable,giftToken,validGiftToken,readGiftSnapshot,type GiftSnapshot} from '@/lib/commerce/gift-card';

type Tx=Prisma.TransactionClient;
const cardInclude={purchaseOrder:{select:{orderNo:true,paymentStatus:true}},redemptionOrder:{select:{orderNo:true,paymentStatus:true,fulfillmentStatus:true}}} as const;
type Card=Prisma.GiftCardGetPayload<{include:typeof cardInclude}>;
const key=(kind:string,userId:string,requestId:string)=>`gift-${createHash('sha256').update(`${kind}:${userId}:${requestId}`).digest('hex')}`;
const disabledPoints={version:2,enabled:false,centsPerPoint:100};

export async function giftTransaction<T>(work:(tx:Tx)=>Promise<T>):Promise<T>{
  for(let attempt=0;;attempt++){
    try{return await prisma.$transaction(work,{isolationLevel:'Serializable',timeout:30000});}
    catch(error){
      const fault=error as {code?:string;meta?:{code?:string;driverAdapterError?:{cause?:{originalCode?:string}}}};
      const postgresCode=fault?.meta?.code||fault?.meta?.driverAdapterError?.cause?.originalCode||'';
      const retry=['P2034','P2002'].includes(fault?.code||'') || (fault?.code==='P2010'&&['40001','40P01'].includes(postgresCode));
      if(attempt<3&&retry)continue;throw error;
    }
  }
}
async function audit(tx:Tx,actorId:string,action:string,targetId:string,detail:Prisma.InputJsonObject,admin=false){
  await tx.auditLog.create({data:{actorId,actorType:admin?'admin':'user',action:`gift.${action}`,targetType:'gift_card',targetId,detail}});
}
async function customer(tx:Tx,userId:string){
  const user=await tx.user.findUnique({where:{id:userId}});
  if(!user || user.role!=='CUSTOMER' || user.status!=='ACTIVE')throw Error('GIFT_CUSTOMER_REQUIRED');
  return user;
}
async function lockCard(tx:Tx,id:string){await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`gift:${id}`}))`;}
function present(card:Card,userId:string){
  const snapshot=readGiftSnapshot(card.snapshot),received=card.recipientId===userId;
  return {id:card.id,...snapshot,message:card.message,status:card.status,statusLabel:GIFT_STATUS_LABELS[card.status]||card.status,
    sent:card.senderId===userId,received,complimentary:!card.purchaseOrderId,createdAt:card.createdAt,
    purchaseOrderNo:card.senderId===userId?card.purchaseOrder?.orderNo:null,
    redemptionOrderNo:received?card.redemptionOrder?.orderNo:null,
    fulfillmentStatus:card.redemptionOrder?.fulfillmentStatus??null,
    canShare:card.senderId===userId&&card.status==='READY',canRedeem:received&&card.status==='CLAIMED',
  };
}
export async function getGiftWallet(userId:string){
  const [cards,templates,shipping]=await Promise.all([
    prisma.giftCard.findMany({where:{OR:[{senderId:userId},{recipientId:userId}]},include:cardInclude,orderBy:{createdAt:'desc'},take:100}),
    prisma.giftCardTemplate.findMany({where:{active:true},orderBy:{createdAt:'desc'},take:50}),getShippingRateConfig(),
  ]);
  return {cards:cards.map(card=>present(card,userId)),offers:templates.map(t=>({id:t.id,title:t.title,...readGiftSnapshot(t.snapshot)})),shipping,
    rules:'固定商品礼品卡，无储值余额，不支持提现。款式、颜色和条数购买时确定，领取后由收礼人选择同一尺码和配送地址。每张卡限一个账号领取、一次性兑换全部商品；库存以兑换时为准，缺货时可保留卡片稍后兑换。运费按收礼地址另计，确认前展示，不使用优惠券、不累计购物积分。暂停销售不影响已发卡使用。'};
}
export async function createGiftTemplate(actorId:string,input:{requestId:string;title:string;productId:string;style:string;quantity:number}){
  return giftTransaction(async tx=>{
    const id=key('template',actorId,input.requestId);
    await lockCard(tx,id);
    const existing=await tx.giftCardTemplate.findUnique({where:{id}});
    if(existing){if(existing.productId!==input.productId||existing.style!==input.style||existing.quantity!==input.quantity||existing.title!==input.title)throw Error('GIFT_REQUEST_CHANGED');return existing;}
    const product=await tx.product.findUnique({where:{id:input.productId},include:{skus:true,images:{orderBy:{sortOrder:'asc'},take:1}}});
    if(!product || product.status!=='ACTIVE')throw Error('GIFT_PRODUCT_UNAVAILABLE');
    const pricing=parseQuantityPricing(product.quantityPricing),style=resolveProductStyle(pricing,input.style);
    if(!style || style.key!==input.style || input.quantity>(pricing?.maxQuantity??1))throw Error('GIFT_SPEC_INVALID');
    const sku=product.skus.find(s=>s.status==='ACTIVE'&&s.color==='白色'&&isSupportedProductSpecification(product.slug,s.color,s.size));
    if(!sku)throw Error('GIFT_PRODUCT_UNAVAILABLE');
    const snapshot:GiftSnapshot={productId:product.id,productCode:product.code,productName:product.name,productSlug:product.slug,
      image:(product.slug==='x1-air-white'?getX1AirWhiteOfferImage(sku.color,input.quantity):null)??product.images[0]?.imageUrl??'',style:style.key,styleName:style.label,color:sku.color,quantity:input.quantity,
      goodsPriceCents:quantityTotal(sku.priceCents,input.quantity,pricing,style.key),unitPriceCents:style.unitPriceCents};
    const template=await tx.giftCardTemplate.create({data:{id,title:input.title,productId:product.id,style:style.key,quantity:input.quantity,amountCents:snapshot.goodsPriceCents,snapshot,active:false}});
    await audit(tx,actorId,'template.created',id,{title:input.title,active:false,quantity:input.quantity},true);
    return template;
  });
}
export async function toggleGiftTemplate(actorId:string,id:string,active:boolean){
  return giftTransaction(async tx=>{
    const template=await tx.giftCardTemplate.findUniqueOrThrow({where:{id},include:{product:true}});
    if(active){assertProductPurchasable(template.product,await getCommerceMode());const p=parseQuantityPricing(template.product.quantityPricing);
      if(resolveProductStyle(p,template.style)?.key!==template.style||quantityTotal(0,template.quantity,p,template.style)!==template.amountCents)throw Error('GIFT_PRICE_CHANGED');}
    await tx.giftCardTemplate.update({where:{id},data:{active}});
    await audit(tx,actorId,'template.toggled',id,{active},true);
  });
}
export async function purchaseGift(userId:string,input:{templateId:string;requestId:string;expectedAmountCents:number;message:string}){
  const mode=await getCommerceMode();
  return giftTransaction(async tx=>{
    const user=await customer(tx,userId),id=key('purchase',userId,input.requestId);
    await lockCard(tx,id);
    const existing=await tx.giftCard.findUnique({where:{requestKey:id},include:cardInclude});
    if(existing){if(existing.templateId!==input.templateId||existing.message!==input.message||readGiftSnapshot(existing.snapshot).goodsPriceCents!==input.expectedAmountCents)throw Error('GIFT_REQUEST_CHANGED');return present(existing,userId);}
    const template=await tx.giftCardTemplate.findUnique({where:{id:input.templateId},include:{product:{include:{skus:true}}}});
    if(!template?.active)throw Error('GIFT_SALES_CLOSED');
    assertProductPurchasable(template.product,mode);
    const snapshot=readGiftSnapshot(template.snapshot),pricing=parseQuantityPricing(template.product.quantityPricing);
    if(resolveProductStyle(pricing,snapshot.style)?.key!==snapshot.style||quantityTotal(0,snapshot.quantity,pricing,snapshot.style)!==template.amountCents||input.expectedAmountCents!==template.amountCents)throw Error('GIFT_PRICE_CHANGED');
    const sku=template.product.skus.find(s=>s.status==='ACTIVE'&&s.color===snapshot.color&&isSupportedProductSpecification(template.product.slug,s.color,s.size));
    if(!sku)throw Error('GIFT_PRODUCT_UNAVAILABLE');
    const orderNo=`GC${Date.now()}${randomUUID().replaceAll('-','').slice(0,8).toUpperCase()}`;
    const order=await tx.order.create({data:{orderNo,userId,kind:'GIFT_PURCHASE',source:'MINIPROGRAM',memberPointsPolicy:disabledPoints,
      subtotalCents:template.amountCents,payableAmountCents:template.amountCents,customerName:user.name||'礼品卡购买人',customerPhone:user.phone||'',
      addressSnapshot:'电子礼品卡，无需配送地址',items:{create:{productId:snapshot.productId,skuId:sku.id,productCode:snapshot.productCode,
        productName:`${snapshot.productName} · 固定商品礼品卡`,style:snapshot.style,color:snapshot.color,size:'收礼时选择',quantity:1,unitPriceCents:template.amountCents}},
    }});
    const card=await tx.giftCard.create({data:{id,templateId:template.id,senderId:userId,purchaseOrderId:order.id,requestKey:id,shareNonce:randomUUID(),message:input.message,snapshot:template.snapshot as Prisma.InputJsonValue},include:cardInclude});
    await audit(tx,userId,'purchase.created',card.id,{orderNo,amountCents:template.amountCents});return present(card,userId);
  });
}
export async function issueGift(actorId:string,input:{templateId:string;userId:string;requestId:string;reason:string}){
  return giftTransaction(async tx=>{
    await customer(tx,input.userId);const id=key('manual',actorId,input.requestId);await lockCard(tx,id);
    const old=await tx.giftCard.findUnique({where:{requestKey:id},include:cardInclude});
    if(old){if(old.senderId!==input.userId||old.templateId!==input.templateId)throw Error('GIFT_REQUEST_CHANGED');return present(old,input.userId);}
    const template=await tx.giftCardTemplate.findUniqueOrThrow({where:{id:input.templateId}});
    const card=await tx.giftCard.create({data:{id,templateId:template.id,senderId:input.userId,status:'READY',requestKey:id,shareNonce:randomUUID(),issuerId:actorId,snapshot:template.snapshot as Prisma.InputJsonValue},include:cardInclude});
    await audit(tx,actorId,'issued',id,{reason:input.reason,userId:input.userId,complimentary:true},true);return present(card,input.userId);
  });
}
export async function prepareGiftShare(userId:string,id:string,reset=false){
  return giftTransaction(async tx=>{
    await lockCard(tx,id);const card=await tx.giftCard.findUnique({where:{id},include:cardInclude});
    if(!card||card.senderId!==userId||card.status!=='READY')throw Error('GIFT_NOT_SHAREABLE');
    const nonce=reset?randomUUID():card.shareNonce;
    if(reset){await tx.giftCard.update({where:{id},data:{shareNonce:nonce}});await audit(tx,userId,'share.reset',id,{});}
    return {path:`/pages/gift-receive/index?id=${id}&token=${giftToken(id,nonce,appConfig.SESSION_SECRET)}`,title:`送你一份 ${readGiftSnapshot(card.snapshot).productName}`,imageUrl:readGiftSnapshot(card.snapshot).image};
  });
}
async function cardByToken(tx:Tx,id:string,token:string){
  const card=await tx.giftCard.findUnique({where:{id},include:cardInclude});
  if(!card||!validGiftToken(token,id,card.shareNonce,appConfig.SESSION_SECRET)||['PENDING_PAYMENT','CANCELLED','REFUNDED','VOID','REFUND_PENDING'].includes(card.status))throw Error('GIFT_LINK_INVALID');
  return card;
}
export async function previewGift(id:string,token:string,userId?:string){
  return giftTransaction(async tx=>{
    const card=await cardByToken(tx,id,token);
    return {...readGiftSnapshot(card.snapshot),message:card.message,status:card.status,
      alreadyClaimed:!!card.recipientId,owned:!!userId&&card.recipientId===userId,
      ...(userId===card.recipientId?{card:present(card,userId)}:{}),
    };
  });
}
export async function claimGift(userId:string,id:string,token:string){
  return giftTransaction(async tx=>{
    await customer(tx,userId);await lockCard(tx,id);const card=await cardByToken(tx,id,token);
    if(card.recipientId===userId)return present(card,userId);
    if(card.recipientId||card.status!=='READY')throw Error('GIFT_ALREADY_CLAIMED');
    const updated=await tx.giftCard.update({where:{id},data:{recipientId:userId,status:'CLAIMED',claimedAt:new Date()},include:cardInclude});
    await audit(tx,userId,'claimed',id,{});return present(updated,userId);
  });
}
export async function getGiftSelection(userId:string,id:string,addressId?:string){
  const card=await prisma.giftCard.findUnique({where:{id},include:cardInclude});
  if(!card||card.recipientId!==userId)throw Error('GIFT_RECIPIENT_REQUIRED');
  const snapshot=readGiftSnapshot(card.snapshot);
  const [skus,shipping,address]=await Promise.all([
    prisma.productSku.findMany({where:{productId:snapshot.productId,color:snapshot.color,status:'ACTIVE'},orderBy:{size:'asc'}}),
    getShippingRateConfig(),addressId?prisma.address.findFirst({where:{id:addressId,userId}}):Promise.resolve(null),
  ]);
  if(addressId&&!address)throw Error('ADDRESS_NOT_FOUND');if(!shipping)throw Error('SHIPPING_FEE_CONFIGURATION_REQUIRED');
  return {card:present(card,userId),sizes:skus.filter(s=>isSupportedProductSpecification(snapshot.productSlug,s.color,s.size)).sort((a,b)=>['S','M','L'].indexOf(a.size)-['S','M','L'].indexOf(b.size)).map(s=>({size:s.size,available:Math.max(0,s.stockQuantity-s.reservedQuantity),canRedeem:s.stockQuantity-s.reservedQuantity>=snapshot.quantity})),
    shippingFeeCents:address?calculateShippingQuote(address.province,shipping).feeCents:null};
}
export async function redeemGift(userId:string,input:{id:string;size:string;addressId:string;requestId:string;expectedShippingCents:number}){
  const shipping=await getShippingRateConfig();if(!shipping)throw Error('SHIPPING_FEE_CONFIGURATION_REQUIRED');
  return giftTransaction(async tx=>{
    await customer(tx,userId);await lockCard(tx,input.id);
    const card=await tx.giftCard.findUnique({where:{id:input.id},include:cardInclude});
    if(!card)throw Error('GIFT_NOT_FOUND');
    if(card.recipientId===userId&&['REDEEMING','REDEEMED'].includes(card.status)&&card.redemptionOrderId)return {card:present(card,userId),orderNo:card.redemptionOrder!.orderNo,needsPayment:card.redemptionOrder!.paymentStatus!=='PAID'};
    assertGiftRedeemable(card.status,card.recipientId,userId);
    const snapshot=readGiftSnapshot(card.snapshot),address=await tx.address.findFirst({where:{id:input.addressId,userId}});
    if(!address)throw Error('ADDRESS_NOT_FOUND');
    const fee=calculateShippingQuote(address.province,shipping).feeCents;
    if(fee!==input.expectedShippingCents)throw Error('GIFT_SHIPPING_CHANGED');
    const product=await tx.product.findUnique({where:{id:snapshot.productId}});
    if(!product||product.status!=='ACTIVE'||!isSupportedProductSpecification(product.slug,snapshot.color,input.size))throw Error('GIFT_SPEC_INVALID');
    const sku=await tx.productSku.findFirst({where:{productId:product.id,color:snapshot.color,size:input.size,status:'ACTIVE'}});
    if(!sku)throw Error('GIFT_SPEC_INVALID');
    await tx.$queryRaw`SELECT id FROM product_skus WHERE id=${sku.id} FOR UPDATE`;
    const stock=await tx.productSku.findUniqueOrThrow({where:{id:sku.id}});
    if(stock.stockQuantity-stock.reservedQuantity<snapshot.quantity)throw Error('INSUFFICIENT_INVENTORY');
    const orderNo=`GR${Date.now()}${randomUUID().replaceAll('-','').slice(0,8).toUpperCase()}`;
    const order=await tx.order.create({data:{orderNo,userId,kind:'GIFT_REDEMPTION',source:'MINIPROGRAM',memberPointsPolicy:disabledPoints,addressId:address.id,
      status:fee?'CREATED':'CONFIRMED',paymentStatus:fee?'NOT_STARTED':'PAID',subtotalCents:0,shippingFeeCents:fee,payableAmountCents:fee,
      customerName:address.name,customerPhone:address.phone,addressSnapshot:[address.province,address.city,address.district,address.detail].filter(Boolean).join(''),
      discountLabel:'礼品卡兑换，商品已支付',note:`礼品卡 ${card.id}，商品款项由赠礼人支付`,
      items:{create:{productId:product.id,skuId:sku.id,productCode:snapshot.productCode,productName:`${snapshot.productName} · ${snapshot.styleName}`,style:snapshot.style,color:snapshot.color,size:input.size,quantity:snapshot.quantity,unitPriceCents:0}},
    }});
    await tx.productSku.update({where:{id:sku.id},data:fee?{reservedQuantity:{increment:snapshot.quantity}}:{stockQuantity:{decrement:snapshot.quantity}}});
    await tx.inventoryLog.create({data:{skuId:sku.id,action:fee?'RESERVE':'DEDUCT',quantity:snapshot.quantity,note:fee?`Order ${orderNo}`:`Paid order ${orderNo}`,actorId:userId}});
    const updated=await tx.giftCard.update({where:{id:card.id},data:{status:fee?'REDEEMING':'REDEEMED',redemptionOrderId:order.id,...(!fee?{redeemedAt:new Date()}:{})},include:cardInclude});
    await audit(tx,userId,'redeemed',card.id,{orderNo,size:input.size,quantity:snapshot.quantity,shippingFeeCents:fee});
    return {card:present(updated,userId),orderNo,needsPayment:fee>0};
  });
}
// Called only by verified payment processing, in the same transaction as payment settlement.
export async function settleGiftPayment(tx:Tx,orderId:string){
  const order=await tx.order.findUniqueOrThrow({where:{id:orderId}});
  if(order.kind==='GIFT_PURCHASE'){
    const card=await tx.giftCard.findUniqueOrThrow({where:{purchaseOrderId:orderId}});await lockCard(tx,card.id);
    if(card.status==='PENDING_PAYMENT')await tx.giftCard.update({where:{id:card.id},data:{status:'READY'}});
    if(!['PENDING_PAYMENT','READY','CLAIMED','REDEEMING','REDEEMED'].includes(card.status))throw Error('GIFT_PAYMENT_STATE_INVALID');
    await tx.order.update({where:{id:orderId},data:{fulfillmentStatus:'DELIVERED'}});
    if(!await tx.shipment.findFirst({where:{orderId}}))await tx.shipment.create({data:{orderId,status:'DELIVERED',shippedAt:new Date(),deliveredAt:new Date()}});
    return true;
  }
  if(order.kind==='GIFT_REDEMPTION'){
    const card=await tx.giftCard.findUniqueOrThrow({where:{redemptionOrderId:orderId}});await lockCard(tx,card.id);
    if(card.status==='REDEEMING')await tx.giftCard.update({where:{id:card.id},data:{status:'REDEEMED',redeemedAt:new Date()}});
    else if(card.status!=='REDEEMED')throw Error('GIFT_PAYMENT_STATE_INVALID');
  }
  return false;
}
export async function cancelGiftOrder(tx:Tx,orderId:string){
  const card=await tx.giftCard.findFirst({where:{OR:[{purchaseOrderId:orderId},{redemptionOrderId:orderId}]}});
  if(!card)return;await lockCard(tx,card.id);
  if(card.purchaseOrderId===orderId&&card.status==='PENDING_PAYMENT')await tx.giftCard.update({where:{id:card.id},data:{status:'CANCELLED'}});
  if(card.redemptionOrderId===orderId&&card.status==='REDEEMING')await tx.giftCard.update({where:{id:card.id},data:{status:'CLAIMED',redemptionOrderId:null}});
}
export async function requestGiftRefund(userId:string,id:string,reason:string,admin=false){
  return giftTransaction(async tx=>{
    await lockCard(tx,id);const card=await tx.giftCard.findUnique({where:{id},include:{purchaseOrder:{include:{paymentIntents:true,refunds:true}}}});
    if(!card||(!admin&&card.senderId!==userId))throw Error('GIFT_NOT_FOUND');
    if(card.status==='REFUND_PENDING'){const r=card.purchaseOrder?.refunds.find(r=>['CREATED','PROCESSING','FAILED'].includes(r.refundStatus));if(r)return {refundNo:r.refundNo};}
    if(!['READY','CLAIMED'].includes(card.status)||card.redemptionOrderId)throw Error('GIFT_REFUND_UNAVAILABLE');
    if(!card.purchaseOrderId){if(!admin)throw Error('GIFT_COMPLIMENTARY_REFUND_UNAVAILABLE');await tx.giftCard.update({where:{id},data:{status:'VOID'}});await audit(tx,userId,'voided',id,{reason},true);return {voided:true};}
    const order=card.purchaseOrder!,payment=order.paymentIntents.find(p=>p.status==='PAID'&&p.provider==='WECHAT_PAY');
    if(order.paymentStatus!=='PAID'||!payment||order.refunds.some(r=>['CREATED','MANUAL_MARKED','PROCESSING','SUCCEEDED'].includes(r.refundStatus)))throw Error('GIFT_REFUND_UNAVAILABLE');
    const refundNo=`RG${Date.now()}${randomUUID().replaceAll('-','').slice(0,8).toUpperCase()}`;
    await tx.refund.create({data:{refundNo,orderId:order.id,paymentId:payment.id,refundAmountCents:order.payableAmountCents,reason:`礼品卡退款：${reason}`,refundStatus:'CREATED'}});
    await tx.giftCard.update({where:{id},data:{status:'REFUND_PENDING'}});
    await audit(tx,userId,'refund.requested',id,{refundNo,reason},admin);return {refundNo};
  });
}
export async function completeGiftRefund(tx:Tx,orderId:string){
  const card=await tx.giftCard.findUnique({where:{purchaseOrderId:orderId}});
  if(card){await lockCard(tx,card.id);await tx.giftCard.update({where:{id:card.id},data:{status:'REFUNDED'}});}
}
export async function mergeGifts(tx:Tx,sourceUserId:string,targetUserId:string){
  const cards=await tx.giftCard.findMany({where:{OR:[{senderId:sourceUserId},{recipientId:sourceUserId}]},select:{id:true},orderBy:{id:'asc'}});
  for(const card of cards)await lockCard(tx,card.id);
  await tx.giftCard.updateMany({where:{senderId:sourceUserId},data:{senderId:targetUserId}});
  await tx.giftCard.updateMany({where:{recipientId:sourceUserId},data:{recipientId:targetUserId}});
}

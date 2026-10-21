import {createHmac, timingSafeEqual} from 'node:crypto';

export const GIFT_STATUS_LABELS: Record<string,string> = {
  PENDING_PAYMENT:'待付款', READY:'待赠送', CLAIMED:'已领取，待选尺码',
  REDEEMING:'待支付运费', REDEEMED:'已兑换', REFUND_PENDING:'退款处理中',
  REFUNDED:'已退款', VOID:'已撤回', CANCELLED:'已取消',
};
export type GiftSnapshot = {
  productId:string; productCode:string; productName:string; productSlug:string;
  image:string; style:string; styleName:string; color:string; quantity:number;
  goodsPriceCents:number; unitPriceCents:number;
};
export function giftToken(id:string, nonce:string, secret:string) {
  return createHmac('sha256',secret).update(`gift-share:v1:${id}:${nonce}`).digest('base64url');
}
export function validGiftToken(token:string,id:string,nonce:string,secret:string) {
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))return false;
  const actual=Buffer.from(token),expected=Buffer.from(giftToken(id,nonce,secret));
  return actual.length===expected.length && timingSafeEqual(actual,expected);
}
export function readGiftSnapshot(value:unknown):GiftSnapshot {
  const data=value as GiftSnapshot|null;
  if(!data || typeof data.productId!=='string' || typeof data.style!=='string' ||
    !Number.isSafeInteger(data.quantity) || data.quantity<1 || data.quantity>99 ||
    !Number.isSafeInteger(data.goodsPriceCents) || data.goodsPriceCents<=0)throw Error('GIFT_DATA_INVALID');
  return data;
}
export function assertGiftRedeemable(status:string, recipientId:string|null,userId:string) {
  if(recipientId!==userId)throw Error('GIFT_RECIPIENT_REQUIRED');
  if(status!=='CLAIMED')throw Error('GIFT_NOT_REDEEMABLE');
}

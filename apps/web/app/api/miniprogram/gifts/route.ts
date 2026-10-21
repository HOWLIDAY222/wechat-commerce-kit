import {NextResponse} from 'next/server';
import {z} from 'zod';
import {readBearerUserSession} from '@/lib/auth/session';
import {getGiftWallet,purchaseGift,prepareGiftShare,previewGift,claimGift,getGiftSelection,redeemGift,requestGiftRefund} from '@/lib/services/gift-card-service';

const id=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),token=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const schema=z.discriminatedUnion('action',[
  z.object({action:z.literal('preview'),id,token}),
  z.object({action:z.literal('purchase'),templateId:id,requestId:z.uuid(),expectedAmountCents:z.number().int().positive(),message:z.string().trim().max(120).default('')}),
  z.object({action:z.literal('share'),id,reset:z.boolean().optional()}),
  z.object({action:z.literal('claim'),id,token}),
  z.object({action:z.literal('selection'),id,addressId:id.optional()}),
  z.object({action:z.literal('redeem'),id,size:z.enum(['S','M','L']),addressId:id,requestId:z.uuid(),expectedShippingCents:z.number().int().min(0).max(99900)}),
  z.object({action:z.literal('refund'),id,reason:z.string().trim().min(2).max(200)}),
]);
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
export async function GET(request:Request){
  const session=await readBearerUserSession(request);if(!session)return json({ok:false,error:'AUTH_REQUIRED'},401);
  try{return json({ok:true,...await getGiftWallet(session.userId)});}catch{return json({ok:false,error:'GIFT_LOAD_FAILED'},503);}
}
export async function POST(request:Request){
  const parsed=schema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return json({ok:false,error:'GIFT_REQUEST_INVALID'},400);
  const input=parsed.data,session=await readBearerUserSession(request);
  if(input.action!=='preview'&&!session)return json({ok:false,error:'AUTH_REQUIRED'},401);
  try{
    if(input.action==='preview')return json({ok:true,gift:await previewGift(input.id,input.token,session?.userId)});
    const userId=session!.userId;
    if(input.action==='purchase')return json({ok:true,card:await purchaseGift(userId,input)});
    if(input.action==='share')return json({ok:true,share:await prepareGiftShare(userId,input.id,input.reset)});
    if(input.action==='claim')return json({ok:true,card:await claimGift(userId,input.id,input.token)});
    if(input.action==='selection')return json({ok:true,...await getGiftSelection(userId,input.id,input.addressId)});
    if(input.action==='redeem')return json({ok:true,...await redeemGift(userId,input)});
    return json({ok:true,...await requestGiftRefund(userId,input.id,input.reason)});
  }catch(error){const message=error instanceof Error?error.message:'';
    return json({ok:false,error:/^(GIFT_[A-Z_]+|ADDRESS_NOT_FOUND|SHIPPING_[A-Z_]+|INSUFFICIENT_INVENTORY|COMMERCE_[A-Z_]+|PRODUCT_[A-Z_]+)$/.test(message)?message:'GIFT_ACTION_FAILED'},400);}
}

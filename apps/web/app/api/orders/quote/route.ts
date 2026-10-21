import { pickupChoiceFields } from '@/lib/commerce/offline-pickup';
import { MAINLAND_PROVINCES } from "@/lib/commerce/shipping-rates";
import { NextResponse } from "next/server";
import { readRequestUserSession,readBearerUserSession } from "@/lib/auth/session";
import {z} from 'zod';
import {directPurchaseSelectionSchema} from '@/lib/commerce/direct-checkout';
import {getDirectCheckoutForUser} from '@/lib/services/direct-checkout-service';
import { getOrderQuoteForUser } from "@/lib/services/order-service";

export async function GET(request: Request) {
  const session = await readRequestUserSession(request);
  if (!session) return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });

  try {
    const delivery = z.object(pickupChoiceFields).safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!delivery.success) return NextResponse.json({ok:false,error:'INVALID_DELIVERY_METHOD'},{status:400});
    const addressId = new URL(request.url).searchParams.get("addressId");
    const province = new URL(request.url).searchParams.get("province") || "";
    if (!addressId && !(MAINLAND_PROVINCES as readonly string[]).includes(province)) return NextResponse.json({ ok: false, error: "ADDRESS_REQUIRED" }, { status: 400 });
    return NextResponse.json({ ok: true, quote: await getOrderQuoteForUser(session.userId, addressId || "", new URL(request.url).searchParams.get("useCoupons") === "1", province, delivery.data) });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "ORDER_QUOTE_FAILED",
    }, { status: 400 });
  }
}

const directQuoteSchema=z.object({...pickupChoiceFields,directSelection:directPurchaseSelectionSchema,addressId:z.string().trim().min(1).optional()}).strict();
export async function POST(request:Request){
  const session=await readBearerUserSession(request);
  const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
  if(!session)return json({ok:false,error:'AUTH_REQUIRED'},401);
  const parsed=directQuoteSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return json({ok:false,error:'INVALID_DIRECT_SELECTION'},400);
  try{return json({ok:true,...await getDirectCheckoutForUser(session.userId,parsed.data.directSelection,parsed.data.addressId,parsed.data)});}
  catch(error){return json({ok:false,error:error instanceof Error?error.message:'ORDER_QUOTE_FAILED'},400);}
}

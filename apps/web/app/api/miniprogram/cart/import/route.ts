import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { readBearerUserSession } from "@/lib/auth/session";
import { addCartItems, resolveCartKey } from "@/lib/services/cart-service";

const schema = z.object({
  importId:z.string().regex(/^[A-Za-z0-9_-]{20,100}$/),
  items:z.array(z.object({productSlug:z.string().min(1).max(150),color:z.string().max(80),size:z.string().max(80),style:z.string().max(31).optional(),quantity:z.number().int().min(1).max(99)})).min(1).max(20),
});
export async function POST(request: Request) {
  const session = await readBearerUserSession(request);
  if (!session) return NextResponse.json({ok:false,error:"AUTH_REQUIRED"},{status:401});
  const parsed = schema.safeParse(await request.json().catch(()=>null));
  if (!parsed.success) return NextResponse.json({ok:false,error:"INVALID_CART_IMPORT"},{status:400});
  const payloadHash = createHash("sha256").update(JSON.stringify(parsed.data.items)).digest("hex");
  try {
    const key = await resolveCartKey(undefined,session.userId);
    for(let attempt=0;attempt<3;attempt++) {
      try {
        const cart=await addCartItems(key,parsed.data.items,session.userId,{id:parsed.data.importId,payloadHash});
        return NextResponse.json({ok:true,cart},{headers:{"Cache-Control":"no-store"}});
      } catch(error) {
        const code = typeof error==='object'&&error!==null&&'code' in error ? error.code : '';
        if(attempt<2 && (code==='P2034'||code==='P2002')) continue;
        throw error;
      }
    }
    throw new Error("CART_IMPORT_RETRY_EXHAUSTED");
  } catch(error) {
    const code=error instanceof Error?error.message:'';
    const known=['INSUFFICIENT_INVENTORY','QUANTITY_LIMIT_EXCEEDED','PRODUCT_QUANTITY_LIMIT_EXCEEDED','SKU_NOT_FOUND','PRODUCT_SHOWCASE_ONLY','PRODUCT_SALE_NOT_STARTED','PRODUCT_SALE_PAUSED','COMMERCE_PAUSED','COMMERCE_SHOWCASE_ONLY','CART_IMPORT_CONFLICT','INVALID_QUANTITY','PRODUCT_STYLE_UNAVAILABLE'];
    return NextResponse.json({ok:false,error:known.includes(code)?code:'CART_IMPORT_UNAVAILABLE'},{status:known.includes(code)?400:503});
  }
}

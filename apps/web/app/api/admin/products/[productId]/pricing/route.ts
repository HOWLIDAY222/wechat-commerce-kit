import {NextResponse} from 'next/server';
import {z} from 'zod';
import {readCurrentAdminSession} from '@/lib/auth/session';
import {updateAdminProductPricing} from '@/lib/services/admin-catalog-service';
import {parseQuantityPricing} from '@/lib/commerce/quantity-pricing';
import {revalidateStorefront} from '@/lib/storefront-revalidation';
export async function POST(request:Request,{params}:{params:Promise<{productId:string}>}){
 const session=await readCurrentAdminSession();if(!session)return NextResponse.json({ok:false,error:'ADMIN_UNAUTHORIZED'},{status:401});
 try{const input=z.object({unitPriceCents:z.number().int().positive().optional(),quantityPricing:z.unknown()}).parse(await request.json());const product=await updateAdminProductPricing((await params).productId,{...input,quantityPricing:parseQuantityPricing(input.quantityPricing)},session.userId);revalidateStorefront();return NextResponse.json({ok:true,product});}catch(error){return NextResponse.json({ok:false,error:error instanceof Error?error.message:'INVALID_PRICING'},{status:400});}
}

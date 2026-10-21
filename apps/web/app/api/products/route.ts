import { NextResponse } from "next/server";
import { listProducts, toPublicProductJson } from "@/lib/services/catalog-service";
import {quantityPricingForClient} from '@/lib/commerce/client-quantity-pricing';

export async function GET(request:Request) {
  return NextResponse.json({
    ok: true,
    products: (await listProducts()).map(toPublicProductJson).map(p=>({...p,quantityPricing:quantityPricingForClient(p.quantityPricing,request.headers.get('x-client-channel'),request.headers.get('x-quantity-pricing'))})),
  },{headers:{Vary:'X-Client-Channel, X-Quantity-Pricing','Cache-Control':'private, no-store'}});
}

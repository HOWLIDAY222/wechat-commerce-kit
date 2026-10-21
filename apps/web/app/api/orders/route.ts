import { pickupChoiceFields } from '@/lib/commerce/offline-pickup';
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { readBearerToken, readRequestUserSession } from "@/lib/auth/session";
import { isDomesticHost, MINI_PROGRAM_PATH } from "@/lib/storefront-market";
import { MAINLAND_PROVINCES } from "@/lib/commerce/shipping-rates";
import { resolveCartKey } from "@/lib/services/cart-service";
import { createOrderFromCart } from "@/lib/services/order-service";
import {directPurchaseSelectionSchema} from "@/lib/commerce/direct-checkout";

const couponFields = { ...pickupChoiceFields, useCoupons: z.boolean().optional(), expectedPayableCents: z.number().int().min(1).optional(),directSelection:directPurchaseSelectionSchema.optional(),requestId:z.uuid().optional() };
const orderSchema = z.object({
  ...couponFields,
  addressId: z.string().trim().min(1).optional(),
  customerName: z.preprocess((value) => (typeof value === "string" ? value : ""), z.string().trim().min(1, "请填写收货人。")),
  customerPhone: z.preprocess((value) => (typeof value === "string" ? value : ""), z.string().trim().min(5, "请填写联系电话。")),
  shippingProvince: z.enum(MAINLAND_PROVINCES, { error: "请选择中国大陆配送省区。" }),
  addressSnapshot: z.preprocess((value) => (typeof value === "string" ? value : ""), z.string().trim().min(1, "请填写收货地址。")),
}).or(z.object({
  ...couponFields,
  addressId: z.string().trim().min(1),
}));

export async function POST(request: Request) {
  // Bearer clients still pass full session validation below before any mutation.
  if (isDomesticHost(request.headers.get("host")) && !readBearerToken(request)) {
    return NextResponse.json({ ok: false, error: "MINIPROGRAM_PURCHASE_REQUIRED", redirectUrl: MINI_PROGRAM_PATH }, { status: 403 });
  }
  const parsed = orderSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: parsed.error.issues[0]?.message ?? "订单信息不完整，请检查收货信息。",
        code: "INVALID_ORDER_REQUEST",
      },
      { status: 400 },
    );
  }

  if (parsed.data.deliveryMethod === 'PICKUP' && (!parsed.data.addressId || !parsed.data.pickupPointVersion)) return NextResponse.json({ok:false,error:'ADDRESS_REQUIRED'},{status:400});
  if (parsed.data.useCoupons && parsed.data.expectedPayableCents === undefined) return NextResponse.json({ ok: false, error: "PRICE_CHANGED" }, { status: 400 });
  if(parsed.data.directSelection&&(!readBearerToken(request)||!parsed.data.addressId||!parsed.data.requestId||parsed.data.useCoupons!==true))return NextResponse.json({ok:false,error:'INVALID_DIRECT_SELECTION'},{status:400});
  const session = await readRequestUserSession(request);
  if (!session) {
    return NextResponse.json({ ok: false, error: "AUTH_REQUIRED" }, { status: 401 });
  }

  const cookieCartKey = request.headers.has("authorization")
    ? undefined
    : (await cookies()).get("merchantkit_cart")?.value;
  const cartKey = parsed.data.directSelection ? 'direct-checkout' : await resolveCartKey(cookieCartKey, session.userId);
  if (!cartKey) {
    return NextResponse.json({ ok: false, error: "CART_EMPTY" }, { status: 400 });
  }

  try {
    const order = await createOrderFromCart(cartKey, {
      ...parsed.data,
      userId: session.userId,
      source: request.headers.has("authorization") ? "MINIPROGRAM" : "WEB",
    });
    return NextResponse.json({ ok: true, order });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "ORDER_CREATE_FAILED" },
      { status: 400 },
    );
  }
}

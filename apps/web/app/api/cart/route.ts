import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { readRequestUserSession } from "@/lib/auth/session";
import { appConfig } from "@/lib/config";
import {
  addCartItem,
  addCartItems,
  cartCookieName,
  getCartSummary,
  resolveCartKey,
  updateCartItem,
  replaceCartItemVariant,
} from "@/lib/services/cart-service";

const addSchema = z.object({
  productSlug: z.string().min(1),
  color: z.string().optional(),
  size: z.string().optional(),
  style:z.string().max(31).optional(),
  quantity: z.number().int().positive().max(99).default(1),
});

const addRequestSchema = z.union([
  addSchema,
  z.object({ items: z.array(addSchema).min(2).max(20) }).strict(),
]);

const updateSchema = addSchema.extend({ action:z.literal("replaceVariant"),expectedQuantity:z.number().int().min(1).max(99).optional(),itemId:z.string().min(1),color:z.string().min(1),size:z.string().min(1) }).or(z.object({
  itemId: z.string().min(1),
  quantity: z.number().int().min(0).max(99),
}).strict());

async function ensureCartContext(request: Request) {
  const store = await cookies();
  const session = await readRequestUserSession(request);
  if(request.headers.has("authorization")&&!session)throw new Error("AUTH_REQUIRED");
  const current = request.headers.has("authorization") ? undefined : store.get(cartCookieName)?.value;
  const key = await resolveCartKey(current, session?.userId);
  return { key, session };
}

function setCartCookie(response: NextResponse, key: string) {
  response.cookies.set(cartCookieName, key, {
    httpOnly: true,
    sameSite: "lax",
    secure: appConfig.APP_BASE_URL.startsWith("https://"),
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function GET(request: Request) {
  try {
  const { key, session } = await ensureCartContext(request);
  const response = NextResponse.json({ ok: true, cart: await getCartSummary(key, session?.userId) });
  setCartCookie(response, key);
  return response;
  } catch(error) {
    const authRequired=error instanceof Error&&error.message==="AUTH_REQUIRED";
    return NextResponse.json({ok:false,error:authRequired?"AUTH_REQUIRED":"CART_LOAD_FAILED"},{status:authRequired?401:503});
  }
}

export async function POST(request: Request) {
  const parsed = addRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_CART_ITEM" }, { status: 400 });
  }

  try {
    const { key, session } = await ensureCartContext(request);
    const cart = "items" in parsed.data
      ? await addCartItems(key, parsed.data.items, session?.userId)
      : await addCartItem(key, parsed.data, session?.userId);
    const response = NextResponse.json({ ok: true, cart });
    setCartCookie(response, key);
    return response;
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "CART_ADD_FAILED" },
      { status: error instanceof Error && error.message === "AUTH_REQUIRED" ? 401 : 400 },
    );
  }
}

export async function PATCH(request: Request) {
  const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "INVALID_CART_UPDATE" }, { status: 400 });
  }

  try {
    const { key, session } = await ensureCartContext(request);
    if ("action" in parsed.data && !session) throw new Error("AUTH_REQUIRED");
    const cart = "action" in parsed.data
      ? await replaceCartItemVariant(key,parsed.data.itemId,parsed.data,session!.userId)
      : await updateCartItem(key, parsed.data.itemId, parsed.data.quantity, session?.userId);
    const response = NextResponse.json({ ok: true, cart });
    setCartCookie(response, key);
    return response;
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "CART_UPDATE_FAILED" },
      { status: error instanceof Error && error.message === "AUTH_REQUIRED" ? 401 : 400 },
    );
  }
}

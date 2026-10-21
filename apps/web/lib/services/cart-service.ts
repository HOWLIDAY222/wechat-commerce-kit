import { isSupportedProductSpecification } from "@/lib/commerce/x1-specifications";
import {resolveProductStyle,productStylePrice,productStyleName} from "@/lib/commerce/product-style";
import { randomUUID } from "crypto";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { assertProductPurchasable, getCommerceMode } from "@/lib/commerce/release-control";
import { calculateCartPricing, parseQuantityPricing } from "@/lib/commerce/quantity-pricing";
import { getX1AirWhiteOfferImage } from "@/lib/commerce/x1-air-white-offers";
import {
  addRuntimeCartItems,
  createRuntimeCartKey,
  getRuntimeCart,
  getRuntimeUserCartKey,
  mergeRuntimeCart,
  summarizeCart,
  updateRuntimeCartItem,
  type RuntimeResolvedSku,
} from "@/lib/runtime-commerce";
import { listAdminProducts } from "@/lib/services/admin-catalog-service";

export const cartCookieName = "merchantkit_cart";

export type CartItemInput = {
  productSlug: string;
  style?:string;
  color?: string;
  size?: string;
  quantity: number;
  expectedQuantity?:number;
};

type PrismaCartWithItems = NonNullable<Awaited<ReturnType<typeof loadPrismaCartByContext>>>;

export function isPrismaCommerceStorage() {
  return appConfig.COMMERCE_STORAGE === "prisma";
}

export async function resolveCartKey(currentKey: string | undefined, userId?: string) {
  if (!isPrismaCommerceStorage()) {
    if (userId) {
      const userKey = getRuntimeUserCartKey(userId);
      if (currentKey && currentKey !== userKey) mergeRuntimeCart(currentKey, userKey);
      return userKey;
    }
    return currentKey || createRuntimeCartKey();
  }

  if (userId) {
    if (currentKey?.startsWith("guest_")) {
      await mergePrismaGuestCartIntoUserCart(currentKey, userId);
    } else {
      await ensurePrismaUserCart(userId);
    }
    return getRuntimeUserCartKey(userId);
  }

  const guestKey = currentKey?.startsWith("guest_") ? currentKey : `guest_${randomUUID()}`;
  await ensurePrismaGuestCart(guestKey);
  return guestKey;
}

export async function getCartSummary(key: string, userId?: string) {
  if (!isPrismaCommerceStorage()) return summarizeCart(getRuntimeCart(key));

  const cart = await loadPrismaCartByContext(key, userId);
  if (!cart) {
    const created = userId ? await ensurePrismaUserCart(userId) : await ensurePrismaGuestCart(key);
    return summarizePrismaCart(created);
  }
  return summarizePrismaCart(cart);
}

export async function addCartItem(key: string, input: CartItemInput, userId?: string) {
  return addCartItems(key, [input], userId);
}

export async function addCartItems(key: string, inputs: CartItemInput[], userId?: string, importRequest?: { id: string; payloadHash: string }) {
  if (inputs.length < 1 || inputs.length > 20) throw new Error("INVALID_CART_ITEM");
  const commerceMode = await getCommerceMode();
  if (!isPrismaCommerceStorage()) {
    if(inputs.some(i=>i.style))throw Error("STYLED_COMMERCE_REQUIRES_PRISMA");
    if (importRequest) throw new Error("CART_IMPORT_REQUIRES_PRISMA");
    const resolvedSkus = await Promise.all(inputs.map((input) => resolveRuntimeSku(input)));
    resolvedSkus.forEach((sku) => assertProductPurchasable(sku.releaseProduct, commerceMode));
    return summarizeCart(addRuntimeCartItems(key, inputs.map((input, index) => ({ input, resolvedSku: resolvedSkus[index] }))));
  }
  const cart = await ensurePrismaCartByContext(key, userId);
  return prisma.$transaction(async (tx) => {
    const current = await tx.cart.findUnique({ where: { id: cart.id }, include: cartInclude });
    if (!current) throw new Error("CART_NOT_FOUND");
    if (importRequest) {
      if (!userId) throw new Error("AUTH_REQUIRED");
      const receipt = await tx.miniProgramCartImport.findUnique({ where: { id: importRequest.id } });
      if (receipt) {
        if (receipt.userId !== userId || receipt.payloadHash !== importRequest.payloadHash) throw new Error("CART_IMPORT_CONFLICT");
        return summarizePrismaCart(current);
      }
      await tx.miniProgramCartImport.create({ data: { id: importRequest.id, userId, payloadHash: importRequest.payloadHash } });
    }
    const productSlugs = [...new Set(inputs.map((input) => input.productSlug))];
    const products = await tx.product.findMany({
      where: { slug: { in: productSlugs }, status: "ACTIVE" },
      include: { skus: { where: { status: "ACTIVE" }, orderBy: [{ color: "asc" }, { size: "asc" }] } },
    });
    const productsBySlug = new Map(products.map((product) => [product.slug, product]));
    const stagedItems = new Map(current.items.map((item) => [JSON.stringify([item.skuId,item.style]), {...toPricingItem(item),skuId:item.skuId}]));
    const selectedSkus = new Map<string, { id: string; style:string; priceCents: number }>();

    for (const input of inputs) {
      if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 99) throw new Error("INVALID_QUANTITY");
      const product = productsBySlug.get(input.productSlug);
      if (!product || product.skus.length === 0) throw new Error("SKU_NOT_FOUND");
      assertProductPurchasable(product, commerceMode);
      const sku = product.skus.find((candidate) => {
        const colorMatches = input.color ? candidate.color === input.color : true;
        const sizeMatches = input.size ? candidate.size === input.size : true;
        return colorMatches && sizeMatches && isSupportedProductSpecification(product.slug, candidate.color, candidate.size);
      }) ?? (!input.color && !input.size ? product.skus[0] : null);
      if (!sku || !isSupportedProductSpecification(product.slug, sku.color, sku.size)) throw new Error("SKU_NOT_FOUND");

      const style=resolveProductStyle(product.quantityPricing,input.style)?.key??'';
      const lineKey=JSON.stringify([sku.id,style]);
      const unitPriceCents=productStylePrice(product.quantityPricing,style,sku.priceCents);
      const previous = stagedItems.get(lineKey);
      const nextQuantity = (previous?.quantity ?? 0) + input.quantity;
      if (nextQuantity > 99) throw new Error("INVALID_QUANTITY");
      const sharedQuantity=[...stagedItems.values()].filter(i=>i.skuId===sku.id && i!==previous).reduce((n,i)=>n+i.quantity,0)+nextQuantity;
      if (sku.stockQuantity - sku.reservedQuantity < sharedQuantity) throw new Error("INSUFFICIENT_INVENTORY");
      stagedItems.set(lineKey, {
        skuId:sku.id,style,
        id: previous?.id ?? `new:${lineKey}`,
        productId: product.id,
        product,
        quantity: nextQuantity,
        unitPriceCents,
      });
      selectedSkus.set(lineKey, { id: sku.id, style,priceCents: unitPriceCents });
    }

    calculateCartPricing([...stagedItems.values()]);
    for (const [lineKey, sku] of selectedSkus) {
      const skuId=sku.id;
      const staged = stagedItems.get(lineKey);
      if (!staged) throw new Error("SKU_NOT_FOUND");
      await tx.cartItem.upsert({
        where: { cartId_skuId_style: { cartId: cart.id, skuId, style:sku.style } },
        update: { quantity: staged.quantity, unitPriceCents: sku.priceCents },
        create: { cartId: cart.id, skuId, style:sku.style,quantity: staged.quantity, unitPriceCents: sku.priceCents },
      });
    }

    const updated = await tx.cart.findUnique({ where: { id: cart.id }, include: cartInclude });
    if (!updated) throw new Error("CART_NOT_FOUND");
    return summarizePrismaCart(updated);
  }, { isolationLevel: "Serializable", maxWait: 5_000, timeout: 10_000 });
}

export async function updateCartItem(key: string, itemId: string, quantity: number, userId?: string) {
  const commerceMode = await getCommerceMode();
  if (!isPrismaCommerceStorage()) {
    if (quantity === 0) return summarizeCart(updateRuntimeCartItem(key, itemId, quantity));
    const item = getRuntimeCart(key).items.find((candidate) => candidate.id === itemId);
    if (!item) throw new Error("CART_ITEM_NOT_FOUND");
    const sku = await resolveRuntimeSku({ productSlug: item.productSlug, color: item.color, size: item.size, quantity });
    assertProductPurchasable(sku.releaseProduct, commerceMode);
    return summarizeCart(updateRuntimeCartItem(key, itemId, quantity, sku.stockQuantity - sku.reservedQuantity));
  }
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99) throw new Error("INVALID_QUANTITY");

  return prisma.$transaction(async tx => {
  const cart = await tx.cart.findFirst({ where: userId ? { userId } : { guestKey: key }, include: cartInclude });
  if (!cart) throw new Error("CART_NOT_FOUND");
  const item = cart.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error("CART_ITEM_NOT_FOUND");
  if (quantity > 0 && !isSupportedProductSpecification(item.sku.product.slug, item.sku.color, item.sku.size)) throw new Error("SKU_NOT_FOUND");
  if (quantity > 0) assertProductPurchasable(item.sku.product, commerceMode);
  const sharedQuantity=cart.items.filter(i=>i.skuId===item.skuId && i.id!==itemId).reduce((n,i)=>n+i.quantity,0)+quantity;
  if (quantity>0 && sharedQuantity > item.sku.stockQuantity - item.sku.reservedQuantity) throw new Error("INSUFFICIENT_INVENTORY");
  calculateCartPricing(cart.items
    .filter((candidate) => candidate.id !== itemId || quantity > 0)
    .map((candidate) => candidate.id === itemId ? toPricingItem(candidate, quantity) : toPricingItem(candidate)));

  if (quantity === 0) {
    await tx.cartItem.delete({ where: { id: itemId } });
  } else {
    await tx.cartItem.update({
      where: { id: itemId },
      data: { quantity,unitPriceCents:productStylePrice(item.sku.product.quantityPricing,item.style,item.sku.priceCents) },
    });
  }

  const updated = await tx.cart.findUnique({where:{id:cart.id},include:cartInclude});
  if (!updated) throw new Error("CART_NOT_FOUND");
  return summarizePrismaCart(updated);
  }, { isolationLevel: "Serializable" });
}

export async function replaceCartItemVariant(key: string, itemId: string, input: CartItemInput, userId: string) {
  if (!isPrismaCommerceStorage()) throw new Error("VARIANT_REPLACEMENT_REQUIRES_PRISMA");
  const commerceMode = await getCommerceMode();
  return prisma.$transaction(async tx => {
    const cart = await tx.cart.findUnique({ where:{userId},include:cartInclude });
    if (!cart) throw new Error("CART_NOT_FOUND");
    const source = cart.items.find(item=>item.id===itemId);
    if (!source || source.sku.product.slug!==input.productSlug) throw new Error("CART_ITEM_NOT_FOUND");
    if (source.quantity!==(input.expectedQuantity??input.quantity)) throw new Error("CART_CHANGED");
    const sku = await tx.productSku.findFirst({where:{productId:source.sku.productId,color:input.color,size:input.size,status:"ACTIVE"},include:{product:true}});
    if(!sku || sku.product.status!=="ACTIVE" || !isSupportedProductSpecification(sku.product.slug,sku.color,sku.size))throw new Error("SKU_NOT_FOUND");
    assertProductPurchasable(sku.product,commerceMode);
    const style=resolveProductStyle(sku.product.quantityPricing,input.style)?.key??'';
    const unitPriceCents=productStylePrice(sku.product.quantityPricing,style,sku.priceCents);
    const other = cart.items.find(item=>item.skuId===sku.id&&item.style===style&&item.id!==itemId);
    if(!Number.isInteger(input.quantity)||input.quantity<1||input.quantity>99)throw Error("INVALID_QUANTITY");
    const quantity=input.quantity+(other?.quantity??0);
    if(quantity>99)throw Error("INVALID_QUANTITY");
    const sharedQuantity=cart.items.filter(i=>i.skuId===sku.id&&i.id!==itemId&&i.id!==other?.id).reduce((n,i)=>n+i.quantity,0)+quantity;
    if(sharedQuantity>sku.stockQuantity-sku.reservedQuantity)throw new Error("INSUFFICIENT_INVENTORY");
    calculateCartPricing([
      ...cart.items.filter(item=>item.id!==itemId&&item.id!==other?.id).map(item=>toPricingItem(item)),
      {id:itemId,productId:sku.productId,product:sku.product,style,quantity,unitPriceCents},
    ]);
    if(sku.id!==source.skuId||style!==source.style)await tx.cartItem.delete({where:{id:itemId}});
    await tx.cartItem.upsert({where:{cartId_skuId_style:{cartId:cart.id,skuId:sku.id,style}},
      create:{cartId:cart.id,skuId:sku.id,style,quantity,unitPriceCents},
      update:{quantity,unitPriceCents},
    });
    const updated=await tx.cart.findUniqueOrThrow({where:{id:cart.id},include:cartInclude});
    return summarizePrismaCart(updated);
  },{isolationLevel:"Serializable"});
}

async function resolveRuntimeSku(input: CartItemInput): Promise<RuntimeResolvedSku & { releaseProduct: { saleMode?: string | null; saleStartsAt?: Date | string | null; estimatedShipAt?: Date | string | null; countdownEnabled?: boolean | null; showPrice?: boolean | null } }> {
  const product = (await listAdminProducts()).find((candidate) => candidate.slug === input.productSlug && candidate.status === "ACTIVE");
  if (!product) throw new Error("SKU_NOT_FOUND");
  const activeSkus = product.skus.filter((sku) => sku.status === "ACTIVE" && isSupportedProductSpecification(product.slug, sku.color, sku.size));
  const sku = activeSkus.find((candidate) => (!input.color || candidate.color === input.color) && (!input.size || candidate.size === input.size)) ?? (!input.color && !input.size ? activeSkus[0] : null);
  if (!sku) throw new Error("SKU_NOT_FOUND");
  return {
    product: { slug: product.slug, code: product.code, name: product.name, image: product.image ?? product.images?.[0]?.imageUrl ?? "", priceCents: sku.priceCents },
    skuCode: sku.skuCode,
    color: sku.color,
    size: sku.size,
    stockQuantity: sku.stockQuantity,
    reservedQuantity: sku.reservedQuantity,
    releaseProduct: product,
  };
}

export async function clearCart(key: string, userId?: string) {
  if (!isPrismaCommerceStorage()) {
    const cart = getRuntimeCart(key);
    cart.items = [];
    cart.updatedAt = new Date();
    return;
  }

  const cart = await loadPrismaCartByContext(key, userId);
  if (cart) await prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
}

async function ensurePrismaCartByContext(key: string, userId?: string) {
  if (userId) return ensurePrismaUserCart(userId);
  return ensurePrismaGuestCart(key);
}

async function ensurePrismaGuestCart(guestKey: string) {
  return prisma.cart.upsert({
    where: { guestKey },
    update: {},
    create: { guestKey },
    include: cartInclude,
  });
}

async function ensurePrismaUserCart(userId: string) {
  const existing = await prisma.cart.findFirst({
    where: { userId },
    include: cartInclude,
  });
  if (existing) return existing;
  return prisma.cart.create({
    data: { userId },
    include: cartInclude,
  });
}

async function mergePrismaGuestCartIntoUserCart(guestKey: string, userId: string) {
  await prisma.$transaction(async (tx) => {
    const guestCart = await tx.cart.findFirst({
      where: { guestKey },
      include: { items: { include: { sku: { include: { product: true } } } } },
    });
    const userCart =
      (await tx.cart.findFirst({ where: { userId }, include: { items: { include: { sku: { include: { product: true } } } } } })) ??
      (await tx.cart.create({ data: { userId }, include: { items: { include: { sku: { include: { product: true } } } } } }));

    if (guestCart && guestCart.id !== userCart.id) {
      const staged=userCart.items.map(i=>({...toPricingItem(i),skuId:i.skuId}));
      for(const item of guestCart.items){
        const style=resolveProductStyle(item.sku.product.quantityPricing,item.style)?.key??'';
        const existing=staged.find(i=>i.skuId===item.skuId&&i.style===style);
        const quantity=(existing?.quantity??0)+item.quantity;
        const shared=staged.filter(i=>i.skuId===item.skuId&&i!==existing).reduce((n,i)=>n+i.quantity,0)+quantity;
        if(shared>item.sku.stockQuantity-item.sku.reservedQuantity)throw Error('INSUFFICIENT_INVENTORY');
        const unitPriceCents=productStylePrice(item.sku.product.quantityPricing,style,item.sku.priceCents);
        if(existing){existing.quantity=quantity;existing.unitPriceCents=unitPriceCents;}else staged.push({...toPricingItem(item),skuId:item.skuId,style,quantity,unitPriceCents});
        calculateCartPricing(staged);
        await tx.cartItem.upsert({where:{cartId_skuId_style:{cartId:userCart.id,skuId:item.skuId,style}},create:{cartId:userCart.id,skuId:item.skuId,style,quantity,unitPriceCents},update:{quantity,unitPriceCents}});
      }
      await tx.cartItem.deleteMany({ where: { cartId: guestCart.id } });
    }
  });
}

async function loadPrismaCartByContext(key: string, userId?: string) {
  if (userId) {
    return prisma.cart.findFirst({
      where: { userId },
      include: cartInclude,
    });
  }

  return prisma.cart.findFirst({
    where: { guestKey: key },
    include: cartInclude,
  });
}

async function loadPrismaCartById(id: string) {
  return prisma.cart.findUnique({
    where: { id },
    include: cartInclude,
  });
}

const cartInclude = {
  items: {
    include: {
      sku: {
        include: {
          product: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  },
} as const;

function summarizePrismaCart(cart: PrismaCartWithItems) {
  const items = cart.items.map((item) => ({
    id: item.id,
    productSlug: item.sku.product.slug,
    skuCode: item.sku.skuCode,
    productCode: toPublicProductCode(item.sku.product.code),
    productName: productStyleName(item.sku.product.name,item.sku.product.quantityPricing,item.style),
    style:item.style,styleLabel:resolveProductStyle(item.sku.product.quantityPricing,item.style)?.label??'',
    productImage: item.sku.product.slug === "x1-air-white"
      ? getX1AirWhiteOfferImage(item.sku.color, item.quantity) ?? (item.sku.product.image || "/assets/brand/product-placeholder.webp")
      : "/assets/brand/product-placeholder.webp",
    color: item.sku.color,
    size: item.sku.size,
    quantity: item.quantity,
    availableQuantity: Math.max(0,item.sku.stockQuantity-item.sku.reservedQuantity),
    unitPriceCents: productStylePrice(item.sku.product.quantityPricing,item.style,item.sku.priceCents),
    maxProductQuantity: parseQuantityPricing(item.sku.product.quantityPricing)?.maxQuantity ?? 99,
  }));
  const pricing = calculateCartPricing(cart.items.map((item) => toPricingItem(item)));

  return {
    key: cart.userId ? getRuntimeUserCartKey(cart.userId) : (cart.guestKey ?? cart.id),
    items,
    updatedAt: cart.updatedAt,
    subtotalCents: pricing.subtotalCents,
    discountCents: pricing.discountCents,
    payableAmountCents: pricing.payableAmountCents,
    itemCount: items.reduce((total, item) => total + item.quantity, 0),
  };
}

function toPublicProductCode(code: string) {
  const retiredPrefix = ["T", "C", "-"].join("");
  return code.replace(new RegExp(`^${retiredPrefix}`, "i"), "VK-");
}

function toPricingItem(item: PrismaCartWithItems["items"][number], quantity = item.quantity) {
  return {
    id: item.id,
    productId: item.sku.productId,
    product: item.sku.product,
    quantity,
    style:item.style,
    unitPriceCents: productStylePrice(item.sku.product.quantityPricing,item.style,item.sku.priceCents),
  };
}

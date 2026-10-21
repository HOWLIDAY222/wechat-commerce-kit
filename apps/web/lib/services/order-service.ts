import { attachOrderPickups, createOrderPickup, orderUsesPickup, requirePickupPoint } from '@/lib/services/offline-pickup-service';
import type { PickupChoice } from '@/lib/commerce/offline-pickup';
import { getOrderRefundSummary } from "@/lib/services/wechat-refund-read-model";
import { withOrderItemProductImage } from "@/lib/commerce/order-product-images";
import type { Prisma } from "@prisma/client";
import { completeMemberOrder, getMemberPricing, holdMemberCoupon, releaseMemberCoupon } from "@/lib/services/membership-service";
import {snapshotOrderPoints} from "@/lib/services/member-points-service";
import {cancelGiftOrder} from "@/lib/services/gift-card-service";
import {directOrderReceipt,type DirectPurchaseSelection} from "@/lib/commerce/direct-checkout";
import {resolveDirectPurchaseItem} from "@/lib/services/direct-checkout-service";
import { isSupportedProductSpecification } from "@/lib/commerce/x1-specifications";
import {productStylePrice,productStyleName} from "@/lib/commerce/product-style";
import { randomInt } from "node:crypto";
import { appConfig } from "@/lib/config";
import { prisma } from "@/lib/db/prisma";
import { getWeChatShippingOrder } from "@/lib/providers/wechat-shipping";
import { getAdminBusinessOrderFilter } from "@/lib/services/admin-business-orders";
import { assertProductPurchasable, getCommerceMode } from "@/lib/commerce/release-control";
import { getShippingRateConfig } from "@/lib/commerce/shipping";
import { calculateShippingQuote } from "@/lib/commerce/shipping-rates";
import { writeRuntimeAdminAudit } from "@/lib/services/admin-ops-service";
import {
  cancelRuntimeOrderForUser,
  confirmRuntimeOrderReceiptForUser,
  createRuntimeOrder,
  getRuntimeOrderForUser,
  listAllRuntimeOrders,
  listRuntimeOrdersByUser,
  markRuntimeOrderPaymentPendingForUser,
  updateRuntimeOrderForAdmin,
  type RuntimeFulfillmentStatus,
  type RuntimeOrderStatus,
  type RuntimeResolvedSku,
} from "@/lib/runtime-commerce";
import { listAdminProducts } from "@/lib/services/admin-catalog-service";

import { addCartItem, getCartSummary, resolveCartKey } from "@/lib/services/cart-service";

type OrderInput = PickupChoice & {
  directSelection?: DirectPurchaseSelection;
  requestId?: string;
  source?: "WEB" | "MINIPROGRAM";
  userId: string;
  addressId?: string;
  useCoupons?: boolean;
  expectedPayableCents?: number;
  customerName?: string;
  customerPhone?: string;
  addressSnapshot?: string;
  shippingProvince?: string;
};

type AdminOrderPatch = {
  status?: "CREATED" | "CONFIRMED" | "CANCELLED" | "CLOSED";
  fulfillmentStatus?: "PENDING" | "PROCESSING" | "SHIPPED" | "DELIVERED" | "RETURNED";
  trackingCompany?: string;
  trackingNo?: string;
  note?: string;
};

export type AdminOrderAction = {
  action: "confirm" | "cancel" | "ship" | "deliver" | "correct_tracking";
  trackingCompany?: string;
  trackingNo?: string;
  note?: string;
};

const orderInclude = {
  items: true,
  paymentIntents: true,
  afterSalesRequests: { include: { items: true, refunds: true } },
  refunds: true,
  shipments: true,
} as const;

const orderReadInclude = {
  ...orderInclude,
  items: {
    include: {
      product: {
        select: {
          slug: true,
          image: true,
          images: { select: { imageUrl: true }, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], take: 1 },
        },
      },
    },
  },
} satisfies Prisma.OrderInclude;

export async function createOrderFromCart(cartKey: string, input: OrderInput) {
  const pickupMode = input.deliveryMethod === 'PICKUP';
  if (pickupMode && (!input.addressId || !input.pickupPointVersion)) throw Error('ADDRESS_REQUIRED');
  const receipt = input.directSelection ? directOrderReceipt(input.userId, input.directSelection,
    pickupMode ? input.addressId + ':pickup:' + input.pickupPointVersion : input.addressId || '', input.requestId || '', input.expectedPayableCents ?? 0) : null;
  if (pickupMode && appConfig.COMMERCE_STORAGE !== 'prisma') throw Error('PICKUP_UNAVAILABLE');
  if(receipt&&appConfig.COMMERCE_STORAGE!=="prisma")throw Error("ORDER_QUOTE_REQUIRES_PRISMA");
  const commerceMode = await getCommerceMode();
  const shippingConfig = await getShippingRateConfig();
  if (!shippingConfig && !pickupMode) throw new Error("SHIPPING_FEE_CONFIGURATION_REQUIRED");
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const runtimeCart = await import("@/lib/runtime-commerce").then(({ getRuntimeCart }) => getRuntimeCart(cartKey));
    const products = await listAdminProducts();
    const validatedSkus = new Map<string, RuntimeResolvedSku>();
    for (const item of runtimeCart.items) {
      const product = products.find((candidate) => candidate.slug === item.productSlug && candidate.status === "ACTIVE");
      if (!product) throw new Error("SKU_NOT_FOUND");
      assertProductPurchasable(product, commerceMode);
      const sku = product.skus.find((candidate) => candidate.status === "ACTIVE" && candidate.skuCode === item.skuCode)
        ?? product.skus.find((candidate) => candidate.status === "ACTIVE" && candidate.color === item.color && candidate.size === item.size);
      if (!sku || !isSupportedProductSpecification(product.slug, sku.color, sku.size)) throw new Error("SKU_NOT_FOUND");
      validatedSkus.set(item.skuCode, {
        product: { slug: product.slug, code: product.code, name: product.name, image: product.image ?? product.images?.[0]?.imageUrl ?? "", priceCents: sku.priceCents },
        skuCode: sku.skuCode,
        color: sku.color,
        size: sku.size,
        stockQuantity: sku.stockQuantity,
        reservedQuantity: sku.reservedQuantity,
      });
    }
    const customer = requireLegacyOrderCustomer(input);
    const shippingFeeCents = calculateShippingQuote(customer.shippingProvince, shippingConfig!).feeCents;
    return createRuntimeOrder(cartKey, { ...customer, userId: input.userId, addressSnapshot: `${customer.shippingProvince}${customer.addressSnapshot}` }, shippingFeeCents, validatedSkus);
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (tx) => {
        if(receipt){
          const existingReceipt=await tx.auditLog.findUnique({where:{id:receipt.id}});
          if(existingReceipt){
            const detail=existingReceipt.detail as {requestHash?:string}|null;
            if(existingReceipt.actorId!==input.userId||!existingReceipt.targetId||detail?.requestHash!==receipt.hash)throw Error('ORDER_REQUEST_CHANGED');
            const existing=await tx.order.findFirst({where:{id:existingReceipt.targetId,userId:input.userId},include:orderInclude});
            if(!existing)throw Error('ORDER_REQUEST_CHANGED');
            return existing;
          }
        }
        const cart = input.directSelection ? {id:'',items:[await resolveDirectPurchaseItem(tx,input.directSelection)]} : await tx.cart.findFirst({
          where: { userId: input.userId },
          include: {
            items: {
              include: {
                sku: {
                  include: {
                    product: true,
                  },
                },
              },
            },
          },
        });
        if (!cart || cart.items.length === 0) throw new Error("CART_EMPTY");

        const customer = input.addressId
          ? await resolvePrismaOrderAddress(tx, input.userId, input.addressId)
          : requireLegacyOrderCustomer(input);
        const pickupAddress = pickupMode ? await tx.address.findFirst({ where: { id: input.addressId, userId: input.userId } }) : null;
        if (pickupMode) await tx.$queryRaw`SELECT key FROM site_settings WHERE key = 'offlinePickup' FOR SHARE`;
        const pickupPoint = pickupMode ? await requirePickupPoint(tx, input.pickupPointVersion, pickupAddress) : null;
        const shippingFeeCents = pickupMode ? 0 : calculateShippingQuote(customer.shippingProvince, shippingConfig!).feeCents;

        for (const item of cart.items) {
          if (!isSupportedProductSpecification(item.sku.product.slug, item.sku.color, item.sku.size) || item.sku.status !== "ACTIVE" || item.sku.product.status !== "ACTIVE") throw new Error("SKU_NOT_FOUND");
          assertProductPurchasable(item.sku.product, commerceMode);
          if (productStylePrice(item.sku.product.quantityPricing,item.style,item.sku.priceCents) !== item.unitPriceCents) throw new Error("PRICE_CHANGED");
          if (item.sku.stockQuantity - item.sku.reservedQuantity < cart.items.filter(i=>i.skuId===item.skuId).reduce((n,i)=>n+i.quantity,0)) throw new Error("INSUFFICIENT_INVENTORY");
        }

        const pricing = await getMemberPricing(tx, input.userId, cart.items.map((item) => ({
          id: item.id,
          productId: item.sku.productId,
          product: item.sku.product,
          style:item.style,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
        })), Boolean(input.useCoupons));
        if (input.expectedPayableCents !== undefined && input.expectedPayableCents !== pricing.payableAmountCents + shippingFeeCents) throw new Error("PRICE_CHANGED");
        const orderNo = createPrismaOrderNo();
        const order = await tx.order.create({
          data: {
            orderNo,
            source: input.source ?? null,
            memberPointsPolicy: await snapshotOrderPoints(tx,input.userId),
            userId: input.userId,
            addressId: input.addressId,
            customerName: customer.customerName,
            customerPhone: customer.customerPhone,
            addressSnapshot: `${customer.shippingProvince}${customer.addressSnapshot}`,
            subtotalCents: pricing.subtotalCents,
            discountCents: pricing.discountCents,
            couponClaimId: pricing.couponClaimId,
            discountLabel: pricing.discountLabel,
            shippingFeeCents,
            payableAmountCents: pricing.payableAmountCents + shippingFeeCents,
            currency: "CNY",
            items: {
              create: cart.items.map((item) => ({
                productId: item.sku.productId,
                skuId: item.skuId,
                productCode: item.sku.product.code,
                productName: productStyleName(item.sku.product.name,item.sku.product.quantityPricing,item.style),
                style:item.style,
                color: item.sku.color,
                size: item.sku.size,
                quantity: item.quantity,
                unitPriceCents: item.unitPriceCents,
                discountShareCents: pricing.itemDiscountShares[item.id] ?? 0,
              })),
            },
          },
          include: orderInclude,
        });

        if (pickupPoint) await createOrderPickup(tx, order.id, pickupPoint);
        await holdMemberCoupon(tx, pricing.couponClaimId, input.userId, order.id);
        for (const item of cart.items) {
          await tx.productSku.update({
            where: { id: item.skuId },
            data: { reservedQuantity: { increment: item.quantity } },
          });
          await tx.inventoryLog.create({
            data: {
              skuId: item.skuId,
              action: "RESERVE",
              quantity: item.quantity,
              note: `Order ${orderNo}`,
              actorId: input.userId,
            },
          });
        }

        if(!input.directSelection)await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        await tx.auditLog.create({
          data: {
            ...(receipt?{id:receipt.id}:{}),
            actorId: input.userId,
            actorType: "user",
            action: "order.created",
            targetType: "order",
            targetId: order.id,
            detail: { orderNo,...(receipt?{direct:true,requestHash:receipt.hash}:{}) },
          },
        });

        return order;
      }, {
        isolationLevel: "Serializable",
        maxWait: 5_000,
        timeout: 30_000,
      });
    } catch (error) {
      if (attempt < 3 && (isRetryableOrderTransactionError(error)||(receipt&&typeof error==='object'&&error!==null&&'code' in error&&error.code==='P2002'))) continue;
      throw error;
    }
  }

  throw new Error("ORDER_TRANSACTION_RETRY_EXHAUSTED");
}

export async function listOrdersByUser(userId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") return listRuntimeOrdersByUser(userId);

  const orders = await prisma.order.findMany({
    where: { userId },
    include: orderReadInclude,
    orderBy: { createdAt: "desc" },
  });
  return attachOrderPickups(orders.map((order) => ({ ...order, items: order.items.map(withOrderItemProductImage) })));
}

export async function getOrderQuoteForUser(userId: string, addressId: string, useCoupons = false, province?: string, delivery: PickupChoice = {}) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") throw new Error("ORDER_QUOTE_REQUIRES_PRISMA");
  const commerceMode = await getCommerceMode();
  const shippingConfig = await getShippingRateConfig();
  if (!shippingConfig && delivery.deliveryMethod !== "PICKUP") throw new Error("SHIPPING_FEE_CONFIGURATION_REQUIRED");
  const address = addressId ? await prisma.address.findFirst({ where: { id: addressId, userId } }) : province ? { province } : null;
  if (!address) throw new Error("ADDRESS_NOT_FOUND");
  if (delivery.deliveryMethod === 'PICKUP') {
    const ownedAddress = await prisma.address.findFirst({ where: { id: addressId, userId } });
    await requirePickupPoint(prisma, delivery.pickupPointVersion, ownedAddress);
  }
  const shippingFeeCents = delivery.deliveryMethod === 'PICKUP' ? 0 : calculateShippingQuote(address.province, shippingConfig!).feeCents;
  const cart = await prisma.cart.findFirst({ where: { userId }, include: {
    items: { include: { sku: { include: { product: true } } } },
  } });
  if (!cart || cart.items.length === 0) throw new Error("CART_EMPTY");
  for (const item of cart.items) {
    if (!isSupportedProductSpecification(item.sku.product.slug, item.sku.color, item.sku.size) || item.sku.status !== "ACTIVE" || item.sku.product.status !== "ACTIVE") throw new Error("SKU_NOT_FOUND");
    assertProductPurchasable(item.sku.product, commerceMode);
    if (productStylePrice(item.sku.product.quantityPricing,item.style,item.sku.priceCents) !== item.unitPriceCents) throw new Error("PRICE_CHANGED");
    if (item.sku.stockQuantity - item.sku.reservedQuantity < cart.items.filter(i=>i.skuId===item.skuId).reduce((n,i)=>n+i.quantity,0)) throw new Error("INSUFFICIENT_INVENTORY");
  }
  const pricing = await getMemberPricing(prisma, userId, cart.items.map(item => ({id:item.id,productId:item.sku.productId,product:item.sku.product,style:item.style,quantity:item.quantity,unitPriceCents:item.unitPriceCents})), useCoupons);
  return { currency:"CNY",itemCount:cart.items.reduce((sum,item)=>sum+item.quantity,0),subtotalCents:pricing.subtotalCents,
    discountCents:pricing.discountCents,discountLabel:pricing.discountLabel,couponClaimId:pricing.couponClaimId,shippingFeeCents,payableAmountCents:pricing.payableAmountCents+shippingFeeCents };
}

export async function getOrderForUser(orderNo: string, userId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") return getRuntimeOrderForUser(orderNo, userId);

  const order = await prisma.order.findFirst({
    // WeChat's order-center path substitutes out_trade_no, which identifies a
    // payment attempt rather than necessarily matching our store order number.
    where: {
      userId,
      OR: [
        { orderNo },
        { paymentIntents: { some: { provider: "WECHAT_PAY", merchantOrderNo: orderNo } } },
      ],
    },
    include: orderReadInclude,
  });
  return order ? (await attachOrderPickups([{ ...order, items: order.items.map(withOrderItemProductImage), refundSummary: await getOrderRefundSummary(order.id) }], true))[0] : null;
}

export async function listOrdersForAdmin() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") return listAllRuntimeOrders();

  const orders = await prisma.order.findMany({
    where: await getAdminBusinessOrderFilter(),
    include: orderInclude,
    orderBy: { createdAt: "desc" },
  });
  return attachOrderPickups(orders);
}

export async function cancelOrderForUser(orderNo: string, userId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") return cancelRuntimeOrderForUser(orderNo, userId);

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { orderNo, userId },
      include: { items: true },
    });
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (["PAID", "REFUNDED"].includes(order.paymentStatus)) throw new Error("PAID_ORDER_CANNOT_CANCEL");
    if (order.status === "CANCELLED") {
      await tx.paymentIntent.updateMany({
        where: {
          orderId: order.id,
          status: { in: ["CREATED", "REQUIRES_REDIRECT", "PENDING", "FAILED"] },
        },
        data: { status: "CANCELLED" },
      });
      return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
    }

    for (const item of order.kind==='GIFT_PURCHASE'?[]:order.items) {
      await tx.productSku.update({
        where: { id: item.skuId },
        data: { reservedQuantity: { decrement: item.quantity } },
      });
      await tx.inventoryLog.create({
        data: {
          skuId: item.skuId,
          action: "RELEASE",
          quantity: item.quantity,
          note: `Cancel order ${orderNo}`,
          actorId: userId,
        },
      });
    }

    await cancelGiftOrder(tx,order.id);
    await releaseMemberCoupon(tx, order.id);
    const cancelled = await tx.order.update({
      where: { id: order.id },
      data: {
        status: "CANCELLED",
        paymentStatus: "CANCELLED",
      },
      include: orderInclude,
    });
    await tx.paymentIntent.updateMany({
      where: {
        orderId: order.id,
        status: { in: ["CREATED", "REQUIRES_REDIRECT", "PENDING", "FAILED"] },
      },
      data: { status: "CANCELLED" },
    });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorType: "user",
        action: "order.cancelled",
        targetType: "order",
        targetId: order.id,
        detail: { orderNo },
      },
    });

    return cancelled;
  }, { isolationLevel: "Serializable" });
}

export async function markOrderPaymentPendingForUser(orderNo: string, userId: string) {
  const commerceMode = await getCommerceMode();
  assertProductPurchasable({ saleMode: "IN_STOCK" }, commerceMode);
  if (appConfig.COMMERCE_STORAGE !== "prisma") return markRuntimeOrderPaymentPendingForUser(orderNo, userId);

  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findFirst({
      where: { orderNo, userId },
    });
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (order.status === "CANCELLED") throw new Error("CANCELLED_ORDER_CANNOT_PAY");
    if (order.paymentStatus === "PAID") throw new Error("ORDER_ALREADY_PAID");
    if (order.paymentStatus === "CANCELLED") throw new Error("CANCELLED_ORDER_CANNOT_PAY");

    const updated = await tx.order.update({
      where: { id: order.id },
      data: { paymentStatus: "PENDING" },
      include: orderInclude,
    });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorType: "user",
        action: "order.payment.pending",
        targetType: "order",
        targetId: order.id,
        detail: { orderNo },
      },
    });
    return updated;
  });
}

export async function confirmOrderReceiptForUser(orderNo: string, userId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") return confirmRuntimeOrderReceiptForUser(orderNo, userId);

  const initial = await prisma.order.findFirst({ where: { orderNo, userId }, select: { paymentStatus: true, status: true } });
  if (!initial) throw new Error("ORDER_NOT_FOUND");
  const pickupOrder = await prisma.order.findFirst({ where: { orderNo, userId }, select: { id: true } });
  if (pickupOrder && await orderUsesPickup(prisma, pickupOrder.id)) throw Error('PICKUP_USE_COLLECTION_CODE');
  if (initial.paymentStatus !== "PAID") throw new Error("UNPAID_ORDER_RECEIPT_FORBIDDEN");
  if (initial.status !== "CONFIRMED") throw new Error("ORDER_CONFIRMATION_REQUIRED_BEFORE_RECEIPT");

  const payment = await prisma.paymentIntent.findFirst({ where: { order: { orderNo, userId }, provider: "WECHAT_PAY", status: "PAID" } });
  if (payment) {
    if (!payment.gatewayTradeNo) throw new Error("WECHAT_RECEIPT_NOT_CONFIRMED");
    const remote = await getWeChatShippingOrder(payment.gatewayTradeNo);
    if (remote.merchant_trade_no !== payment.merchantOrderNo || ![3, 4].includes(remote.order_state)) throw new Error("WECHAT_RECEIPT_NOT_CONFIRMED");
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM orders WHERE order_no = ${orderNo} AND user_id = ${userId} FOR UPDATE`;
    const order = await tx.order.findFirst({
      where: { orderNo, userId },
      include: { shipments: true },
    });
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (order.paymentStatus !== "PAID") throw new Error("UNPAID_ORDER_RECEIPT_FORBIDDEN");
    if (order.status !== "CONFIRMED") throw new Error("ORDER_CONFIRMATION_REQUIRED_BEFORE_RECEIPT");
    if (order.fulfillmentStatus === "DELIVERED") {
      await completeMemberOrder(tx,order.id);
      return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: orderInclude });
    }
    if (order.fulfillmentStatus !== "SHIPPED") throw new Error("ORDER_NOT_SHIPPED");

    const deliveredAt = new Date();
    await tx.shipment.updateMany({
      where: { orderId: order.id, status: "SHIPPED" },
      data: { status: "DELIVERED", deliveredAt },
    });
    const updated = await tx.order.update({
      where: { id: order.id },
      data: { fulfillmentStatus: "DELIVERED" },
      include: orderInclude,
    });
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorType: "user",
        action: "order.receipt.confirmed",
        targetType: "order",
        targetId: order.id,
        detail: { orderNo, deliveredAt: deliveredAt.toISOString() },
      },
    });
    await completeMemberOrder(tx,order.id);
    return updated;
  });
}

export async function repurchaseOrderForUser(orderNo: string, userId: string) {
  const order = appConfig.COMMERCE_STORAGE === "prisma"
    ? await prisma.order.findFirst({
      where: { orderNo, userId },
      include: { items: { include: { product: true } } },
    })
    : getRuntimeOrderForUser(orderNo, userId);
  if (!order) throw new Error("ORDER_NOT_FOUND");

  const cartKey = await resolveCartKey(undefined, userId);
  if('kind' in order&&order.kind==='GIFT_PURCHASE')throw Error('GIFT_PURCHASE_USE_GIFT_WALLET');
  const skippedItems: Array<{ productName: string; reason: string }> = [];
  let addedItemCount = 0;
  for (const item of order.items) {
    const productSlug = "product" in item ? item.product.slug : item.productSlug;
    try {
      await addCartItem(cartKey, {
        productSlug,
        style:"style" in item ? item.style as string : undefined,
        color: item.color,
        size: item.size,
        quantity: item.quantity,
      }, userId);
      addedItemCount += item.quantity;
    } catch (error) {
      skippedItems.push({
        productName: item.productName,
        reason: error instanceof Error ? error.message : "REPURCHASE_ITEM_UNAVAILABLE",
      });
    }
  }

  if (addedItemCount === 0) throw new Error(skippedItems[0]?.reason || "REPURCHASE_ITEMS_UNAVAILABLE");
  return {
    addedItemCount,
    skippedItems,
    cart: await getCartSummary(cartKey, userId),
  };
}

export async function performAdminOrderAction(orderNo: string, input: AdminOrderAction, actorId: string) {
  if (input.action === "confirm") return updateOrderForAdmin(orderNo, { status: "CONFIRMED", note: input.note }, actorId);
  if (input.action === "cancel" && appConfig.COMMERCE_STORAGE === "prisma") {
    const current = await prisma.order.findUniqueOrThrow({ where: { orderNo } });
    if (current.couponClaimId||current.kind!=='STANDARD') {
      const order = await cancelOrderForUser(orderNo, current.userId);
      await prisma.auditLog.create({ data: { actorId, actorType: "admin", action: "admin.coupon_order.cancelled", targetType: "order", targetId: order.id } });
      return order;
    }
  }
  if (input.action === "cancel") return updateOrderForAdmin(orderNo, { status: "CANCELLED", note: input.note }, actorId);
  if (input.action === "correct_tracking") {
    if (!input.trackingCompany?.trim() || !input.trackingNo?.trim() || !input.note?.trim()) throw Error("TRACKING_CORRECTION_NOTE_REQUIRED");
    return updateOrderForAdmin(orderNo, { trackingCompany:input.trackingCompany, trackingNo:input.trackingNo, note:input.note }, actorId);
  }
  if (input.action === "ship") {
    return updateOrderForAdmin(orderNo, {
      fulfillmentStatus: "SHIPPED",
      trackingCompany: input.trackingCompany,
      trackingNo: input.trackingNo,
      note: input.note,
    }, actorId);
  }
  if (input.action === "deliver") return updateOrderForAdmin(orderNo, { fulfillmentStatus: "DELIVERED", note: input.note }, actorId);
  throw new Error("ORDER_ACTION_NOT_SUPPORTED");
}

async function updateOrderForAdmin(orderNo: string, input: AdminOrderPatch, actorId: string) {
  if (appConfig.COMMERCE_STORAGE !== "prisma") {
    const currentOrder = listAllRuntimeOrders().find((candidate) => candidate.orderNo === orderNo);
    if (!currentOrder) throw new Error("ORDER_NOT_FOUND");
    if (!input.fulfillmentStatus && (input.trackingCompany || input.trackingNo)) throw Error("TRACKING_CORRECTION_REQUIRES_DATABASE");
    if (input.status) assertAdminOrderStatusAction(currentOrder.status, currentOrder.paymentStatus, input.status);
    if (input.fulfillmentStatus) {
      assertAdminFulfillmentAction(currentOrder.status, currentOrder.paymentStatus, currentOrder.fulfillmentStatus, input.fulfillmentStatus, input);
    }
    const order = updateRuntimeOrderForAdmin(orderNo, {
      status: input.status ? toRuntimeOrderStatus(input.status) : undefined,
      fulfillmentStatus: input.fulfillmentStatus ? toRuntimeFulfillmentStatus(input.fulfillmentStatus) : undefined,
      actorId,
      note: input.note,
    });
    writeRuntimeAdminAudit(actorId, "admin.order.updated", "order", order.orderNo, {
      orderNo,
      status: order.status,
      fulfillmentStatus: order.fulfillmentStatus,
      trackingCompany: input.trackingCompany,
      trackingNo: input.trackingNo,
      note: input.note,
    });
    return order;
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM orders WHERE order_no = ${orderNo} FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { orderNo },
      include: { shipments: true },
    });
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (!input.fulfillmentStatus && (input.trackingCompany || input.trackingNo) && (order.status !== "CONFIRMED" || order.paymentStatus !== "PAID" || order.fulfillmentStatus !== "SHIPPED")) throw Error("TRACKING_CORRECTION_NOT_ALLOWED");
    if(order.kind==='GIFT_PURCHASE')throw Error('GIFT_PURCHASE_USE_GIFT_WALLET');
    if (await orderUsesPickup(tx, order.id)) throw Error('PICKUP_USE_COLLECTION_CODE');

    const updateData: {
      status?: AdminOrderPatch["status"];
      fulfillmentStatus?: AdminOrderPatch["fulfillmentStatus"];
    } = {};
    if (input.status) {
      assertAdminOrderStatusAction(order.status, order.paymentStatus, input.status);
      updateData.status = input.status;
    }
    if (input.fulfillmentStatus) {
      assertAdminFulfillmentAction(order.status, order.paymentStatus, order.fulfillmentStatus, input.fulfillmentStatus, input);
      updateData.fulfillmentStatus = input.fulfillmentStatus;
    }

    if (input.fulfillmentStatus || input.trackingCompany || input.trackingNo) {
      const currentShipment = order.shipments[0];
      const shipmentData = {
        ...((input.trackingNo || input.trackingCompany) ? { wechatSyncedAt: null, wechatSyncError: null, wechatRetryAt: null, wechatSyncAttempts: 0 } : {}),
        status: input.fulfillmentStatus ?? order.fulfillmentStatus,
        trackingCompany: input.trackingCompany || currentShipment?.trackingCompany,
        trackingNo: input.trackingNo || currentShipment?.trackingNo,
        shippedAt:
          input.fulfillmentStatus === "SHIPPED" || input.fulfillmentStatus === "DELIVERED"
            ? (currentShipment?.shippedAt ?? new Date())
            : currentShipment?.shippedAt,
        deliveredAt: input.fulfillmentStatus === "DELIVERED" ? (currentShipment?.deliveredAt ?? new Date()) : currentShipment?.deliveredAt,
      };
      if (currentShipment) {
        await tx.shipment.update({
          where: { id: currentShipment.id },
          data: shipmentData,
        });
      } else {
        await tx.shipment.create({
          data: {
            orderId: order.id,
            ...shipmentData,
          },
        });
      }
    }

    const updated = await tx.order.update({
      where: { id: order.id },
      data: updateData,
      include: orderInclude,
    });
    if(updated.fulfillmentStatus==='DELIVERED')await completeMemberOrder(tx,order.id);
    await tx.auditLog.create({
      data: {
        actorId,
        actorType: "admin",
        action: "admin.order.updated",
        targetType: "order",
        targetId: order.id,
        detail: {
          orderNo,
          before: {
            status: order.status,
            fulfillmentStatus: order.fulfillmentStatus,
            trackingCompany: order.shipments[0]?.trackingCompany ?? null,
            trackingNo: order.shipments[0]?.trackingNo ?? null,
          },
          after: {
            status: updated.status,
            fulfillmentStatus: updated.fulfillmentStatus,
          },
          trackingCompany: input.trackingCompany,
          trackingNo: input.trackingNo,
          note: input.note,
        },
      },
    });

    return updated;
  });
}

function assertAdminOrderStatusAction(
  currentStatus: string,
  paymentStatus: string,
  nextStatus: NonNullable<AdminOrderPatch["status"]>,
) {
  const current = currentStatus.toUpperCase();
  const payment = paymentStatus.toUpperCase();
  if (current !== "CREATED") throw new Error("ORDER_STATUS_ACTION_NOT_AVAILABLE");
  if (nextStatus === "CONFIRMED" && payment === "PAID") return;
  if (nextStatus === "CANCELLED" && !["PAID", "REFUNDED"].includes(payment)) return;
  throw new Error("ORDER_STATUS_ACTION_NOT_ALLOWED");
}

function assertAdminFulfillmentAction(
  orderStatus: string,
  paymentStatus: string,
  currentStatus: string,
  nextStatus: NonNullable<AdminOrderPatch["fulfillmentStatus"]>,
  input: AdminOrderPatch,
) {
  const order = orderStatus.toUpperCase();
  const payment = paymentStatus.toUpperCase();
  const current = currentStatus.toUpperCase();
  if (payment !== "PAID") throw new Error("UNPAID_ORDER_SHIPMENT_FORBIDDEN");
  if (order === "CANCELLED" || order === "CLOSED") throw new Error("CLOSED_ORDER_SHIPMENT_FORBIDDEN");
  if (order !== "CONFIRMED") throw new Error("ORDER_CONFIRMATION_REQUIRED_BEFORE_SHIPMENT");
  if ((current === "PENDING" || current === "PROCESSING") && nextStatus === "SHIPPED") {
    if (!input.trackingCompany || !input.trackingNo) throw new Error("SHIPMENT_TRACKING_REQUIRED");
    return;
  }
  if (current === "SHIPPED" && nextStatus === "DELIVERED") return;
  throw new Error("FULFILLMENT_STATUS_ACTION_NOT_ALLOWED");
}

function createPrismaOrderNo() {
  const now = new Date();
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const time = String(now.getTime()).slice(-7);
  const nonce = String(randomInt(0, 100_000)).padStart(5, "0");
  return `TC${date}${time}${nonce}`;
}

function isRetryableOrderTransactionError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

function requireLegacyOrderCustomer(input: OrderInput) {
  if (!input.customerName || !input.customerPhone || !input.addressSnapshot || !input.shippingProvince) {
    throw new Error("INVALID_ORDER_REQUEST");
  }
  return {
    shippingProvince: input.shippingProvince,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    addressSnapshot: input.addressSnapshot,
  };
}

async function resolvePrismaOrderAddress(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  userId: string,
  addressId: string,
) {
  const address = await tx.address.findFirst({ where: { id: addressId, userId } });
  if (!address) throw new Error("ADDRESS_NOT_FOUND");
  return {
    customerName: address.name,
    customerPhone: address.phone,
    shippingProvince: address.province,
    addressSnapshot: [address.city, address.district, address.detail]
      .filter(Boolean)
      .join(""),
  };
}

function toRuntimeOrderStatus(status: NonNullable<AdminOrderPatch["status"]>): RuntimeOrderStatus {
  return status.toLowerCase() as RuntimeOrderStatus;
}

function toRuntimeFulfillmentStatus(status: NonNullable<AdminOrderPatch["fulfillmentStatus"]>): RuntimeFulfillmentStatus {
  return status.toLowerCase() as RuntimeFulfillmentStatus;
}

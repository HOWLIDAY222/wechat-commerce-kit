import { randomUUID } from "crypto";
import { assertAfterSalesTransition, type AfterSalesStatus } from "@/lib/after-sales/state-machine";
import { catalogProducts } from "@/lib/catalog";
import { calculateCartPricing } from "@/lib/commerce/quantity-pricing";
import { X1_AIR_WHITE_QUANTITY_PRICING } from "@/lib/commerce/x1-air-white-pricing";
import { getX1AirWhiteOfferImage } from "@/lib/commerce/x1-air-white-offers";

export type RuntimeCartItem = {
  style?: string;
  styleLabel?: string;
  id: string;
  productSlug: string;
  skuCode: string;
  productCode: string;
  productName: string;
  productImage: string;
  color: string;
  size: string;
  quantity: number;
  unitPriceCents: number;
};

export type RuntimeCart = {
  key: string;
  items: RuntimeCartItem[];
  updatedAt: Date;
};

export type RuntimeResolvedSku = {
  product: {
    slug: string;
    code: string;
    name: string;
    image: string;
    priceCents: number;
  };
  skuCode: string;
  color: string;
  size: string;
  stockQuantity: number;
  reservedQuantity: number;
};

export type RuntimeAddress = {
  id: string;
  userId: string;
  name: string;
  phone: string;
  province: string;
  city: string;
  district?: string;
  detail: string;
  postalCode?: string;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type RuntimeOrderStatus = "created" | "confirmed" | "cancelled" | "closed";
export type RuntimePaymentStatus = "not_started" | "pending" | "paid" | "failed" | "cancelled" | "refunded";
export type RuntimeFulfillmentStatus = "pending" | "processing" | "shipped" | "delivered" | "returned";
export type RuntimeAfterSalesType = "return_refund" | "exchange" | "refund_only" | "reship" | "quality_issue";

export type RuntimeAfterSalesItem = {
  orderItemId: string;
  productName: string;
  color: string;
  size: string;
  quantity: number;
  refundAmountCents: number;
};

export type RuntimeAfterSalesRequest = {
  id: string;
  afterSalesNo: string;
  userId: string;
  orderNo: string;
  type: RuntimeAfterSalesType;
  reason: string;
  description: string;
  status: AfterSalesStatus;
  items: RuntimeAfterSalesItem[];
  imageUrls: string[];
  refundAmountCents: number;
  rejectReason?: string;
  audit: Array<{
    action: string;
    actorId: string;
    actorType: "user" | "admin" | "system";
    createdAt: string;
    detail?: unknown;
  }>;
  createdAt: Date;
  updatedAt: Date;
};

export type RuntimeRefund = {
  id: string;
  refundNo: string;
  afterSalesNo: string;
  orderNo: string;
  userId: string;
  amountCents: number;
  currency: "CNY";
  status: "created" | "manual_marked" | "processing" | "succeeded" | "failed";
  orderItemIds: string[];
  createdBy: string;
  paymentRefundId?: string;
  failureReason?: string;
  createdAt: Date;
  completedAt?: Date;
  updatedAt: Date;
};

export type RuntimeReshipmentStatus = "created" | "processing" | "shipped" | "delivered" | "returned";

export type RuntimeReshipment = {
  id: string;
  reshipmentNo: string;
  afterSalesNo: string;
  orderNo: string;
  userId: string;
  status: RuntimeReshipmentStatus;
  items: RuntimeAfterSalesItem[];
  createdBy: string;
  trackingCompany?: string;
  trackingNo?: string;
  shippedAt?: Date;
  deliveredAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

export type RuntimeOrder = {
  id: string;
  orderNo: string;
  userId: string;
  status: RuntimeOrderStatus;
  paymentStatus: RuntimePaymentStatus;
  fulfillmentStatus: RuntimeFulfillmentStatus;
  customerName: string;
  customerPhone: string;
  addressSnapshot: string;
  subtotalCents: number;
  discountCents: number;
  shippingFeeCents: number;
  payableAmountCents: number;
  currency: "CNY";
  items: Array<RuntimeCartItem & { discountShareCents?: number }>;
  audit: Array<{ action: string; createdAt: string; detail?: unknown }>;
  createdAt: Date;
  updatedAt: Date;
};

const globalForRuntimeCommerce = globalThis as typeof globalThis & {
  __merchantkitRuntimeCarts?: Map<string, RuntimeCart>;
  __merchantkitRuntimeOrders?: Map<string, RuntimeOrder>;
  __merchantkitRuntimeAddresses?: Map<string, RuntimeAddress[]>;
  __merchantkitRuntimeAfterSalesRequests?: Map<string, RuntimeAfterSalesRequest>;
  __merchantkitRuntimeRefunds?: Map<string, RuntimeRefund>;
  __merchantkitRuntimeReshipments?: Map<string, RuntimeReshipment>;
  __merchantkitRuntimeRefundedOrderItemIds?: Set<string>;
};

const carts = globalForRuntimeCommerce.__merchantkitRuntimeCarts ?? new Map<string, RuntimeCart>();
const orders = globalForRuntimeCommerce.__merchantkitRuntimeOrders ?? new Map<string, RuntimeOrder>();
const addresses = globalForRuntimeCommerce.__merchantkitRuntimeAddresses ?? new Map<string, RuntimeAddress[]>();
const afterSalesRequests = globalForRuntimeCommerce.__merchantkitRuntimeAfterSalesRequests ?? new Map<string, RuntimeAfterSalesRequest>();
const refunds = globalForRuntimeCommerce.__merchantkitRuntimeRefunds ?? new Map<string, RuntimeRefund>();
const reshipments = globalForRuntimeCommerce.__merchantkitRuntimeReshipments ?? new Map<string, RuntimeReshipment>();
const refundedOrderItemIds = globalForRuntimeCommerce.__merchantkitRuntimeRefundedOrderItemIds ?? new Set<string>();
globalForRuntimeCommerce.__merchantkitRuntimeCarts = carts;
globalForRuntimeCommerce.__merchantkitRuntimeOrders = orders;
globalForRuntimeCommerce.__merchantkitRuntimeAddresses = addresses;
globalForRuntimeCommerce.__merchantkitRuntimeAfterSalesRequests = afterSalesRequests;
globalForRuntimeCommerce.__merchantkitRuntimeRefunds = refunds;
globalForRuntimeCommerce.__merchantkitRuntimeReshipments = reshipments;
globalForRuntimeCommerce.__merchantkitRuntimeRefundedOrderItemIds = refundedOrderItemIds;

export function createRuntimeCartKey() {
  return `guest_${randomUUID()}`;
}

export function getRuntimeUserCartKey(userId: string) {
  return `user_${userId}`;
}

export function getRuntimeCart(key: string): RuntimeCart {
  const cart = carts.get(key);
  if (cart) return cart;

  const emptyCart = { key, items: [], updatedAt: new Date() };
  carts.set(key, emptyCart);
  return emptyCart;
}

export function mergeRuntimeCart(sourceKey: string, targetKey: string) {
  if (sourceKey === targetKey) return getRuntimeCart(targetKey);

  const source = getRuntimeCart(sourceKey);
  const target = getRuntimeCart(targetKey);
  for (const sourceItem of source.items) {
    const existing = target.items.find((item) => item.skuCode === sourceItem.skuCode);
    const available = getRuntimeItemAvailableQuantity(sourceItem);
    if (existing) {
      existing.quantity = Math.min(99, available, existing.quantity + sourceItem.quantity);
    } else {
      target.items.push({ ...sourceItem, id: randomUUID(), quantity: Math.min(99, available, sourceItem.quantity) });
    }
  }
  target.updatedAt = new Date();
  source.items = [];
  source.updatedAt = target.updatedAt;
  return target;
}

export function resolveCatalogSku(input: { productSlug: string; color?: string; size?: string }) {
  const product = catalogProducts.find((candidate) => candidate.slug === input.productSlug);
  if (!product) return null;

  if ((input.color && !product.colors.includes(input.color)) || (input.size && !product.sizes.includes(input.size))) return null;
  const color = input.color ?? product.colors[0];
  const size = input.size ?? product.sizes[0];

  return {
    product,
    skuCode: `${product.code}-${color}-${size}`.replace(/\s+/g, "-").toUpperCase(),
    color,
    size,
    stockQuantity: 100,
    reservedQuantity: 0,
  };
}

export function addRuntimeCartItem(
  key: string,
  input: { productSlug: string; color?: string; size?: string; quantity: number },
  resolvedSku?: RuntimeResolvedSku,
) {
  return addRuntimeCartItems(key, [{ input, resolvedSku }]);
}

export function addRuntimeCartItems(
  key: string,
  additions: Array<{
    input: { productSlug: string; color?: string; size?: string; quantity: number };
    resolvedSku?: RuntimeResolvedSku;
  }>,
) {
  if (additions.length < 1 || additions.length > 20) throw new Error("INVALID_CART_ITEM");
  const cart = getRuntimeCart(key);
  const nextItems = cart.items.map((item) => ({ ...item }));

  for (const { input, resolvedSku } of additions) {
    const sku = resolvedSku ?? resolveCatalogSku(input);
    if (!sku) throw new Error("SKU_NOT_FOUND");
    if (!Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 99) throw new Error("INVALID_QUANTITY");
    if (sku.stockQuantity - sku.reservedQuantity < input.quantity) throw new Error("INSUFFICIENT_INVENTORY");

    const existing = nextItems.find((item) => item.skuCode === sku.skuCode);
    const nextQuantity = (existing?.quantity ?? 0) + input.quantity;
    if (nextQuantity > 99) throw new Error("INVALID_QUANTITY");
    if (sku.stockQuantity - sku.reservedQuantity < nextQuantity) throw new Error("INSUFFICIENT_INVENTORY");

    if (existing) {
      existing.quantity = nextQuantity;
      existing.unitPriceCents = sku.product.priceCents;
    } else {
      nextItems.push({
        id: randomUUID(),
        productSlug: sku.product.slug,
        skuCode: sku.skuCode,
        productCode: sku.product.code,
        productName: sku.product.name,
        productImage: sku.product.image,
        color: sku.color,
        size: sku.size,
        quantity: input.quantity,
        unitPriceCents: sku.product.priceCents,
      });
    }
  }

  calculateRuntimeCartPricing(nextItems);
  cart.items = nextItems;
  cart.updatedAt = new Date();
  return cart;
}

export function updateRuntimeCartItem(key: string, itemId: string, quantity: number, availableQuantity?: number) {
  const cart = getRuntimeCart(key);
  const item = cart.items.find((candidate) => candidate.id === itemId);
  if (!item) throw new Error("CART_ITEM_NOT_FOUND");
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99) throw new Error("INVALID_QUANTITY");
  if (quantity > (availableQuantity ?? getRuntimeItemAvailableQuantity(item))) throw new Error("INSUFFICIENT_INVENTORY");

  if (quantity === 0) {
    cart.items = cart.items.filter((candidate) => candidate.id !== itemId);
  } else {
    item.quantity = quantity;
  }
  cart.updatedAt = new Date();
  return cart;
}

function getRuntimeItemAvailableQuantity(item: RuntimeCartItem) {
  const sku = resolveCatalogSku({ productSlug: item.productSlug, color: item.color, size: item.size });
  if (!sku) return 0;
  return Math.max(0, sku.stockQuantity - sku.reservedQuantity);
}

export function summarizeCart(cart: RuntimeCart) {
  const pricing = calculateRuntimeCartPricing(cart.items);
  return {
    ...cart,
    items: cart.items.map((item) => ({
      ...item,
      productImage: item.productSlug === "x1-air-white" ? getX1AirWhiteOfferImage(item.color, item.quantity) ?? item.productImage : item.productImage,
    })),
    subtotalCents: pricing.subtotalCents,
    discountCents: pricing.discountCents,
    payableAmountCents: pricing.payableAmountCents,
    itemCount: cart.items.reduce((total, item) => total + item.quantity, 0),
  };
}

function calculateRuntimeCartPricing(items: RuntimeCartItem[]) {
  return calculateCartPricing(items.map((item) => ({
    id: item.id,
    productId: item.productSlug,
    product: { quantityPricing: item.productSlug === "x1-air-white" ? X1_AIR_WHITE_QUANTITY_PRICING : null },
    quantity: item.quantity,
    unitPriceCents: item.unitPriceCents,
  })));
}

export function createRuntimeOrder(
  cartKey: string,
  input: { userId: string; customerName: string; customerPhone: string; addressSnapshot: string },
  shippingFeeCents = 0,
  validatedSkus?: Map<string, RuntimeResolvedSku>,
) {
  const cart = getRuntimeCart(cartKey);
  if (cart.items.length === 0) throw new Error("CART_EMPTY");

  for (const item of cart.items) {
    const sku = validatedSkus?.get(item.skuCode) ?? resolveCatalogSku({ productSlug: item.productSlug, color: item.color, size: item.size });
    if (!sku) throw new Error("SKU_NOT_FOUND");
    if (sku.product.priceCents !== item.unitPriceCents) throw new Error("PRICE_CHANGED");
    if (sku.stockQuantity - sku.reservedQuantity < item.quantity) throw new Error("INSUFFICIENT_INVENTORY");
  }

  const pricing = calculateRuntimeCartPricing(cart.items);
  const now = new Date();
  const order: RuntimeOrder = {
    id: randomUUID(),
    orderNo: `TC${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(orders.size + 1).padStart(5, "0")}`,
    userId: input.userId,
    status: "created",
    paymentStatus: "not_started",
    fulfillmentStatus: "pending",
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    addressSnapshot: input.addressSnapshot,
    subtotalCents: pricing.subtotalCents,
    discountCents: pricing.discountCents,
    shippingFeeCents,
    payableAmountCents: pricing.payableAmountCents + shippingFeeCents,
    currency: "CNY",
    items: cart.items.map((item) => ({ ...item, discountShareCents: pricing.itemDiscountShares[item.id] ?? 0 })),
    audit: [{ action: "order.created", createdAt: now.toISOString() }],
    createdAt: now,
    updatedAt: now,
  };
  orders.set(order.orderNo, order);
  cart.items = [];
  cart.updatedAt = now;
  return order;
}

export function getRuntimeOrder(orderNo: string) {
  return orders.get(orderNo) ?? null;
}

export function listRuntimeOrdersByUser(userId: string) {
  return Array.from(orders.values())
    .filter((order) => order.userId === userId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function listAllRuntimeOrders() {
  return Array.from(orders.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function getRuntimeOrderForUser(orderNo: string, userId: string) {
  const order = getRuntimeOrder(orderNo);
  if (!order || order.userId !== userId) return null;
  return order;
}

export function cancelRuntimeOrder(orderNo: string) {
  const order = getRuntimeOrder(orderNo);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (order.paymentStatus === "paid") throw new Error("PAID_ORDER_CANNOT_CANCEL");
  if (order.status === "cancelled") return order;

  order.status = "cancelled";
  order.paymentStatus = "cancelled";
  order.updatedAt = new Date();
  order.audit.push({ action: "order.cancelled", createdAt: order.updatedAt.toISOString() });
  return order;
}

export function cancelRuntimeOrderForUser(orderNo: string, userId: string) {
  const order = getRuntimeOrderForUser(orderNo, userId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  return cancelRuntimeOrder(orderNo);
}

export function markRuntimeOrderPaymentPendingForUser(orderNo: string, userId: string) {
  const order = getRuntimeOrderForUser(orderNo, userId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (order.status === "cancelled") throw new Error("CANCELLED_ORDER_CANNOT_PAY");
  if (order.paymentStatus === "paid") throw new Error("ORDER_ALREADY_PAID");
  if (order.paymentStatus === "cancelled") throw new Error("CANCELLED_ORDER_CANNOT_PAY");

  order.paymentStatus = "pending";
  order.updatedAt = new Date();
  order.audit.push({ action: "order.payment.pending", createdAt: order.updatedAt.toISOString() });
  return order;
}

export function updateRuntimeOrderForAdmin(
  orderNo: string,
  input: {
    status?: RuntimeOrderStatus;
    fulfillmentStatus?: RuntimeFulfillmentStatus;
    actorId: string;
    note?: string;
  },
) {
  const order = getRuntimeOrder(orderNo);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (input.status === "cancelled" && order.paymentStatus === "paid") {
    throw new Error("PAID_ORDER_CANNOT_CANCEL");
  }

  const before = {
    status: order.status,
    fulfillmentStatus: order.fulfillmentStatus,
  };
  if (input.status) order.status = input.status;
  if (input.fulfillmentStatus) order.fulfillmentStatus = input.fulfillmentStatus;
  order.updatedAt = new Date();
  order.audit.push({
    action: "admin.order.updated",
    createdAt: order.updatedAt.toISOString(),
    detail: {
      actorId: input.actorId,
      before,
      after: {
        status: order.status,
        fulfillmentStatus: order.fulfillmentStatus,
      },
      note: input.note,
    },
  });
  return order;
}

export function markRuntimeOrderPaid(orderNo: string) {
  const order = getRuntimeOrder(orderNo);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (order.status === "cancelled") throw new Error("CANCELLED_ORDER_CANNOT_PAY");
  order.paymentStatus = "paid";
  order.updatedAt = new Date();
  order.audit.push({ action: "order.payment.paid", createdAt: order.updatedAt.toISOString() });
  return order;
}

export function updateRuntimePaymentForAdmin(
  orderNo: string,
  input: {
    paymentStatus: RuntimePaymentStatus;
    actorId: string;
    gatewayTradeNo?: string;
    note?: string;
  },
) {
  const order = getRuntimeOrder(orderNo);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (input.paymentStatus === "paid" && order.status === "cancelled") {
    throw new Error("CANCELLED_ORDER_CANNOT_PAY");
  }

  const before = {
    paymentStatus: order.paymentStatus,
  };
  order.paymentStatus = input.paymentStatus;
  order.updatedAt = new Date();
  order.audit.push({
    action: "admin.payment.updated",
    createdAt: order.updatedAt.toISOString(),
    detail: {
      actorId: input.actorId,
      before,
      after: {
        paymentStatus: order.paymentStatus,
      },
      gatewayTradeNo: input.gatewayTradeNo,
      note: input.note,
    },
  });
  return order;
}

export function listRuntimeAddresses(userId: string) {
  return [...(addresses.get(userId) ?? [])].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
}

export function createRuntimeAddress(
  userId: string,
  input: Omit<RuntimeAddress, "id" | "userId" | "createdAt" | "updatedAt">,
) {
  const now = new Date();
  const existing = addresses.get(userId) ?? [];
  const shouldBeDefault = input.isDefault || existing.length === 0;
  const nextAddress: RuntimeAddress = {
    ...input,
    id: randomUUID(),
    userId,
    isDefault: shouldBeDefault,
    createdAt: now,
    updatedAt: now,
  };

  const next = shouldBeDefault ? existing.map((address) => ({ ...address, isDefault: false, updatedAt: now })) : existing;
  addresses.set(userId, [...next, nextAddress]);
  return nextAddress;
}

export function updateRuntimeAddress(
  userId: string,
  addressId: string,
  input: Partial<Omit<RuntimeAddress, "id" | "userId" | "createdAt" | "updatedAt">>,
) {
  const current = addresses.get(userId) ?? [];
  const index = current.findIndex((address) => address.id === addressId);
  if (index < 0) throw new Error("ADDRESS_NOT_FOUND");

  const now = new Date();
  const updated = {
    ...current[index],
    ...input,
    updatedAt: now,
  };
  const next = current.map((address, addressIndex) => {
    if (addressIndex === index) return updated;
    if (input.isDefault) return { ...address, isDefault: false, updatedAt: now };
    return address;
  });
  addresses.set(userId, next);
  return updated;
}

export function deleteRuntimeAddress(userId: string, addressId: string) {
  const current = addresses.get(userId) ?? [];
  const target = current.find((address) => address.id === addressId);
  if (!target) throw new Error("ADDRESS_NOT_FOUND");

  const next = current.filter((address) => address.id !== addressId);
  if (target.isDefault && next[0]) {
    next[0] = { ...next[0], isDefault: true, updatedAt: new Date() };
  }
  addresses.set(userId, next);
  return target;
}

export function createRuntimeAfterSalesRequest(
  userId: string,
  input: {
    orderNo: string;
    type: RuntimeAfterSalesType;
    reason: string;
    description: string;
    items: Array<{ orderItemId: string; quantity: number; refundAmountCents?: number }>;
    imageUrls?: string[];
  },
) {
  const order = getRuntimeOrderForUser(input.orderNo, userId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (order.paymentStatus !== "paid") throw new Error("UNPAID_ORDER_AFTER_SALES_FORBIDDEN");
  if (input.type !== "refund_only" && order.fulfillmentStatus !== "delivered") {
    throw new Error("ORDER_NOT_DELIVERED_AFTER_SALES_FORBIDDEN");
  }
  if (!input.items.length) throw new Error("AFTER_SALES_ITEMS_REQUIRED");

  const requestItems = input.items.map((requestedItem) => {
    const orderItem = order.items.find((item) => item.id === requestedItem.orderItemId);
    if (!orderItem) throw new Error("ORDER_ITEM_NOT_FOUND");
    if (refundedOrderItemIds.has(orderItem.id)) throw new Error("ORDER_ITEM_ALREADY_REFUNDED");
    if (!Number.isInteger(requestedItem.quantity) || requestedItem.quantity < 1 || requestedItem.quantity > orderItem.quantity) {
      throw new Error("INVALID_AFTER_SALES_QUANTITY");
    }

    const maxRefundCents = orderItem.unitPriceCents * requestedItem.quantity;
    const refundAmountCents = requestedItem.refundAmountCents ?? maxRefundCents;
    if (refundAmountCents < 0 || refundAmountCents > maxRefundCents) {
      throw new Error("INVALID_REFUND_AMOUNT");
    }

    return {
      orderItemId: orderItem.id,
      productName: orderItem.productName,
      color: orderItem.color,
      size: orderItem.size,
      quantity: requestedItem.quantity,
      refundAmountCents,
    };
  });

  const refundAmountCents = requestItems.reduce((total, item) => total + item.refundAmountCents, 0);
  if (refundAmountCents > order.payableAmountCents) throw new Error("REFUND_AMOUNT_EXCEEDS_ORDER");

  const now = new Date();
  const request: RuntimeAfterSalesRequest = {
    id: randomUUID(),
    afterSalesNo: `AS${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(afterSalesRequests.size + 1).padStart(5, "0")}`,
    userId,
    orderNo: order.orderNo,
    type: input.type,
    reason: input.reason,
    description: input.description,
    status: "submitted",
    items: requestItems,
    imageUrls: input.imageUrls ?? [],
    refundAmountCents,
    audit: [{ action: "after_sales.created", actorId: userId, actorType: "user", createdAt: now.toISOString() }],
    createdAt: now,
    updatedAt: now,
  };
  afterSalesRequests.set(request.afterSalesNo, request);
  return request;
}

export function addRuntimeAfterSalesImage(
  userId: string,
  afterSalesNo: string,
  input: { imageUrl: string; uploadedBy?: "user" | "admin" },
) {
  const request = getRuntimeAfterSalesForUser(afterSalesNo, userId);
  if (!request) throw new Error("AFTER_SALES_NOT_FOUND");
  if (request.type !== "quality_issue") throw new Error("AFTER_SALES_IMAGE_ONLY_FOR_QUALITY_ISSUE");
  if (["cancelled", "rejected", "refunded", "completed"].includes(request.status)) {
    throw new Error("AFTER_SALES_IMAGE_UPLOAD_CLOSED");
  }
  if (request.imageUrls.length >= 6) throw new Error("AFTER_SALES_IMAGE_LIMIT_EXCEEDED");

  const now = new Date();
  request.imageUrls.push(input.imageUrl);
  request.updatedAt = now;
  request.audit.push({
    action: "after_sales.image.added",
    actorId: userId,
    actorType: input.uploadedBy ?? "user",
    createdAt: now.toISOString(),
    detail: { imageUrl: input.imageUrl },
  });
  return request;
}

export function listRuntimeAfterSalesByUser(userId: string) {
  return Array.from(afterSalesRequests.values())
    .filter((request) => request.userId === userId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function getRuntimeAfterSalesForUser(afterSalesNo: string, userId: string) {
  const request = afterSalesRequests.get(afterSalesNo);
  if (!request || request.userId !== userId) return null;
  return request;
}

export function listAllRuntimeAfterSales() {
  return Array.from(afterSalesRequests.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function listRuntimeRefunds() {
  return Array.from(refunds.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function listRuntimeReshipments() {
  return Array.from(reshipments.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function createRefundSideEffect(request: RuntimeAfterSalesRequest, actorId: string) {
  const duplicateItem = request.items.find((item) => refundedOrderItemIds.has(item.orderItemId));
  if (duplicateItem) throw new Error("ORDER_ITEM_ALREADY_REFUNDED");

  const now = new Date();
  const refund: RuntimeRefund = {
    id: randomUUID(),
    refundNo: `RF${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(refunds.size + 1).padStart(5, "0")}`,
    afterSalesNo: request.afterSalesNo,
    orderNo: request.orderNo,
    userId: request.userId,
    amountCents: request.refundAmountCents,
    currency: "CNY",
    status: "created",
    orderItemIds: request.items.map((item) => item.orderItemId),
    createdBy: actorId,
    createdAt: now,
    updatedAt: now,
  };
  refunds.set(refund.refundNo, refund);

  const order = getRuntimeOrder(request.orderNo);
  order?.audit.push({
    action: "order.refund.created",
    createdAt: now.toISOString(),
    detail: { refundNo: refund.refundNo, afterSalesNo: request.afterSalesNo, amountCents: refund.amountCents },
  });
  if (order) order.updatedAt = now;

  return refund;
}

function syncRuntimeOrderPaymentStatusAfterRefund(orderNo: string) {
  const order = getRuntimeOrder(orderNo);
  if (!order || order.paymentStatus === "refunded") return;

  const refundedAmountCents = Array.from(refunds.values())
    .filter((refund) => refund.orderNo === orderNo && refund.status === "succeeded")
    .reduce((total, refund) => total + refund.amountCents, 0);
  if (order.payableAmountCents > 0 && refundedAmountCents >= order.payableAmountCents) {
    order.paymentStatus = "refunded";
  }
}

export function updateRuntimeRefundForAdmin(
  refundNo: string,
  input: {
    status?: RuntimeRefund["status"];
    paymentRefundId?: string;
    failureReason?: string;
    actorId: string;
    note?: string;
  },
) {
  const refund = refunds.get(refundNo);
  if (!refund) throw new Error("REFUND_NOT_FOUND");

  const now = new Date();
  const before = {
    status: refund.status,
    paymentRefundId: refund.paymentRefundId,
    failureReason: refund.failureReason,
  };
  if (input.status) refund.status = input.status;
  if (input.paymentRefundId) refund.paymentRefundId = input.paymentRefundId;
  if (input.failureReason) refund.failureReason = input.failureReason;
  if (input.status === "succeeded") refund.completedAt = refund.completedAt ?? now;
  refund.updatedAt = now;

  const order = getRuntimeOrder(refund.orderNo);
  if (order && input.status === "succeeded") {
    for (const orderItemId of refund.orderItemIds) refundedOrderItemIds.add(orderItemId);
    syncRuntimeOrderPaymentStatusAfterRefund(refund.orderNo);
  }
  order?.audit.push({
    action: "admin.refund.updated",
    createdAt: now.toISOString(),
    detail: {
      actorId: input.actorId,
      refundNo,
      before,
      after: {
        status: refund.status,
        paymentRefundId: refund.paymentRefundId,
        failureReason: refund.failureReason,
      },
      note: input.note,
    },
  });
  if (order) order.updatedAt = now;

  return refund;
}

function createReshipmentSideEffect(request: RuntimeAfterSalesRequest, actorId: string) {
  const now = new Date();
  const reshipment: RuntimeReshipment = {
    id: randomUUID(),
    reshipmentNo: `RS${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}${String(reshipments.size + 1).padStart(5, "0")}`,
    afterSalesNo: request.afterSalesNo,
    orderNo: request.orderNo,
    userId: request.userId,
    status: "processing",
    items: request.items.map((item) => ({ ...item })),
    createdBy: actorId,
    createdAt: now,
    updatedAt: now,
  };
  reshipments.set(reshipment.reshipmentNo, reshipment);

  const order = getRuntimeOrder(request.orderNo);
  order?.audit.push({
    action: "order.reshipment.created",
    createdAt: now.toISOString(),
    detail: { reshipmentNo: reshipment.reshipmentNo, afterSalesNo: request.afterSalesNo },
  });
  if (order) order.updatedAt = now;

  return reshipment;
}

export function updateRuntimeReshipmentForAdmin(
  reshipmentNo: string,
  input: {
    status?: RuntimeReshipmentStatus;
    trackingCompany?: string;
    trackingNo?: string;
    actorId: string;
    note?: string;
  },
) {
  const reshipment = reshipments.get(reshipmentNo);
  if (!reshipment) throw new Error("RESHIPMENT_NOT_FOUND");

  const now = new Date();
  const before = {
    status: reshipment.status,
    trackingCompany: reshipment.trackingCompany,
    trackingNo: reshipment.trackingNo,
  };
  if (input.status) reshipment.status = input.status;
  if (input.trackingCompany) reshipment.trackingCompany = input.trackingCompany;
  if (input.trackingNo) reshipment.trackingNo = input.trackingNo;
  if (input.status === "shipped" || input.status === "delivered") reshipment.shippedAt = reshipment.shippedAt ?? now;
  if (input.status === "delivered") reshipment.deliveredAt = reshipment.deliveredAt ?? now;
  reshipment.updatedAt = now;

  const order = getRuntimeOrder(reshipment.orderNo);
  order?.audit.push({
    action: "admin.reshipment.updated",
    createdAt: now.toISOString(),
    detail: {
      actorId: input.actorId,
      reshipmentNo,
      before,
      after: {
        status: reshipment.status,
        trackingCompany: reshipment.trackingCompany,
        trackingNo: reshipment.trackingNo,
      },
      note: input.note,
    },
  });
  if (order) order.updatedAt = now;

  return reshipment;
}

export function updateRuntimeAfterSalesStatus(
  afterSalesNo: string,
  input: {
    status: AfterSalesStatus;
    actorId: string;
    actorType: "admin" | "system";
    rejectReason?: string;
    detail?: unknown;
  },
) {
  const request = afterSalesRequests.get(afterSalesNo);
  if (!request) throw new Error("AFTER_SALES_NOT_FOUND");
  assertAfterSalesTransition(request.status, input.status, request.type);
  if (input.status === "rejected" && !input.rejectReason) throw new Error("REJECT_REASON_REQUIRED");
  assertRuntimeAfterSalesCompletionReady(request, input.status);

  const sideEffect =
    input.status === "refund_processing"
      ? { refund: createRefundSideEffect(request, input.actorId) }
      : input.status === "exchange_shipping" || input.status === "reshipped"
        ? { reshipment: createReshipmentSideEffect(request, input.actorId) }
        : undefined;

  request.status = input.status;
  request.rejectReason = input.rejectReason ?? request.rejectReason;
  request.updatedAt = new Date();
  request.audit.push({
    action: `after_sales.status.${input.status}`,
    actorId: input.actorId,
    actorType: input.actorType,
    createdAt: request.updatedAt.toISOString(),
    detail: sideEffect ? { ...(input.detail as object | undefined), ...sideEffect } : input.detail,
  });
  return request;
}

export function completeRuntimeAfterSalesRefund(afterSalesNo: string, actorId: string) {
  const request = afterSalesRequests.get(afterSalesNo);
  if (!request) throw new Error("AFTER_SALES_NOT_FOUND");
  if (request.status === "refunded") return request;
  if (request.status !== "refund_processing") throw new Error("AFTER_SALES_REFUND_NOT_PROCESSING");
  const refund = Array.from(refunds.values()).find((item) => item.afterSalesNo === afterSalesNo && item.status === "succeeded");
  if (!refund) throw new Error("REFUND_SUCCESS_REQUIRED");

  request.status = "refunded";
  request.updatedAt = new Date();
  request.audit.push({
    action: "after_sales.status.refunded",
    actorId,
    actorType: "system",
    createdAt: request.updatedAt.toISOString(),
    detail: { refundNo: refund.refundNo, source: "payment_provider" },
  });
  return request;
}

function assertRuntimeAfterSalesCompletionReady(request: RuntimeAfterSalesRequest, nextStatus: AfterSalesStatus) {
  if (nextStatus !== "completed") return;

  if (request.status === "refunded") {
    const succeededRefund = Array.from(refunds.values()).some(
      (refund) => refund.afterSalesNo === request.afterSalesNo && refund.status === "succeeded",
    );
    if (!succeededRefund) throw new Error("REFUND_SUCCESS_REQUIRED");
  }

  if (request.status === "exchange_shipping" || request.status === "reshipped") {
    const deliveredItemIds = new Set(
      Array.from(reshipments.values())
        .filter((reshipment) => reshipment.afterSalesNo === request.afterSalesNo && reshipment.status === "delivered")
        .flatMap((reshipment) => reshipment.items.map((item) => item.orderItemId)),
    );
    if (request.items.some((item) => !deliveredItemIds.has(item.orderItemId))) {
      throw new Error("RESHIPMENT_DELIVERY_REQUIRED");
    }
  }
}

export function confirmRuntimeOrderReceiptForUser(orderNo: string, userId: string) {
  const order = getRuntimeOrderForUser(orderNo, userId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  if (order.fulfillmentStatus === "delivered") return order;
  if (order.paymentStatus !== "paid") throw new Error("UNPAID_ORDER_RECEIPT_FORBIDDEN");
  if (order.status !== "confirmed") throw new Error("ORDER_CONFIRMATION_REQUIRED_BEFORE_RECEIPT");
  if (order.fulfillmentStatus !== "shipped") throw new Error("ORDER_NOT_SHIPPED");

  order.fulfillmentStatus = "delivered";
  order.updatedAt = new Date();
  order.audit.push({
    action: "order.receipt.confirmed",
    createdAt: order.updatedAt.toISOString(),
    detail: { actorId: userId },
  });
  return order;
}

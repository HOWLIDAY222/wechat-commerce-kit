import { normalizePickupAvailability } from '../models/pickup';
import { config } from '../config/index';
import { normalizeOrder, normalizeQuote } from '../models/order';
import {normalizeCart} from '../models/cart';
import { readAccessToken } from '../stores/session';
import { request } from './http';
import { normalizeDispatchEstimate } from '../models/dispatch-estimate';

let orderListRequest = null;
function pickupFields(delivery) { return delivery?.deliveryMethod === 'PICKUP' ? {deliveryMethod:'PICKUP',pickupPointVersion:delivery.pickupPointVersion} : {}; }
export async function fetchPickupAvailability(addressId) {
  const response = await request({path:'/api/miniprogram/pickup'+(addressId?'?addressId='+encodeURIComponent(addressId):''),auth:'required',retries:0});
  if(!response?.ok) throw Error('INVALID_PICKUP_RESPONSE');
  return normalizePickupAvailability(response.pickup);
}

export async function fetchDirectCheckout(selection,addressId,delivery) {
  const response=await request({path:'/api/orders/quote',method:'POST',auth:'required',data:{directSelection:selection,...(addressId?{addressId}:{}),...pickupFields(delivery)},retries:0});
  if(!response?.ok||!response.cart||(addressId&&!response.quote))throw Error('INVALID_ORDER_QUOTE_RESPONSE');
  return {cart:normalizeCart(response.cart),quote:response.quote?normalizeQuote(response.quote):null};
}
export async function createDirectOrder(draft,addressId,expectedPayableCents,delivery) {
  if(!config.checkoutEnabled)throw Error('CHECKOUT_NOT_READY');
  if(!config.paymentEnabled||config.paymentProvider!=='wechat')throw Error('PAYMENT_NOT_READY');
  const response=await request({path:'/api/orders',method:'POST',auth:'required',data:{addressId,useCoupons:true,expectedPayableCents,...pickupFields(delivery),directSelection:draft.selection,requestId:draft.requestId}});
  if(!response?.ok||!response.order)throw Error('INVALID_ORDER_RESPONSE');
  return normalizeOrder(response.order);
}

export async function fetchOrderQuote(addressId,delivery) {
  if (!addressId) throw new Error('ADDRESS_REQUIRED');
  const response = await request({ path: `/api/orders/quote?useCoupons=1&addressId=${encodeURIComponent(addressId)}${delivery?.deliveryMethod==='PICKUP'?'&deliveryMethod=PICKUP&pickupPointVersion='+encodeURIComponent(delivery.pickupPointVersion):''}`, auth: 'required' });
  if (!response?.ok || !response.quote) throw new Error('INVALID_ORDER_QUOTE_RESPONSE');
  return normalizeQuote(response.quote);
}

export async function createOrder(addressId, expectedPayableCents, delivery) {
  if (!config.checkoutEnabled) throw new Error('CHECKOUT_NOT_READY');
  if (!config.paymentEnabled || config.paymentProvider !== 'wechat') throw new Error('PAYMENT_NOT_READY');
  const response = await request({
    path: '/api/orders',
    method: 'POST',
    data: { addressId, useCoupons: true, expectedPayableCents, ...pickupFields(delivery) },
    auth: 'required',
  });
  if (!response?.ok || !response.order) throw new Error('INVALID_ORDER_RESPONSE');
  return normalizeOrder(response.order);
}

export async function fetchOrders() {
  const sessionKey = readAccessToken();
  if (orderListRequest?.sessionKey === sessionKey) return orderListRequest.promise;
  const promise = request({ path: '/api/account/orders', auth: 'required' })
    .then((response) => {
      if (!response?.ok || !Array.isArray(response.orders)) throw new Error('INVALID_ORDERS_RESPONSE');
      return response.orders.filter(order=>order.kind!=='GIFT_PURCHASE').map(normalizeOrder);
    })
    .finally(() => {
      if (orderListRequest?.promise === promise) orderListRequest = null;
    });
  orderListRequest = { sessionKey, promise };
  return promise;
}

export async function fetchOrder(orderNo) {
  const response = await request({
    path: `/api/account/orders/${encodeURIComponent(orderNo)}`,
    auth: 'required',
  });
  if (!response?.ok || !response.order) throw new Error('INVALID_ORDER_RESPONSE');
  return normalizeOrder(response.order);
}

export async function fetchOrderLogistics(orderNo) {
  if (typeof orderNo !== 'string' || !orderNo.trim()) throw new Error('ORDER_NO_REQUIRED');
  const response = await request({
    path: `/api/account/orders/${encodeURIComponent(orderNo)}/logistics`,
    auth: 'required',
  });
  const logistics = response?.logistics;
  if (response?.ok !== true || typeof logistics?.available !== 'boolean') {
    throw new Error('INVALID_LOGISTICS_RESPONSE');
  }
  if (!logistics.available) {
    return { available: false, reason: typeof logistics.reason === 'string' ? logistics.reason : '' };
  }
  if (typeof logistics.waybillToken !== 'string' || !logistics.waybillToken.trim()) {
    throw new Error('INVALID_LOGISTICS_RESPONSE');
  }
  return { available: true, waybillToken: logistics.waybillToken, status: logistics.status };
}

export async function fetchOrderDispatchEstimate(orderNo) {
  if (typeof orderNo !== 'string' || !orderNo.trim()) throw new Error('ORDER_NO_REQUIRED');
  const response = await request({
    path: `/api/account/orders/${encodeURIComponent(orderNo)}/dispatch-estimate`,
    auth: 'required',
  });
  if (response?.ok !== true) throw new Error('INVALID_DISPATCH_ESTIMATE_RESPONSE');
  return normalizeDispatchEstimate(response.dispatchEstimate);
}

export async function cancelOrder(orderNo) {
  const response = await request({
    path: `/api/orders/${encodeURIComponent(orderNo)}/cancel`,
    method: 'POST',
    auth: 'required',
  });
  if (!response?.ok || !response.order) throw new Error('INVALID_ORDER_RESPONSE');
  return normalizeOrder(response.order);
}

export async function confirmOrderReceipt(orderNo) {
  const response = await request({
    path: `/api/orders/${encodeURIComponent(orderNo)}/confirm-receipt`,
    method: 'POST',
    auth: 'required',
  });
  if (!response?.ok || !response.order) throw new Error('INVALID_ORDER_RESPONSE');
  return normalizeOrder(response.order);
}

export async function repurchaseOrder(orderNo) {
  const response = await request({
    path: `/api/orders/${encodeURIComponent(orderNo)}/repurchase`,
    method: 'POST',
    auth: 'required',
  });
  if (!response?.ok || !response.cart) throw new Error('INVALID_REPURCHASE_RESPONSE');
  return {
    addedItemCount: Number(response.addedItemCount || 0),
    skippedItems: Array.isArray(response.skippedItems) ? response.skippedItems : [],
  };
}

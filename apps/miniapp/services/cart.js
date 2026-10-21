import { normalizeCart } from '../models/cart';
import { request } from './http';
import { syncGuestCart } from './guest-sync';

export async function fetchCart() {
  await syncGuestCart();
  const response = await request({ path: '/api/cart', auth: 'required' });
  if (!response?.ok || !response.cart) throw new Error('INVALID_CART_RESPONSE');
  return updateBadge(normalizeCart(response.cart));
}

export async function addCartItem(input) {
  await syncGuestCart();
  const response = await request({ path: '/api/cart', method: 'POST', data: input, auth: 'required' });
  if (!response?.ok || !response.cart) throw new Error('INVALID_CART_RESPONSE');
  return updateBadge(normalizeCart(response.cart));
}

export async function updateCartItem(itemId, quantity) {
  const response = await request({
    path: '/api/cart',
    method: 'PATCH',
    data: { itemId, quantity },
    auth: 'required',
  });
  if (!response?.ok || !response.cart) throw new Error('INVALID_CART_RESPONSE');
  return updateBadge(normalizeCart(response.cart));
}

export async function replaceCartItemVariant(itemId, input) {
  const response = await request({
    path: '/api/cart',
    method: 'PATCH',
    data: { action: 'replaceVariant', itemId, ...input },
    auth: 'required',
  });
  if (!response?.ok || !response.cart) throw new Error('INVALID_CART_RESPONSE');
  return updateBadge(normalizeCart(response.cart));
}

function updateBadge(cart) {
  const count = cart.itemCount || cart.items.reduce((sum, item) => sum + item.quantity, 0);
  if (count) wx.setTabBarBadge({index:2,text:String(count),fail:()=>{}});
  else wx.removeTabBarBadge({index:2,fail:()=>{}});
  return cart;
}

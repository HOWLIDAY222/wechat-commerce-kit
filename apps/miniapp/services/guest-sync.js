import { readGuestItems, clearGuestItems } from './guest-cart';
import { readStoredUser } from '../stores/session';
import { request } from './http';
const KEY = 'merchantkit.guest-import.v1';
let pendingRequest = null;
export function hasPendingGuestSync() { return !!wx.getStorageSync(KEY); }
export async function syncGuestCart() {
  if (pendingRequest) return pendingRequest;
  pendingRequest = runSync().finally(() => { pendingRequest = null; });
  return pendingRequest;
}
async function runSync() {
  const items = readGuestItems().map(({ productSlug, color, size, quantity,style }) => ({ productSlug, color, size, quantity,style }));
  if (!items.length && !hasPendingGuestSync()) return;
  const userId = readStoredUser()?.id;
  if (!userId) throw new Error('AUTH_REQUIRED');
  let pending = wx.getStorageSync(KEY);
  if (pending && pending.userId !== userId) throw new Error('CART_SYNC_ACCOUNT_CHANGED');
  if (!pending) {
    pending = { userId, importId: `bag_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`, items };
    wx.setStorageSync(KEY, pending);
  }
  try {
    const result = await request({path:'/api/miniprogram/cart/import',method:'POST',auth:'required',data:{importId:pending.importId,items:pending.items}});
    if (!result?.ok || !result.cart) throw new Error('INVALID_CART_IMPORT_RESPONSE');
    clearGuestItems();
    wx.removeStorageSync(KEY);
  } catch (error) {
    if (error?.statusCode === 400) wx.removeStorageSync(KEY);
    throw error;
  }
}

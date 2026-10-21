import {hasSession,readStoredUser} from './session';
let draft = null;
const LIFETIME = 30 * 60 * 1000;
export function beginDirectCheckout(selection) {
  if (!selection || !Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > 99
    || !selection.productSlug || !selection.size || !selection.color) throw Error('INVALID_DIRECT_SELECTION');
  draft = {
    selection: {productSlug:selection.productSlug,...(selection.style?{style:selection.style}:{}),color:selection.color,size:selection.size,quantity:selection.quantity},
    requestId: 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.floor(Math.random()*16);return (c==='x'?r:(r&3)|8).toString(16);}),
    ownerId: hasSession() ? readStoredUser()?.id || '' : '', expiresAt: Date.now() + LIFETIME,
  };
  return readDirectCheckout();
}
export function readDirectCheckout() {
  if (!draft || draft.expiresAt <= Date.now()) { draft = null; return null; }
  const userId = hasSession() ? readStoredUser()?.id || '' : '';
  if (draft.ownerId && userId && draft.ownerId !== userId) throw Error('DIRECT_CHECKOUT_ACCOUNT_CHANGED');
  if (!draft.ownerId && userId) draft.ownerId = userId;
  return {...draft,selection:{...draft.selection}};
}
export function clearDirectCheckout(requestId) { if (draft?.requestId === requestId) draft = null; }

// Copyright 2026 青岛屿漠商贸有限公司. SPDX-License-Identifier: Apache-2.0
// This showcase is a browser-local simulation, not a payment or identity service.
export const STORAGE_KEY = 'merchantkit.showcase.v1';
export const PRODUCTS = Object.freeze([
  { id: 'tote', name: '日常帆布托特包', nameEn: 'Everyday canvas tote', category: 'carry', categoryZh: '随身出行', categoryEn: 'On the go', priceCents: 8800, initialStock: 18, image: './assets/canvas-tote.png', description: '厚实棉帆布，装下出门需要的小物。', descriptionEn: 'Sturdy cotton canvas. A little room for the everyday.', detail: '原色帆布 / 单只', detailEn: 'Natural canvas / one bag' },
  { id: 'notebooks', name: '随手记录笔记本', nameEn: 'Everyday notebook set', category: 'desk', categoryZh: '桌面日常', categoryEn: 'At your desk', priceCents: 4800, initialStock: 24, image: './assets/notebook-set.png', description: '两本一组，为想法留一点空间。', descriptionEn: 'A pair of notebooks. A little space for your next idea.', detail: '石墨灰与浅灰 / 两本装', detailEn: 'Graphite + light grey / set of two' },
]);
const statuses = new Set(['paid', 'shipped', 'ready', 'completed', 'refund_requested', 'refunded']);
const categories = new Set(['daily', 'travel', 'work']);
const styles = new Set(['simple', 'classic', 'colorful']);
const budgets = new Set(['under100', '100to300', 'over300']);
const events = new Set(['sample', 'paid', 'shipped', 'ready', 'completed', 'refund_requested', 'refunded', 'profile', 'preferences', 'stock']);
const copy = value => structuredClone(value);
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const isoDate = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
export const productById = id => PRODUCTS.find(product => product.id === id);
function fail(code) { throw new Error(code); }
function note(state, type, at, orderId = null) {
  state.activity.unshift({ type, at, orderId });
  state.activity = state.activity.slice(0, 30);
}

export function createDemoState(now = new Date().toISOString()) {
  if (!isoDate(now)) fail('INVALID_DATE');
  const notebook = productById('notebooks');
  return {
    version: 1, nextOrder: 1002, cart: [],
    stock: { tote: 18, notebooks: 23 },
    member: { name: 'Alex', points: 180, profileCompleted: false, preferencesCompleted: false, preferences: null },
    couponUsedBy: null,
    orders: [{ id: 'DEMO-1001', account: 'sample', status: 'paid', delivery: 'courier', pickupCode: null,
      items: [{ productId: notebook.id, quantity: 1, unitPriceCents: notebook.priceCents }],
      subtotalCents: 4800, discountCents: 0, totalCents: 4800, createdAt: now, updatedAt: now, pointsAwarded: 0 }],
    activity: [{ type: 'sample', at: now, orderId: 'DEMO-1001' }],
  };
}

export function quoteCart(state, useCoupon = false) {
  const lines = state.cart.map(item => {
    const product = productById(item.productId);
    if (!product || !integer(item.quantity, 1, 20)) fail('INVALID_CART');
    return { ...item, product, available: state.stock[item.productId], totalCents: product.priceCents * item.quantity };
  });
  const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const couponEligible = subtotalCents >= 10000 && state.couponUsedBy === null;
  const discountCents = useCoupon && couponEligible ? 1000 : 0;
  return { lines, quantity: lines.reduce((sum, line) => sum + line.quantity, 0), subtotalCents, discountCents,
    totalCents: subtotalCents - discountCents, couponEligible,
    stockIssue: lines.some(line => line.quantity > line.available) };
}

export function reduceDemoState(previous, action, now = new Date().toISOString()) {
  if (!isoDate(now)) fail('INVALID_DATE');
  const state = copy(previous);
  const order = state.orders.find(item => item.id === action.orderId);
  const complete = () => {
    order.status = 'completed'; order.updatedAt = now;
    if (order.account === 'visitor') {
      order.pointsAwarded = Math.floor(order.totalCents / 100);
      state.member.points += order.pointsAwarded;
    }
    note(state, 'completed', now, order.id);
  };
  switch (action.type) {
    case 'cart_add': {
      if (!productById(action.productId)) fail('PRODUCT_NOT_FOUND');
      const line = state.cart.find(item => item.productId === action.productId);
      const quantity = (line?.quantity || 0) + 1;
      if (quantity > state.stock[action.productId] || quantity > 20) fail('NOT_ENOUGH_STOCK');
      if (line) line.quantity = quantity; else state.cart.push({ productId: action.productId, quantity });
      break;
    }
    case 'cart_set': {
      const line = state.cart.find(item => item.productId === action.productId);
      if (!line || !integer(action.quantity, 0, 20)) fail('INVALID_QUANTITY');
      if (action.quantity > state.stock[action.productId]) fail('NOT_ENOUGH_STOCK');
      line.quantity = action.quantity;
      state.cart = state.cart.filter(item => item.quantity > 0);
      break;
    }
    case 'checkout': {
      const quote = quoteCart(state, action.useCoupon === true);
      if (!quote.quantity) fail('EMPTY_CART');
      if (quote.stockIssue) fail('NOT_ENOUGH_STOCK');
      if (!['courier', 'pickup'].includes(action.delivery)) fail('INVALID_DELIVERY');
      if (state.orders.length >= 50) fail('DEMO_LIMIT');
      if (action.delivery === 'pickup' && (typeof action.pickupCode !== 'string' || !/^[A-HJ-NP-Z2-9]{8}$/.test(action.pickupCode) || state.orders.some(item => item.pickupCode === action.pickupCode))) fail('INVALID_PICKUP_CODE');
      const id = `DEMO-${state.nextOrder++}`;
      const created = { id, account: 'visitor', status: 'paid', delivery: action.delivery,
        pickupCode: action.delivery === 'pickup' ? action.pickupCode : null,
        items: quote.lines.map(line => ({ productId: line.productId, quantity: line.quantity, unitPriceCents: line.product.priceCents })),
        subtotalCents: quote.subtotalCents, discountCents: quote.discountCents, totalCents: quote.totalCents,
        createdAt: now, updatedAt: now, pointsAwarded: 0 };
      for (const line of quote.lines) state.stock[line.productId] -= line.quantity;
      state.orders.unshift(created); state.cart = [];
      if (quote.discountCents) state.couponUsedBy = id;
      note(state, 'paid', now, id);
      break;
    }
    case 'ship_order':
      if (!order || order.status !== 'paid' || order.delivery !== 'courier') fail('INVALID_TRANSITION');
      order.status = 'shipped'; order.updatedAt = now; note(state, 'shipped', now, order.id);
      break;
    case 'prepare_pickup':
      if (!order || order.status !== 'paid' || order.delivery !== 'pickup') fail('INVALID_TRANSITION');
      order.status = 'ready'; order.updatedAt = now; note(state, 'ready', now, order.id);
      break;
    case 'collect_pickup':
      if (!order || order.status !== 'ready' || order.delivery !== 'pickup') fail('INVALID_TRANSITION');
      if (String(action.code || '').trim().toUpperCase() !== order.pickupCode) fail('WRONG_PICKUP_CODE');
      complete(); break;
    case 'confirm_delivery':
      if (!order || order.account !== 'visitor' || order.status !== 'shipped' || order.delivery !== 'courier') fail('INVALID_TRANSITION');
      complete(); break;
    case 'request_refund':
      if (!order || order.account !== 'visitor' || order.status !== 'paid') fail('INVALID_TRANSITION');
      order.status = 'refund_requested'; order.updatedAt = now; note(state, 'refund_requested', now, order.id);
      break;
    case 'approve_refund':
      if (!order || order.status !== 'refund_requested') fail('INVALID_TRANSITION');
      for (const item of order.items) state.stock[item.productId] += item.quantity;
      order.status = 'refunded'; order.updatedAt = now; note(state, 'refunded', now, order.id);
      break;
    case 'stock_set':
      if (!productById(action.productId) || !integer(action.quantity, 0, 999)) fail('INVALID_STOCK');
      state.stock[action.productId] = action.quantity; note(state, 'stock', now);
      break;
    case 'profile_save': {
      const name = typeof action.name === 'string' ? action.name.trim() : '';
      if (name.length < 1 || name.length > 40) fail('INVALID_NAME');
      state.member.name = name;
      if (!state.member.profileCompleted) {
        state.member.profileCompleted = true; state.member.points += 40; note(state, 'profile', now);
      }
      break;
    }
    case 'preferences_save': {
      const value = action.preferences;
      if (!value || !categories.has(value.use) || !styles.has(value.style) || !budgets.has(value.budget)) fail('INVALID_PREFERENCES');
      state.member.preferences = { use: value.use, style: value.style, budget: value.budget };
      if (!state.member.preferencesCompleted) {
        state.member.preferencesCompleted = true; state.member.points += 60; note(state, 'preferences', now);
      }
      break;
    }
    default: fail('UNKNOWN_ACTION');
  }
  return state;
}

function validState(state) {
  if (!state || state.version !== 1 || !integer(state.nextOrder, 1002, 1100) || !Array.isArray(state.cart) || state.cart.length > PRODUCTS.length ||
    !Array.isArray(state.orders) || state.orders.length < 1 || state.orders.length > 50 || !state.stock || !state.member ||
    !Array.isArray(state.activity) || state.activity.length > 30) return false;
  if (!PRODUCTS.every(product => integer(state.stock[product.id], 0, 1999))) return false;
  if (!state.cart.every(item => item && productById(item.productId) && integer(item.quantity, 1, 20)) || new Set(state.cart.map(item => item.productId)).size !== state.cart.length) return false;
  if (typeof state.member.name !== 'string' || !state.member.name.trim() || state.member.name.length > 40 || typeof state.member.profileCompleted !== 'boolean' || typeof state.member.preferencesCompleted !== 'boolean') return false;
  const preferences = state.member.preferences;
  if (state.member.preferencesCompleted ? !preferences || !categories.has(preferences.use) || !styles.has(preferences.style) || !budgets.has(preferences.budget) : preferences !== null) return false;
  if (new Set(state.orders.map(order => order?.id)).size !== state.orders.length) return false;
  for (const order of state.orders) {
    if (!order || !/^DEMO-10\d\d$/.test(order.id) || Number(order.id.slice(5)) >= state.nextOrder || !['visitor', 'sample'].includes(order.account) || !statuses.has(order.status) ||
      !['courier', 'pickup'].includes(order.delivery) || !isoDate(order.createdAt) || !isoDate(order.updatedAt) || !Array.isArray(order.items) || !order.items.length || order.items.length > PRODUCTS.length) return false;
    if (!order.items.every(item => productById(item.productId)?.priceCents === item.unitPriceCents && integer(item.quantity, 1, 20)) || new Set(order.items.map(item => item.productId)).size !== order.items.length) return false;
    const subtotal = order.items.reduce((sum, item) => sum + item.quantity * item.unitPriceCents, 0);
    if (order.subtotalCents !== subtotal || ![0, 1000].includes(order.discountCents) || order.discountCents && subtotal < 10000 || order.totalCents !== subtotal - order.discountCents) return false;
    if (order.delivery === 'pickup' ? !/^[A-HJ-NP-Z2-9]{8}$/.test(order.pickupCode) || order.status === 'shipped' : order.pickupCode !== null || order.status === 'ready') return false;
    if (order.pointsAwarded !== (order.status === 'completed' && order.account === 'visitor' ? Math.floor(order.totalCents / 100) : 0)) return false;
  }
  const discounted = state.orders.filter(order => order.discountCents > 0);
  if (discounted.length > 1 || (discounted[0]?.id ?? null) !== state.couponUsedBy) return false;
  const expectedPoints = 180 + (state.member.profileCompleted ? 40 : 0) + (state.member.preferencesCompleted ? 60 : 0) + state.orders.reduce((sum, order) => sum + order.pointsAwarded, 0);
  return state.member.points === expectedPoints && state.activity.every(item => item && events.has(item.type) && isoDate(item.at) && (item.orderId === null || state.orders.some(order => order.id === item.orderId)));
}

export function restoreDemoState(serialized, now = new Date().toISOString()) {
  try {
    const parsed = JSON.parse(serialized);
    if (validState(parsed)) return parsed;
  } catch { /* A corrupt or old showcase is replaced; production data is never involved. */ }
  return createDemoState(now);
}

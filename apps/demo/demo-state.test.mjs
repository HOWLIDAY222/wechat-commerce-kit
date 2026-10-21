import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTS, createDemoState, quoteCart, reduceDemoState, restoreDemoState } from './demo-state.mjs';
const now = '2026-10-21T08:00:00.000Z';
const reduce = (state, action) => reduceDemoState(state, action, now);
function bag() { return reduce(reduce(createDemoState(now), { type: 'cart_add', productId: 'tote' }), { type: 'cart_add', productId: 'notebooks' }); }
function order(delivery = 'courier', useCoupon = true) { return reduce(bag(), { type: 'checkout', delivery, useCoupon, pickupCode: 'ABCD2345' }); }

test('fresh sessions have independent fictional records and a visibly seeded sample order', () => {
  const first = createDemoState(now), second = createDemoState(now);
  first.member.name = 'Another demo';
  assert.equal(second.member.name, 'Alex');
  assert.equal(second.orders[0].account, 'sample');
  assert.equal(second.stock.notebooks + 1, PRODUCTS.find(product => product.id === 'notebooks').initialStock);
  assert.equal(second.member.points, 180);
});
test('cart quantities can be changed and removed without mutating the previous state', () => {
  const previous = createDemoState(now);
  let state = reduce(previous, { type: 'cart_add', productId: 'tote' });
  state = reduce(state, { type: 'cart_set', productId: 'tote', quantity: 3 });
  assert.equal(quoteCart(state).totalCents, 26400);
  assert.deepEqual(previous.cart, []);
  assert.deepEqual(reduce(state, { type: 'cart_set', productId: 'tote', quantity: 0 }).cart, []);
});
test('unknown products, fractional quantities and unavailable stock cannot enter a cart', () => {
  const state = reduce(createDemoState(now), { type: 'cart_add', productId: 'tote' });
  assert.throws(() => reduce(state, { type: 'cart_add', productId: 'unknown' }), /PRODUCT_NOT_FOUND/);
  for (const quantity of [-1, 1.5, NaN, 21]) assert.throws(() => reduce(state, { type: 'cart_set', productId: 'tote', quantity }), /INVALID_QUANTITY/);
  const soldOut = reduce(state, { type: 'stock_set', productId: 'tote', quantity: 0 });
  assert.throws(() => reduce(soldOut, { type: 'cart_add', productId: 'tote' }), /NOT_ENOUGH_STOCK/);
});
test('inventory changes invalidate checkout instead of silently changing a confirmed quantity', () => {
  const state = reduce(bag(), { type: 'stock_set', productId: 'tote', quantity: 0 });
  const snapshot = JSON.stringify(state);
  assert.equal(quoteCart(state).stockIssue, true);
  assert.throws(() => reduce(state, { type: 'checkout', delivery: 'courier' }), /NOT_ENOUGH_STOCK/);
  assert.equal(JSON.stringify(state), snapshot);
});
test('coupon threshold, integer money and totals agree before and after checkout', () => {
  const single = reduce(createDemoState(now), { type: 'cart_add', productId: 'tote' });
  assert.equal(quoteCart(single, true).discountCents, 0);
  assert.equal(quoteCart(bag(), true).subtotalCents, 13600);
  assert.equal(quoteCart(bag(), true).totalCents, 12600);
  const state = order();
  assert.equal(state.orders[0].totalCents, 12600);
  assert.equal(state.couponUsedBy, state.orders[0].id);
  assert.equal(state.stock.tote, 17); assert.equal(state.stock.notebooks, 22);
});
test('repeated checkout cannot duplicate an order or deduct stock twice', () => {
  const state = order(), snapshot = JSON.stringify(state);
  assert.throws(() => reduce(state, { type: 'checkout', delivery: 'courier', useCoupon: true }), /EMPTY_CART/);
  assert.equal(JSON.stringify(state), snapshot);
  let again = reduce(state, { type: 'cart_add', productId: 'tote' });
  again = reduce(again, { type: 'cart_add', productId: 'notebooks' });
  assert.equal(quoteCart(again, true).discountCents, 0);
});
test('invalid delivery and pickup codes leave the bag, inventory and coupon untouched', () => {
  const state = bag(), snapshot = JSON.stringify(state);
  assert.throws(() => reduce(state, { type: 'checkout', delivery: 'unknown' }), /INVALID_DELIVERY/);
  for (const pickupCode of [null, '', '1234', 'OOOOOOOO', 'ABCD2345!']) assert.throws(() => reduce(state, { type: 'checkout', delivery: 'pickup', pickupCode }), /INVALID_PICKUP_CODE/);
  assert.equal(JSON.stringify(state), snapshot);
});
test('courier fulfilment and customer confirmation award points exactly once', () => {
  let state = order(), id = state.orders[0].id;
  assert.throws(() => reduce(state, { type: 'confirm_delivery', orderId: id }), /INVALID_TRANSITION/);
  state = reduce(state, { type: 'ship_order', orderId: id });
  assert.equal(state.member.points, 180);
  state = reduce(state, { type: 'confirm_delivery', orderId: id });
  assert.equal(state.orders[0].status, 'completed');
  assert.equal(state.member.points, 306);
  assert.throws(() => reduce(state, { type: 'confirm_delivery', orderId: id }), /INVALID_TRANSITION/);
  assert.equal(state.member.points, 306);
});
test('pickup waits for readiness, rejects the wrong code and completes once with the right code', () => {
  let state = order('pickup'), id = state.orders[0].id;
  assert.throws(() => reduce(state, { type: 'collect_pickup', orderId: id, code: 'ABCD2345' }), /INVALID_TRANSITION/);
  assert.throws(() => reduce(state, { type: 'ship_order', orderId: id }), /INVALID_TRANSITION/);
  state = reduce(state, { type: 'prepare_pickup', orderId: id });
  assert.throws(() => reduce(state, { type: 'collect_pickup', orderId: id, code: 'WRONG234' }), /WRONG_PICKUP_CODE/);
  assert.equal(state.orders[0].status, 'ready');
  state = reduce(state, { type: 'collect_pickup', orderId: id, code: ' abcd2345 ' });
  assert.equal(state.orders[0].status, 'completed'); assert.equal(state.member.points, 306);
  assert.throws(() => reduce(state, { type: 'collect_pickup', orderId: id, code: 'ABCD2345' }), /INVALID_TRANSITION/);
});
test('pickup codes cannot be reused across orders', () => {
  let state = order('pickup'); state = reduce(state, { type: 'cart_add', productId: 'tote' });
  assert.throws(() => reduce(state, { type: 'checkout', delivery: 'pickup', pickupCode: 'ABCD2345' }), /INVALID_PICKUP_CODE/);
});
test('refund approval closes a paid order and restores stock once without recycling a used coupon', () => {
  let state = order(), id = state.orders[0].id;
  assert.throws(() => reduce(state, { type: 'approve_refund', orderId: id }), /INVALID_TRANSITION/);
  state = reduce(state, { type: 'request_refund', orderId: id });
  assert.equal(state.stock.tote, 17);
  state = reduce(state, { type: 'approve_refund', orderId: id });
  assert.equal(state.orders[0].status, 'refunded'); assert.equal(state.stock.tote, 18); assert.equal(state.stock.notebooks, 23);
  assert.equal(state.member.points, 180); assert.equal(state.couponUsedBy, id);
  assert.throws(() => reduce(state, { type: 'approve_refund', orderId: id }), /INVALID_TRANSITION/);
});
test('shipped orders do not offer the unshipped cancellation shortcut', () => {
  let state = order(), id = state.orders[0].id;
  state = reduce(state, { type: 'ship_order', orderId: id });
  assert.throws(() => reduce(state, { type: 'request_refund', orderId: id }), /INVALID_TRANSITION/);
});
test('profile and preference rewards are one-time while later edits still work', () => {
  let state = reduce(createDemoState(now), { type: 'profile_save', name: 'Demo reviewer' });
  state = reduce(state, { type: 'profile_save', name: 'New demo name' });
  assert.equal(state.member.points, 220); assert.equal(state.member.name, 'New demo name');
  const preferences = { use: 'work', style: 'simple', budget: 'under100' };
  state = reduce(state, { type: 'preferences_save', preferences });
  state = reduce(state, { type: 'preferences_save', preferences: { ...preferences, use: 'travel' } });
  assert.equal(state.member.points, 280); assert.equal(state.member.preferences.use, 'travel');
});
test('bad profile and inventory input fail without claiming a reward or setting impossible stock', () => {
  const state = createDemoState(now);
  assert.throws(() => reduce(state, { type: 'profile_save', name: '  ' }), /INVALID_NAME/);
  assert.throws(() => reduce(state, { type: 'preferences_save', preferences: { use: 'anything' } }), /INVALID_PREFERENCES/);
  for (const quantity of [-1, 2.5, 1000, Infinity]) assert.throws(() => reduce(state, { type: 'stock_set', productId: 'tote', quantity }), /INVALID_STOCK/);
  assert.equal(state.member.points, 180);
});
test('valid orders, points, preferences, stock and coupon usage survive a browser refresh', () => {
  let state = order('pickup'), id = state.orders[0].id;
  state = reduce(state, { type: 'prepare_pickup', orderId: id });
  state = reduce(state, { type: 'collect_pickup', orderId: id, code: 'ABCD2345' });
  state = reduce(state, { type: 'profile_save', name: 'Demo user' });
  assert.deepEqual(restoreDemoState(JSON.stringify(state), now), state);
});
test('corrupt, outdated and inconsistent browser records reset to the isolated fictional fixture', () => {
  const tampered = order(); tampered.member.points += 100;
  const price = order(); price.orders[0].items[0].unitPriceCents = 1;
  const coupon = order(); coupon.couponUsedBy = null;
  for (const serialized of ['bad-json', 'null', '{}', JSON.stringify({ version: 99 }), JSON.stringify(tampered), JSON.stringify(price), JSON.stringify(coupon)]) {
    assert.deepEqual(restoreDemoState(serialized, now), createDemoState(now));
  }
});
test('one demo session has a bounded order history and cannot place a partial over-limit order', () => {
  let state = reduce(createDemoState(now), { type: 'stock_set', productId: 'tote', quantity: 100 });
  for (let index = 0; index < 49; index++) { state = reduce(state, { type: 'cart_add', productId: 'tote' }); state = reduce(state, { type: 'checkout', delivery: 'courier' }); }
  state = reduce(state, { type: 'cart_add', productId: 'tote' });
  assert.equal(state.orders.length, 50);
  assert.throws(() => reduce(state, { type: 'checkout', delivery: 'courier' }), /DEMO_LIMIT/);
  assert.equal(state.cart[0].quantity, 1); assert.equal(state.stock.tote, 51);
  assert.deepEqual(restoreDemoState(JSON.stringify(state), now), state);
});

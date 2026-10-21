const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader, root } = require('./test-loader.cjs');
const { canShowDispatchEstimate, isDispatchDate, isDispatchRange, normalizeDispatchEstimate, dispatchEstimatePresentation } = createLoader().load('models/dispatch-estimate.js');
const { normalizeOrder } = createLoader().load('models/order.js');
const dto = patch => ({ status: 'SCHEDULED', startDate: '2099-04-01', endDate: '2099-04-03', timeZone: 'Asia/Shanghai', label: 'server presentation only', updatedAt: '2026-10-18T08:00:00.000Z', revision: 1, ...patch });
const rawOrder = patch => ({ orderNo: 'fixture-order', kind: 'STANDARD', status: 'CONFIRMED', paymentStatus: 'PAID', fulfillmentStatus: 'PROCESSING', currency: 'CNY', subtotalCents: 4900, shippingFeeCents: 0, payableAmountCents: 4900, items: [{ id: 'fixture-item', productName: 'X1 Air', quantity: 1, unitPriceCents: 4900 }], shipments: [], ...patch });
const tick = () => new Promise(setImmediate);

function serviceFixture(response) {
  const calls = [];
  const loader = createLoader({}, { [path.join(root, 'services/http.js')]: { request: async options => { calls.push(options); return response; } } });
  return { orders: loader.load('services/orders.js'), calls };
}

function pageFixture({ fetch = async () => normalizeDispatchEstimate(dto()), readOrder = async () => normalizeOrder(rawOrder()), wx = {}, services = {}, payments = {} } = {}) {
  const calls = { estimates: [], patches: [], payments: [], receipts: [], cancels: [], routes: [], storage: [], logistics: [] };
  const loader = createLoader({ stopPullDownRefresh() {}, showToast() {}, navigateTo: options => calls.routes.push(options.url), setStorageSync: (...args) => calls.storage.push(args), ...wx }, {
    [path.join(root, 'services/orders.js')]: {
      fetchOrder: readOrder,
      fetchOrderDispatchEstimate: async orderNo => { calls.estimates.push(orderNo); return fetch(orderNo); },
      fetchOrderLogistics: async orderNo => { calls.logistics.push(orderNo); return { available: false, reason: 'NOT_REGISTERED' }; },
      confirmOrderReceipt: async orderNo => { calls.receipts.push(orderNo); return normalizeOrder(rawOrder({ fulfillmentStatus: 'DELIVERED' })); },
      cancelOrder: async orderNo => { calls.cancels.push(orderNo); return normalizeOrder(rawOrder({ status: 'CANCELLED', paymentStatus: 'CANCELLED' })); },
      repurchaseOrder: async () => ({ addedItemCount: 1, skippedItems: [] }),
      ...services,
    },
    [path.join(root, 'services/payments.js')]: { payOrderWithWeChat: async orderNo => { calls.payments.push(orderNo); return { paid: true }; }, ...payments },
  });
  loader.load('pages/order-detail/index.js');
  const page = loader.page;
  page.data = structuredClone(page.data);
  page.setData = patch => { calls.patches.push(patch); Object.assign(page.data, patch); };
  page.orderNo = 'fixture-order';
  page.data.order = normalizeOrder(rawOrder());
  return { page, calls };
}

test('dispatch estimates are authenticated, encoded, read-only GETs and do not send order mutations', async () => {
  const f = serviceFixture({ ok: true, dispatchEstimate: dto() });
  const result = await f.orders.fetchOrderDispatchEstimate('fixture/a?b');
  assert.equal(result.startDate, '2099-04-01');
  assert.equal(result.endDate, '2099-04-03');
  assert.equal(result.date, undefined);
  assert.equal(f.calls[0].path, '/api/account/orders/fixture%2Fa%3Fb/dispatch-estimate');
  assert.equal(f.calls[0].auth, 'required');
  assert.equal(f.calls[0].method, undefined);
  assert.equal(f.calls[0].data, undefined);
  assert.equal(f.calls.length, 1);
});

test('guest cannot issue an estimate request and missing order number fails without a request', async () => {
  let calls = 0;
  const loader = createLoader({ request() { calls++; } }, { [path.join(root, 'stores/session.js')]: { readAccessToken: () => '', clearSession() {} } });
  await assert.rejects(loader.load('services/orders.js').fetchOrderDispatchEstimate('fixture-order'), /AUTH_REQUIRED/);
  assert.equal(calls, 0);
  const f = serviceFixture({ ok: true, dispatchEstimate: dto() });
  for (const value of ['', '  ', null, undefined]) await assert.rejects(f.orders.fetchOrderDispatchEstimate(value), /ORDER_NO_REQUIRED/);
  assert.equal(f.calls.length, 0);
});

test('invalid dates, wrong timezone or malformed records cannot become an apparent unset or scheduled estimate', async () => {
  for (const response of [null, { ok: 'true', dispatchEstimate: dto() }, { ok: true }, ...[
    dto({ startDate: '2026-02-29' }), dto({ startDate: undefined }), dto({ startDate: null }), dto({ endDate: null }), dto({ startDate: '2099-04-04' }),
    dto({ timeZone: 'UTC' }), dto({ revision: -1 }), dto({ revision: 1.5 }), dto({ updatedAt: 'not a timestamp' }),
  ].map(dispatchEstimate => ({ ok: true, dispatchEstimate }))]) await assert.rejects(serviceFixture(response).orders.fetchOrderDispatchEstimate('fixture-order'), /INVALID_DISPATCH_ESTIMATE_RESPONSE/);
  for (const value of ['2026-04-31', '2026-13-01', '2026-00-01', '2026-01-00', '2026-2-03', '0000-01-01', '2026-10-18T00:00:00Z', 20261018, null]) assert.equal(isDispatchDate(value), false);
  assert.equal(isDispatchDate('2028-02-29'), true);
});

test('unset date is distinct from failure and never falls back to a product release date', () => {
  const order = rawOrder({ estimatedShipAt: '2099-05-01', product: { estimatedShipAt: '2099-05-01' } });
  const estimate = normalizeDispatchEstimate(dto({ status: 'UNSET', startDate: null, endDate: null, updatedAt: null, revision: 0 }));
  const presentation = dispatchEstimatePresentation(order, estimate);
  assert.equal(presentation.state, 'unset');
  assert.equal(presentation.title, '预计发货日期待安排');
  assert.equal(presentation.startDate, null);
  assert.equal(presentation.endDate, null);
  assert.ok(!JSON.stringify(presentation).includes('2099-05-01'));
  assert.equal(dispatchEstimatePresentation(order, null, { state: 'error' }).title, '预计发货日期暂不可用');
});

test('overdue derives from the Beijing calendar boundary, not device timezone, server label or stale status', () => {
  const estimate = normalizeDispatchEstimate(dto({ startDate: '2026-10-16', endDate: '2026-10-18', status: 'UNSET', label: 'do not display this claim' }));
  const lastMillisecond = dispatchEstimatePresentation(rawOrder(), estimate, { now: Date.parse('2026-10-18T15:59:59.999Z') });
  assert.equal(lastMillisecond.state, 'scheduled');
  assert.equal(lastMillisecond.title, '预计发货日期 2026年10月16日-2026年10月18日');
  const midnight = dispatchEstimatePresentation(rawOrder(), estimate, { now: Date.parse('2026-10-18T16:00:00.000Z') });
  assert.equal(midnight.state, 'overdue');
  assert.equal(midnight.title, '预计发货日期 2026年10月16日-2026年10月18日');
  assert.equal(midnight.hint, '预计日期已过，请联系商家了解进度。');
  assert.ok(!JSON.stringify(midnight).includes('do not display'));
});

test('ongoing and cross-year windows preserve the full range while only an expired end marks overdue', () => {
  const now = Date.parse('2026-10-18T04:00:00.000Z');
  const ongoing = dispatchEstimatePresentation(rawOrder(), { startDate: '2026-10-16', endDate: '2026-10-20' }, { now });
  assert.equal(ongoing.state, 'scheduled');
  assert.equal(ongoing.title, '预计发货日期 2026年10月16日-2026年10月20日');
  const crossYear = dispatchEstimatePresentation(rawOrder(), { startDate: '2026-12-30', endDate: '2027-01-05' }, { now });
  assert.equal(crossYear.title, '预计发货日期 2026年12月30日-2027年1月5日');
  assert.equal(isDispatchRange(null, null), true);
  assert.equal(isDispatchRange('2026-10-18', '2026-10-18'), true);
  assert.equal(isDispatchRange('2026-10-19', '2026-10-18'), false);
  assert.equal(isDispatchRange(null, '2026-10-18'), false);
  assert.throws(() => normalizeDispatchEstimate({ date: '2099-04-03', timeZone: 'Asia/Shanghai', updatedAt: null, revision: 0 }), /INVALID_DISPATCH_ESTIMATE_RESPONSE/);
});

test('only active paid unshipped physical orders show an estimate; no dates are invented for ineligible orders', () => {
  assert.equal(canShowDispatchEstimate(rawOrder()), true);
  assert.equal(canShowDispatchEstimate(rawOrder({ kind: 'GIFT_REDEMPTION' })), true);
  for (const patch of [
    { status: 'CANCELLED' }, { status: 'CLOSED' }, { status: 'CREATED' }, { paymentStatus: 'NOT_STARTED' }, { paymentStatus: 'PENDING' },
    { paymentStatus: 'REFUNDED' }, { paymentStatus: 'PARTIALLY_REFUNDED' }, { fulfillmentStatus: 'SHIPPED' }, { fulfillmentStatus: 'DELIVERED' }, { fulfillmentStatus: 'RETURNED' },
    { kind: 'GIFT_PURCHASE' }, { kind: 'UNKNOWN' }, { items: [{ refundAmountCents: 1 }] },
    { shipments: [{ status: 'SHIPPED' }] }, { shipment: { shippedAt: '2026-10-18T00:00:00.000Z' } },
  ]) {
    const order = rawOrder(patch);
    assert.equal(canShowDispatchEstimate(order), false, JSON.stringify(patch));
    assert.equal(dispatchEstimatePresentation(order, { startDate: '2099-04-01', endDate: '2099-04-03' }).visible, false);
  }
});

test('loading or failure cannot retain a prior scheduled date', () => {
  for (const state of ['loading', 'error']) {
    const presentation = dispatchEstimatePresentation(rawOrder(), { startDate: '2099-04-01', endDate: '2099-04-03' }, { state });
    assert.equal(presentation.startDate, null);
    assert.equal(presentation.endDate, null);
    assert.ok(!presentation.title.includes('2099'));
  }
});

test('any actual waybill or delivery evidence suppresses future dispatch promises even when order status is stale', () => {
  for (const shipment of [
    { trackingNo: 'LOCAL-ONLY' }, { trackingCompany: '示例快递' }, { shippedAt: '2026-10-18T04:00:00Z' },
    { deliveredAt: '2026-10-18T04:00:00Z' }, { status: 'SHIPPED' }, { status: 'DELIVERED' }, { status: 'RETURNED' },
  ]) assert.equal(canShowDispatchEstimate(rawOrder({ shipments: [shipment] })), false);
  assert.equal(canShowDispatchEstimate(rawOrder({ shipments: [{ trackingNo: '  ', trackingCompany: ' ', shippedAt: null, deliveredAt: null, status: 'PROCESSING' }] })), true);
});

test('successful refunds totaling the paid amount suppress estimates even with a stale PAID flag', () => {
  const normalized = rawOrder({ refunds: [{ refundStatus: 'SUCCEEDED', refundAmountCents: 2000 }, { refundStatus: 'SUCCEEDED', refundAmountCents: 2900 }] });
  assert.equal(normalized.paymentStatus, 'PAID');
  assert.equal(canShowDispatchEstimate(normalized), false);
  assert.equal(dispatchEstimatePresentation(normalized, { startDate: '2099-04-01', endDate: '2099-04-03' }).visible, false);
  assert.equal(canShowDispatchEstimate(rawOrder({ refunds: [{ refundStatus: 'FAILED', refundAmountCents: 4900 }] })), true);
});

test('each order load, foreground refresh and pull-down reads the independent estimate without polling', async () => {
  const f = pageFixture();
  await f.page.loadOrder(); await tick();
  assert.equal(f.calls.estimates.length, 1);
  assert.equal(f.page.data.dispatchEstimate.state, 'scheduled');
  f.page.onShow(); await tick();
  assert.equal(f.calls.estimates.length, 2);
  f.page.onPullDownRefresh(); await tick();
  assert.equal(f.calls.estimates.length, 3);
  await tick();
  assert.equal(f.calls.estimates.length, 3);
  assert.equal(f.calls.storage.length, 0);
  assert.equal(f.calls.logistics.length, 0);
});

test('estimate failure does not fail the order page, payment state or after-sales navigation', async () => {
  const f = pageFixture({ fetch: async () => { throw Error('NETWORK_REQUEST_FAILED'); } });
  await f.page.loadOrder(); await tick();
  assert.equal(f.page.data.error, '');
  assert.equal(f.page.data.order.paymentStatus, 'PAID');
  assert.equal(f.page.data.loading, false);
  assert.equal(f.page.data.dispatchEstimate.state, 'error');
  f.page.requestAfterSales();
  assert.deepEqual(f.calls.routes, ['/pages/after-sales-create/index?orderNo=fixture-order']);
});

test('a new order load discards an older in-flight estimate before the new order read finishes', async () => {
  let finishEstimate, finishOrder;
  const f = pageFixture({ fetch: () => new Promise(resolve => { finishEstimate = resolve; }), readOrder: () => new Promise(resolve => { finishOrder = resolve; }) });
  const oldEstimate = f.page.refreshDispatchEstimate(f.page.data.order);
  const refresh = f.page.loadOrder();
  finishEstimate({ startDate: '2099-01-01', endDate: '2099-01-03' }); await oldEstimate;
  assert.equal(f.page.data.dispatchEstimate.state, 'loading');
  assert.equal(f.page.data.dispatchEstimate.startDate, null);
  assert.equal(f.page.data.dispatchEstimate.endDate, null);
  finishOrder(normalizeOrder(rawOrder({ fulfillmentStatus: 'SHIPPED' }))); await refresh;
  assert.equal(f.page.data.dispatchEstimate.visible, false);
});

test('older successful or failed estimate responses cannot replace a newer schedule', async () => {
  for (const failOld of [false, true]) {
    let resolveOld, rejectOld, reads = 0;
    const f = pageFixture({ fetch: () => ++reads === 1 ? new Promise((resolve, reject) => { resolveOld = resolve; rejectOld = reject; }) : Promise.resolve({ startDate: '2099-06-01', endDate: '2099-06-03' }) });
    const old = f.page.refreshDispatchEstimate(f.page.data.order);
    await f.page.refreshDispatchEstimate(f.page.data.order);
    if (failOld) rejectOld(Error('old request failed')); else resolveOld({ startDate: '2099-01-01', endDate: '2099-01-03' });
    await old;
    assert.equal(f.page.data.dispatchEstimate.startDate, '2099-06-01');
    assert.equal(f.page.data.dispatchEstimate.endDate, '2099-06-03');
    assert.equal(f.page.data.dispatchEstimate.state, 'scheduled');
  }
});

test('newly shipped order drops any schedule and keeps actual shipment timestamp', async () => {
  const f = pageFixture();
  await f.page.refreshDispatchEstimate(f.page.data.order);
  const shipped = normalizeOrder(rawOrder({ fulfillmentStatus: 'SHIPPED', shipments: [{ status: 'SHIPPED', shippedAt: '2026-10-18T04:00:00.000Z' }] }));
  f.page.setData({ order: shipped });
  await f.page.refreshDispatchEstimate(shipped);
  assert.equal(f.page.data.dispatchEstimate.visible, false);
  assert.equal(f.calls.estimates.length, 1);
  assert.ok(f.page.data.order.delivery.shippedAtLabel);
});

test('different order identity or leaving the page discards pending estimates', async () => {
  for (const leave of [false, true]) {
    let finish;
    const f = pageFixture({ fetch: () => new Promise(resolve => { finish = resolve; }) });
    const pending = f.page.refreshDispatchEstimate(f.page.data.order);
    if (leave) f.page.onUnload(); else f.page.orderNo = 'different-order';
    const patches = f.calls.patches.length;
    finish({ startDate: '2099-01-01', endDate: '2099-01-03' }); await pending;
    assert.equal(f.calls.patches.length, patches);
  }
});

test('receipt transition cannot preserve an earlier estimate or derive a new one', async () => {
  const f = pageFixture();
  await f.page.refreshDispatchEstimate(f.page.data.order);
  await f.page.syncReceipt();
  assert.equal(f.page.data.order.fulfillmentStatus, 'DELIVERED');
  assert.equal(f.page.data.dispatchEstimate.visible, false);
  assert.equal(f.calls.estimates.length, 1);
  assert.deepEqual(f.calls.receipts, ['fixture-order']);
});

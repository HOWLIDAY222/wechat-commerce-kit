const test = require('node:test');
const assert = require('node:assert/strict');
const { createLoader } = require('./test-loader.cjs');
const { normalizeOrder, logisticsPresentation } = createLoader().load('models/order.js');

const order = patch => ({
  orderNo: 'QA-LOCAL-ONLY', status: 'CONFIRMED', paymentStatus: 'PAID', fulfillmentStatus: 'PROCESSING', currency: 'CNY',
  subtotalCents: 4900, shippingFeeCents: 0, payableAmountCents: 4900,
  items: [{ id: 'fixture-item', productName: 'X1 Air', color: '白色', size: 'M', quantity: 1, unitPriceCents: 4900 }],
  shipments: [], ...patch,
});

test('paid, preparing, shipped and delivered progress follows merchant order state only', () => {
  const paid = normalizeOrder(order({ fulfillmentStatus: 'PENDING' }));
  assert.equal(paid.delivery.title, '已收到付款');
  assert.equal(paid.delivery.steps.find(step => step.current).key, 'paid');
  assert.equal(paid.delivery.steps[1].complete, false);
  assert.equal(paid.delivery.copy, '我们已收到你的付款，很快就会开始为你备货。');
  const preparing = normalizeOrder(order());
  assert.equal(preparing.delivery.title, '准备发货');
  assert.equal(preparing.delivery.steps.filter(step => step.complete).length, 1);
  assert.equal(preparing.delivery.steps.find(step => step.current).key, 'preparing');
  const shipped = normalizeOrder(order({ fulfillmentStatus: 'SHIPPED', shipments: [{ trackingNo: 'LOCAL-ONLY', shippedAt: '2026-10-18T04:00:00.000Z' }] }));
  assert.equal(shipped.delivery.steps.filter(step => step.complete).length, 3);
  assert.equal(shipped.delivery.steps[3].complete, false);
  assert.equal(shipped.delivery.title, '已发货');
  assert.ok(shipped.delivery.shippedAtLabel);
  const delivered = normalizeOrder(order({ fulfillmentStatus: 'DELIVERED' }));
  assert.equal(delivered.delivery.steps.filter(step => step.complete).length, 4);
  assert.equal(delivered.delivery.title, '已送达');
});

test('cancelled, closed, unpaid, refunded and returned orders never show a fake completed delivery timeline', () => {
  for (const patch of [
    { status: 'CANCELLED', fulfillmentStatus: 'DELIVERED' }, { status: 'CLOSED', fulfillmentStatus: 'SHIPPED' },
    { paymentStatus: 'NOT_STARTED', fulfillmentStatus: 'DELIVERED' }, { paymentStatus: 'PENDING' }, { paymentStatus: 'FAILED' },
    { paymentStatus: 'REFUNDED', fulfillmentStatus: 'DELIVERED' }, { paymentStatus: 'PARTIALLY_REFUNDED' },
    { fulfillmentStatus: 'RETURNED' },
  ]) {
    const normalized = normalizeOrder(order(patch));
    assert.equal(normalized.delivery.showProgress, false, JSON.stringify(patch));
    assert.equal(normalized.delivery.steps.length, 0);
  }
  const partial = order(); partial.items[0].refundAmountCents = 100;
  assert.equal(normalizeOrder(partial).delivery.title, '部分退款');
});

test('missing shipping timestamps or fulfillment status never manufacture arrival dates or transport progress', () => {
  const normalized = normalizeOrder(order({ fulfillmentStatus: 'UNKNOWN' }));
  assert.equal(normalized.delivery.title, '已收到付款');
  assert.equal(normalized.delivery.steps.filter(step => step.complete).length, 1);
  assert.equal(normalized.delivery.shippedAtLabel, '');
  assert.ok(!JSON.stringify(normalized.delivery).includes('预计'));
  assert.equal(normalizeOrder(order({ paymentStatus: 'UNKNOWN' })).delivery.title, '支付状态待确认');
});

test('gift redemption states redemption truthfully instead of claiming a new payment', () => {
  const normalized = normalizeOrder(order({ kind: 'GIFT_REDEMPTION', payableAmountCents: 0 }));
  assert.equal(normalized.delivery.steps[0].label, '已兑换');
  assert.equal(normalized.payableAmount, '¥0');
});

test('product summary uses actual item quantities and optional actual image without inventing a product photo', () => {
  assert.equal(normalizeOrder(order()).items[0].thumbnail, '');
  const normalized = normalizeOrder(order({ items: [{ id: 'one', quantity: 2, unitPriceCents: 4900, productImage: '/public-product.webp' }, { id: 'two', quantity: 1, unitPriceCents: 6900 }] }));
  assert.equal(normalized.totalQuantity, 3);
  assert.equal(normalized.items[0].thumbnail, 'https://example.invalid/public-product.webp');
});

test('all documented WeChat trace nodes are display-only and preserve merchant permissions', () => {
  const expected = ['暂无揽收信息', '已揽件', '运输中', '派件中', '已签收', '物流异常', '代签收'];
  const normalized = normalizeOrder(order({ fulfillmentStatus: 'SHIPPED', shipments: [{ trackingNo: 'LOCAL-ONLY' }] }));
  const before = JSON.stringify(normalized);
  for (let status = 0; status <= 6; status++) {
    const presentation = logisticsPresentation({ available: true, status, waybillToken: 'fixture-local-only' });
    assert.equal(presentation.logisticsTraceLabel, expected[status]);
    assert.ok(!JSON.stringify(presentation).includes('fixture-local-only'));
  }
  assert.equal(JSON.stringify(normalized), before);
  assert.equal(normalized.fulfillmentStatus, 'SHIPPED');
  assert.equal(normalized.canConfirmReceipt, true);
});

test('missing or malformed trace status is never shown as normal transport', () => {
  for (const status of [null, undefined, '2', -1, 7, NaN]) {
    const result = logisticsPresentation({ available: true, status });
    assert.equal(result.logisticsState, 'unavailable');
    assert.equal(result.logisticsTraceLabel, '');
    assert.match(result.logisticsHint, /暂未获取.*重试/);
  }
});

test('registration pending, sync pending, historical and failed states have honest distinct guidance', () => {
  assert.equal(logisticsPresentation({ available: false, reason: 'NOT_REGISTERED' }).logisticsState, 'preparing');
  assert.match(logisticsPresentation({ available: false, reason: 'SHIPPING_SYNC_PENDING' }).logisticsStatusLabel, /同步中/);
  assert.equal(logisticsPresentation({ available: false, reason: 'BEFORE_ACTIVATION' }).logisticsState, 'unavailable');
  for (const reason of ['FAILED', 'UNKNOWN', 'TRACKING_MISMATCH']) assert.equal(logisticsPresentation({ available: false, reason }).logisticsState, 'error');
  for (const reason of ['DISABLED', 'ORDER_NOT_FOUND', 'UNSUPPORTED_ORDER', 'NOT_SHIPPED', 'SCHEMA_REQUIRED']) assert.equal(logisticsPresentation({ available: false, reason }).logisticsState, 'unavailable');
});

test('multiple shipments select the same latest waybill in either API array order without mutating that array', () => {
  const older = { id: 'older', status: 'SHIPPED', trackingCompany: '旧快递', trackingNo: 'OLD-LOCAL-ONLY', shippedAt: '2026-10-17T01:00:00.000Z', createdAt: '2026-10-17T00:00:00.000Z' };
  const latest = { id: 'latest', status: 'DELIVERED', trackingCompany: '新快递', trackingNo: 'NEW-LOCAL-ONLY', shippedAt: '2026-10-18T01:00:00.000Z', createdAt: '2026-10-18T00:00:00.000Z' };
  for (const shipments of [[older, latest], [latest, older]]) {
    const before = JSON.stringify(shipments);
    const normalized = normalizeOrder(order({ fulfillmentStatus: 'SHIPPED', shipments }));
    assert.equal(normalized.shipment.id, 'latest');
    assert.equal(normalized.trackingSummary, '新快递 · NEW-LOCAL-ONLY');
    assert.equal(JSON.stringify(shipments), before);
  }
});

test('nullable shipment dates match backend DESC nulls-first and retain stable order when no dates distinguish them', () => {
  const shipped = { id: 'shipped', status: 'SHIPPED', trackingNo: 'OLD-LOCAL-ONLY', shippedAt: '2026-10-18T01:00:00.000Z', createdAt: '2026-10-18T00:00:00.000Z' };
  const pendingOld = { id: 'pending-old', status: 'PROCESSING', trackingNo: null, shippedAt: null, createdAt: '2026-10-17T00:00:00.000Z' };
  const pendingNew = { id: 'pending-new', status: 'PROCESSING', trackingNo: null, shippedAt: null, createdAt: '2026-10-18T00:00:00.000Z' };
  const normalized = normalizeOrder(order({ fulfillmentStatus: 'SHIPPED', shipments: [shipped, pendingOld, pendingNew] }));
  assert.equal(normalized.shipment.id, 'pending-new');
  assert.equal(normalized.canViewLogistics, false);
  const unknownDates = [{ id: 'first', status: 'PROCESSING' }, { id: 'second', status: 'SHIPPED' }];
  assert.equal(normalizeOrder(order({ shipments: unknownDates })).shipment.id, 'first');
  assert.equal(normalizeOrder(order({ shipments: [...unknownDates].reverse() })).shipment.id, 'second');
});

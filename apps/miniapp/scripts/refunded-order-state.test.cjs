const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader, root } = require('./test-loader.cjs');

const rawOrder = patch => ({
  orderNo: 'QA-REFUND-ONLY', status: 'CONFIRMED', paymentStatus: 'PAID', fulfillmentStatus: 'PENDING',
  currency: 'CNY', payableAmountCents: 10000, subtotalCents: 10000, shippingFeeCents: 0,
  items: [{ id: 'qa-item', productName: 'X1 Air', quantity: 2, unitPriceCents: 5000 }], shipments: [],
  ...patch,
});
const fullSummary = { state: 'REFUNDED', fullyRefunded: true, succeededAmountCents: 10000, processingAmountCents: 0 };
const normalize = createLoader().load('models/order.js').normalizeOrder;
function assertInactive(order) {
  for (const key of ['canPay', 'canCancel', 'canConfirmReceipt', 'canRequestAfterSales']) assert.equal(order[key], false, key);
  assert.equal(order.items[0].refundableQuantity, 0);
  assert.equal(order.delivery.showProgress, false);
  assert.equal(order.delivery.steps.length, 0);
}
function orderList(orders) {
  const loader = createLoader({ stopPullDownRefresh() {} }, {
    [path.join(root, 'services/orders.js')]: { fetchOrders: async () => orders },
  });
  loader.load('pages/orders/index.js');
  const page = loader.page;
  page.data = structuredClone(page.data);
  page.setData = patch => Object.assign(page.data, patch);
  return page;
}

test('fully refunded pending/preparing orders show refunded and not shipped without mutating persisted states', () => {
  for (const fulfillmentStatus of ['PENDING', 'PROCESSING']) {
    const raw = rawOrder({ paymentStatus: 'REFUNDED', fulfillmentStatus });
    const before = JSON.stringify(raw), order = normalize(raw);
    assert.equal(order.isFullyRefunded, true);
    assert.equal(order.paymentStatusLabel, '已退款');
    assert.equal(order.fulfillmentStatusLabel, '未发货');
    assert.equal(order.delivery.title, '已退款');
    assert.match(order.delivery.copy, /商品未发货/);
    assert.equal(order.paymentStatus, 'REFUNDED');
    assert.equal(order.fulfillmentStatus, fulfillmentStatus);
    assert.equal(JSON.stringify(raw), before);
    assertInactive(order);
  }
});

test('only the exact authoritative full-refund summary supplies the raw PAID fallback', () => {
  const order = normalize(rawOrder({ refundSummary: fullSummary }));
  assert.equal(order.paymentStatus, 'PAID');
  assert.equal(order.refundSummary, fullSummary);
  assert.equal(order.paymentStatusLabel, '已退款');
  assert.equal(order.fulfillmentStatusLabel, '未发货');
  assert.equal(order.isFullyRefunded, true);
  assertInactive(order);
  for (const refundSummary of [undefined, { state: 'REFUNDED' }, { state: 'REFUNDED', fullyRefunded: 'true' },
    { state: 'PARTIAL', fullyRefunded: true, succeededAmountCents: 10000 },
    { state: 'PROCESSING', fullyRefunded: true, processingAmountCents: 10000 },
    { state: 'refunded', fullyRefunded: true }, { state: 'NONE', succeededAmountCents: 10000 }]) {
    const active = normalize(rawOrder({ refundSummary }));
    assert.equal(active.isFullyRefunded, false, JSON.stringify(refundSummary));
    assert.equal(active.paymentStatusLabel, '已支付');
    assert.equal(active.canRequestAfterSales, true);
    assert.equal(active.fulfillmentStatusLabel, '待备货');
  }
});

test('literal refund state wins over a missing/conflicting summary and closed workflow labels', () => {
  for (const status of ['CREATED', 'CONFIRMED', 'CANCELLED', 'CLOSED']) {
    const order = normalize(rawOrder({ status, paymentStatus: 'REFUNDED', refundSummary: { state: 'NONE', fullyRefunded: false } }));
    assert.equal(order.isFullyRefunded, true);
    assert.equal(order.delivery.title, status === 'CLOSED' ? '订单已结束' : '已退款');
    assert.equal(order.status, status);
    assertInactive(order);
  }
});

test('authoritative refund fallback disables stale payment/cancellation and receipt actions', () => {
  for (const patch of [
    { status: 'CREATED', paymentStatus: 'NOT_STARTED' },
    { status: 'CREATED', paymentStatus: 'FAILED' },
    { status: 'CONFIRMED', paymentStatus: 'PAID', fulfillmentStatus: 'SHIPPED' },
  ]) assertInactive(normalize(rawOrder({ ...patch, refundSummary: fullSummary })));
});

test('shipped and delivered refunded orders keep their actual tracking and shipment timestamps', () => {
  for (const fulfillmentStatus of ['SHIPPED', 'DELIVERED']) {
    for (const patch of [{ paymentStatus: 'REFUNDED' }, { refundSummary: fullSummary }]) {
      const shipment = { id: 'qa-shipment', trackingNo: 'QA-NO-CARRIER-CALL', trackingCompany: '合成承运商', status: fulfillmentStatus, shippedAt: '2026-10-18T02:00:00Z' };
      const raw = rawOrder({ ...patch, fulfillmentStatus, shipments: [shipment] }), order = normalize(raw);
      assert.equal(order.delivery.title, '已退款');
      assert.equal(order.fulfillmentStatusLabel, fulfillmentStatus === 'SHIPPED' ? '已发货' : '已签收');
      assert.equal(order.fulfillmentStatus, fulfillmentStatus);
      assert.equal(order.shipment, shipment);
      assert.equal(order.shipments, raw.shipments);
      assert.equal(order.canViewLogistics, true);
      assert.equal(order.trackingSummary, '合成承运商 · QA-NO-CARRIER-CALL');
      assert.ok(order.delivery.shippedAtLabel);
      assertInactive(order);
    }
  }
});

test('returned refunded history stays returned rather than being relabelled not shipped', () => {
  const order = normalize(rawOrder({ paymentStatus: 'REFUNDED', fulfillmentStatus: 'RETURNED', shipments: [{ trackingNo: 'QA-RETURN-HISTORY' }] }));
  assert.equal(order.fulfillmentStatusLabel, '已退回');
  assert.equal(order.shipment.trackingNo, 'QA-RETURN-HISTORY');
  assert.equal(order.delivery.title, '已退款');
});

test('partial and processing refunds retain remaining fulfillment and after-sales eligibility', () => {
  for (const paymentStatus of ['PAID', 'PARTIALLY_REFUNDED']) {
    const order = normalize(rawOrder({ paymentStatus, fulfillmentStatus: 'PROCESSING', refundSummary: { state: 'PARTIAL', fullyRefunded: false, succeededAmountCents: 1000 }, items: [{ id: 'qa-item', quantity: 2, unitPriceCents: 5000, refundAmountCents: 1000 }] }));
    assert.equal(order.isFullyRefunded, false);
    assert.equal(order.fulfillmentStatusLabel, '备货中');
    assert.equal(order.paymentStatusLabel, '部分退款');
    assert.equal(order.canRequestAfterSales, true);
    assert.equal(order.items[0].refundableQuantity, 2);
  }
  const processing = normalize(rawOrder({ refundSummary: { state: 'PROCESSING', fullyRefunded: false, processingAmountCents: 10000 } }));
  assert.equal(processing.delivery.title, '已收到付款');
  assert.equal(processing.isFullyRefunded, false);
  assert.equal(processing.canRequestAfterSales, true);
});

test('pending-shipment filter and matched count exclude raw and summary refunded orders, preserving all history', async () => {
  const orders = [
    normalize(rawOrder({ orderNo: 'raw-full', paymentStatus: 'REFUNDED' })),
    normalize(rawOrder({ orderNo: 'summary-full', refundSummary: fullSummary })),
    normalize(rawOrder({ orderNo: 'paid' })),
    normalize(rawOrder({ orderNo: 'partial', paymentStatus: 'PARTIALLY_REFUNDED', refundSummary: { state: 'PARTIAL', fullyRefunded: false } })),
  ];
  const page = orderList(orders);
  page.onLoad({ filter: 'unshipped' });
  await page.loadOrders();
  assert.deepEqual(Array.from(page.data.visibleOrders, item => item.orderNo), ['paid', 'partial']);
  assert.equal(page.data.matchedOrderCount, 2);
  assert.equal(page.data.activeFilter, 'unshipped');
  page.applyFilter('all', orders);
  assert.equal(page.data.matchedOrderCount, 4);
  assert.equal(page.data.visibleOrders.length, 4);
});

test('refunded unshipped orders leave shipment/receipt filters while shipped refund logistics remain discoverable', () => {
  const orders = [
    normalize(rawOrder({ orderNo: 'not-shipped', refundSummary: fullSummary })),
    normalize(rawOrder({ orderNo: 'shipped-full', paymentStatus: 'REFUNDED', fulfillmentStatus: 'SHIPPED', shipments: [{ trackingNo: 'QA-TRACKING' }] })),
    normalize(rawOrder({ orderNo: 'shipped-paid', fulfillmentStatus: 'SHIPPED', shipments: [{ trackingNo: 'QA-ACTIVE' }] })),
  ];
  const page = orderList(orders);
  page.applyFilter('shipped', orders);
  assert.deepEqual(Array.from(page.data.visibleOrders, item => item.orderNo), ['shipped-paid']);
  page.applyFilter('shipping', orders);
  assert.deepEqual(Array.from(page.data.visibleOrders, item => item.orderNo), ['shipped-full', 'shipped-paid']);
  page.applyFilter('unpaid', orders);
  assert.equal(page.data.matchedOrderCount, 0);
});

test('full-refund history remains paginated in all orders without contaminating pending count', () => {
  const orders = Array.from({ length: 12 }, (_, index) => normalize(rawOrder({ orderNo: 'full-'+index, refundSummary: fullSummary })));
  const page = orderList(orders);
  page.applyFilter('all', orders);
  assert.equal(page.data.matchedOrderCount, 12);
  assert.equal(page.data.visibleOrders.length, 10);
  page.renderNextPage();
  assert.equal(page.data.visibleOrders.length, 12);
  assert.equal(page.data.hasMore, false);
  page.applyFilter('unshipped', orders);
  assert.equal(page.data.matchedOrderCount, 0);
});

test('actual order service normalization makes the summary guard available to the list', async () => {
  const loader = createLoader({ getStorageSync: () => null }, {
    [path.join(root, 'services/http.js')]: { request: async () => ({ ok: true, orders: [rawOrder({ refundSummary: fullSummary })] }) },
  });
  const [order] = await loader.load('services/orders.js').fetchOrders();
  assert.equal(order.isFullyRefunded, true);
  assert.equal(order.paymentStatus, 'PAID');
  assert.equal(order.paymentStatusLabel, '已退款');
});

test('real detail methods cannot start business writes for a normalized fully refunded order', async () => {
  const calls = [];
  const blocked = name => () => { calls.push(name); throw Error('Unexpected business write'); };
  const loader = createLoader({ showModal: blocked('modal'), navigateTo: blocked('after-sales'), stopPullDownRefresh() {} }, {
    [path.join(root, 'services/orders.js')]: { cancelOrder: blocked('cancel'), confirmOrderReceipt: blocked('receipt') },
    [path.join(root, 'services/payments.js')]: { payOrderWithWeChat: blocked('pay') },
  });
  loader.load('pages/order-detail/index.js');
  const page = loader.page;
  page.data = structuredClone(page.data);
  page.data.order = normalize(rawOrder({ refundSummary: fullSummary }));
  page.setData = patch => Object.assign(page.data, patch);
  page.cancelOrder(); page.confirmReceipt(); page.requestAfterSales(); await page.payOrder();
  assert.deepEqual(calls, []);
});

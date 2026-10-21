const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader, root } = require('./test-loader.cjs');
const loader = createLoader();
const normalize = loader.load('models/after-sales.js').normalizeAfterSales;
const normalizeOrder = loader.load('models/order.js').normalizeOrder;
const raw = patch => ({ afterSalesNo: 'QA-AS-STAGE', orderNo: 'QA-ORDER-STAGE', type: 'return_refund', status: 'waiting_return', reason: '合成测试', refundAmountCents: 10000, imageUrls: [], items: [], messages: [], createdAt: '2026-10-18T00:00:00Z', ...patch });
const full = { state: 'REFUNDED', fullyRefunded: true, succeededAmountCents: 10000, processingAmountCents: 0 };

test('only completed rejected cancelled are inactive in either API casing', () => {
  for (const status of ['completed', 'COMPLETED', 'rejected', 'REJECTED', 'cancelled', 'CANCELLED']) {
    const item = normalize(raw({ status }));
    assert.equal(item.status, status);
    assert.equal(item.isActive, false, status);
    assert.equal(item.canMessage, false);
    assert.equal(item.canSubmitReturnShipment, false);
    assert.equal(item.showRefundPendingNotice, false);
    if (status.toLowerCase() === 'completed') {
      assert.equal(item.statusLabel, '售后已完成');
      assert.equal(item.showRefundPendingNotice, false);
    }
  }
  for (const status of ['submitted', 'reviewing', 'approved', 'waiting_return', 'return_in_transit', 'received', 'inspecting', 'refund_processing', 'refunded', 'REFUNDED', 'exchange_shipping', 'reshipped', 'UNKNOWN']) assert.equal(normalize(raw({ status })).isActive, true, status);
});

test('refunded return request explicitly waits for return confirmation instead of claiming service completion', () => {
  for (const status of ['refunded', 'REFUNDED']) {
    const input = raw({ status, refundSummary: full, returnTrackingNo: 'QA-TRACKING-DOES-NOT-PROVE-RECEIPT' });
    const before = JSON.stringify(input), item = normalize(input);
    assert.equal(item.statusLabel, '退款已完成，待确认退货');
    assert.equal(item.statusTitle, '已退款');
    assert.equal(item.stageLabel, '待确认退货');
    assert.equal(item.showRefundPendingNotice, false);
    assert.equal(item.isActive, true);
    assert.equal(item.canMessage, false); // Preserve the server's existing mutation boundary.
    assert.equal(item.canUploadEvidence, false);
    assert.equal(JSON.stringify(input), before);
  }
});

test('refund-only service waits for explicit completion and a completed service stays complete without a summary', () => {
  assert.equal(normalize(raw({ type: 'refund_only', status: 'refunded' })).statusLabel, '退款已完成，待结束售后');
  const completed = normalize(raw({ status: 'completed', refundSummary: undefined }));
  assert.equal(completed.statusLabel, '售后已完成');
  assert.equal(completed.isActive, false);
});

test('each after-sales phase has specific copy and unknown phases are honestly pending confirmation', () => {
  const labels = { submitted: '申请已提交', reviewing: '申请审核中', approved: '申请已通过', rejected: '申请未通过', waiting_return: '等待寄回', return_in_transit: '退货运输中', received: '退货已收到', inspecting: '退货验收中', refund_processing: '退款处理中', exchange_shipping: '换货商品发出中', reshipped: '补发商品已发出', cancelled: '申请已取消' };
  for (const [status, label] of Object.entries(labels)) {
    assert.equal(normalize(raw({ status })).statusLabel, label);
    assert.equal(normalize(raw({ status })).showRefundPendingNotice, !['rejected', 'cancelled'].includes(status));
  }
  assert.equal(normalize(raw({ status: 'UNKNOWN' })).statusLabel, '售后状态待确认');
  assert.equal(normalize(raw({ status: 'UNKNOWN' })).showRefundPendingNotice, false);
  assert.equal(normalize(raw({ status: 'waiting_return', refundSummary: full })).showRefundPendingNotice, false);
  assert.equal(normalize(raw({ status: 'waiting_return', refundSummary: { state: 'PARTIAL', fullyRefunded: false } })).showRefundPendingNotice, true);
  assert.equal(normalize(raw({ status: 'waiting_return', refundSummary: { state: 'REFUNDED', fullyRefunded: false } })).showRefundPendingNotice, true);
  assert.equal(normalize(raw({ status: 'waiting_return', refundSummary: { state: 'PROCESSING', fullyRefunded: true } })).showRefundPendingNotice, true);
});

test('closed fully refunded orders display ended lifecycle and retain their separate refund and logistics labels', () => {
  for (const fulfillmentStatus of ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED']) {
    const order = normalizeOrder({ status: 'CLOSED', paymentStatus: 'REFUNDED', fulfillmentStatus, items: [], shipments: [{ trackingNo: 'QA-HISTORY' }], refundSummary: full });
    assert.equal(order.delivery.title, '订单已结束');
    assert.equal(order.orderStatusLabel, '订单已结束');
    assert.equal(order.lifecycleLabel, '订单已结束');
    assert.equal(order.paymentStatusLabel, '已退款');
    assert.equal(order.canViewLogistics, ['SHIPPED', 'DELIVERED'].includes(fulfillmentStatus));
    assert.equal(order.shipment.trackingNo, 'QA-HISTORY');
  }
  const partial = normalizeOrder({ status: 'CONFIRMED', paymentStatus: 'PARTIALLY_REFUNDED', fulfillmentStatus: 'PROCESSING', items: [] });
  assert.equal(partial.lifecycleLabel, '');
  assert.equal(partial.fulfillmentStatusLabel, '备货中');
});

test('normal unshipped stages avoid a generic pending processing label', () => {
  for (const paymentStatus of ['PAID', 'PARTIALLY_REFUNDED']) assert.equal(normalizeOrder({ status: 'CONFIRMED', paymentStatus, fulfillmentStatus: 'PENDING' }).fulfillmentStatusLabel, '待备货');
  for (const paymentStatus of ['NOT_STARTED', 'FAILED', 'REFUNDED']) assert.equal(normalizeOrder({ status: 'CREATED', paymentStatus, fulfillmentStatus: 'PENDING' }).fulfillmentStatusLabel, '未发货');
  assert.equal(normalizeOrder({ fulfillmentStatus: 'UNKNOWN' }).fulfillmentStatusLabel, '配送状态待确认');
});

test('refunded but uncompleted service remains active and blocks duplicate after-sales requests', () => {
  const order = { status: 'CONFIRMED', paymentStatus: 'PARTIALLY_REFUNDED', fulfillmentStatus: 'PENDING', items: [{ id: 'i', quantity: 2, unitPriceCents: 5000, refundAmountCents: 1000 }], afterSalesRequests: [{ status: 'REFUNDED', items: [{ orderItemId: 'i', quantity: 1 }], refunds: [{ refundStatus: 'SUCCEEDED' }] }] };
  assert.equal(normalizeOrder(order).items[0].afterSalesPending, true);
  assert.equal(normalizeOrder(order).canRequestAfterSales, false);
  order.afterSalesRequests[0].status = 'COMPLETED';
  assert.equal(normalizeOrder(order).items[0].afterSalesPending, false);
  assert.equal(normalizeOrder(order).canRequestAfterSales, true);
});

test('actual service and list filter count active records without hiding completed history', async () => {
  const records = ['completed', 'refunded', 'waiting_return', 'rejected', 'cancelled'].map((status, index) => raw({ status, afterSalesNo: 'QA-AS-'+index }));
  const l = createLoader({ stopPullDownRefresh() {} }, { [path.join(root, 'services/http.js')]: { request: async () => ({ ok: true, afterSales: records }) } });
  l.load('pages/after-sales/index.js');
  const p = l.page; p.data = structuredClone(p.data); p.setData = patch => Object.assign(p.data, patch);
  await p.loadItems();
  assert.equal(p.data.activeCount, 2);
  assert.equal(p.data.visibleItems.length, 5);
  assert.equal(p.data.items.find(item => item.status === 'completed').statusLabel, '售后已完成');
  p.chooseFilter({ currentTarget: { dataset: { value: 'active' } } });
  assert.deepEqual(Array.from(p.data.visibleItems, item => item.status), ['refunded', 'waiting_return']);
  p.chooseFilter({ currentTarget: { dataset: { value: 'all' } } });
  assert.equal(p.data.visibleItems.length, 5);
});

test('closed-only list reports zero active and clears displayed history on logout', async () => {
  const l = createLoader({ getStorageSync: () => null, stopPullDownRefresh() {} }, { [path.join(root, 'services/after-sales.js')]: { fetchAfterSalesList: async () => ['completed', 'rejected', 'cancelled'].map(status => normalize(raw({ status }))) } });
  l.load('pages/after-sales/index.js');const p=l.page;p.data=structuredClone(p.data);p.setData=patch=>Object.assign(p.data,patch);
  await p.loadItems();p.applyFilter('active',p.data.items);
  assert.equal(p.data.activeCount,0);assert.equal(p.data.visibleItems.length,0);
  p.onShow();assert.equal(p.data.loggedIn,false);assert.equal(p.data.items.length,0);assert.equal(p.data.visibleItems.length,0);assert.equal(p.data.activeCount,0);
});

test('actual detail refresh displays completed only when the service GET explicitly returns completed', async () => {
  let status='refunded';
  const l=createLoader({stopPullDownRefresh(){}},{[path.join(root,'services/http.js')]:{request:async()=>({ok:true,afterSales:raw({status,refundSummary:full})})},[path.join(root,'services/evidence.js')]:{loadEvidenceImages:async item=>({...item,evidenceImages:[]})}});
  l.load('pages/after-sales-detail/index.js');const p=l.page;p.data=structuredClone(p.data);p.setData=patch=>Object.assign(p.data,patch);p.afterSalesNo='QA-AS-STAGE';
  await p.loadItem();assert.equal(p.data.item.statusLabel,'退款已完成，待确认退货');assert.equal(p.data.item.isActive,true);assert.equal(p.data.item.showRefundPendingNotice,false);
  status='completed';await p.loadItem();assert.equal(p.data.item.statusLabel,'售后已完成');assert.equal(p.data.item.isActive,false);assert.equal(p.data.refundDisplay.succeededLabel,'已退款');assert.equal(p.data.item.showRefundPendingNotice,false);
});

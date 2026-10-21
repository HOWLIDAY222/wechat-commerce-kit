const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createLoader, root } = require('./test-loader.cjs');

const shipped = () => ({
  orderNo: 'fixture-order', status: 'CONFIRMED', paymentStatus: 'PAID', fulfillmentStatus: 'SHIPPED',
  canViewLogistics: true, canConfirmReceipt: true, canRequestAfterSales: true,
  shipment: { trackingNo: 'fixture-waybill' },
});
const logistics = () => ({ available: true, waybillToken: 'fixture-only-token', status: 'BOUND' });

function pluginFixture({ plugin = { openWaybillTracking() {} }, requireAvailable = true, asyncAvailable = true, requireError, loadPlugin, wx = {}, timers = {}, calls = { plugins: [] } } = {}) {
  const context = { exports: {}, wx, Promise, setTimeout: timers.setTimeout || setTimeout, clearTimeout: timers.clearTimeout || clearTimeout };
  if (requireAvailable) {
    context.requirePlugin = () => { throw Error('synchronous plugin loading is forbidden'); };
    if (asyncAvailable) context.requirePlugin.async = name => {
      calls.plugins.push(name);
      if (requireError) return Promise.reject(requireError);
      return loadPlugin ? loadPlugin() : Promise.resolve(plugin);
    };
  }
  const source = fs.readFileSync(path.join(root, 'services/logistics-plugin.js'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, context);
  return { api: context.exports, calls };
}

function pageFixture({ fetch = async () => logistics(), plugin = { openWaybillTracking() {} }, requireAvailable = true, asyncAvailable = true, requireError, loadPlugin, services = {}, wx = {}, timers = {} } = {}) {
  const calls = { requests: [], plugins: [], storage: [], patches: [], routes: [], toasts: [] };
  let definition;
  const imports = {
    '../../services/orders': {
      fetchOrderLogistics: async (orderNo) => { calls.requests.push(orderNo); return fetch(orderNo); },
      fetchOrder: async () => shipped(), cancelOrder: async () => shipped(), confirmOrderReceipt: async () => shipped(), repurchaseOrder: async () => ({}),
      ...services,
    },
    '../../services/payments': { payOrderWithWeChat: services.payOrderWithWeChat || (async () => ({ paid: true })) },
    '../../stores/session': { readAccessToken: services.readAccessToken || (() => 'fixture-session') },
    '../../config/index': { config: { paymentEnabled: true, paymentProvider: 'wechat' } },
    '../../models/order': createLoader().load('models/order.js'),
    '../../models/dispatch-estimate': createLoader().load('models/dispatch-estimate.js'),
  };
  const context = {
    Page: (page) => { definition = page; },
    require: (file) => { assert.ok(imports[file], `unexpected import ${file}`); return imports[file]; },
    wx: {
      getDeviceInfo: () => ({ platform: 'ios' }),
      setStorageSync: (...args) => calls.storage.push(args),
      setClipboardData: (options) => { calls.copied = options.data; },
      stopPullDownRefresh() {}, showToast: (options) => calls.toasts.push(options.title),
      navigateTo: (options) => calls.routes.push(options.url),
      ...wx,
    },
    setTimeout: timers.setTimeout || setTimeout, clearTimeout: timers.clearTimeout || clearTimeout,
  };
  imports['../../utils/tap-feedback'] = createLoader(context.wx).load('utils/tap-feedback.js');
  imports['../../services/logistics-plugin'] = pluginFixture({ plugin, requireAvailable, asyncAvailable, requireError, loadPlugin, wx: context.wx, timers, calls }).api;
  const source = fs.readFileSync(path.join(root, 'pages/order-detail/index.js'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  context.exports = {};
  vm.runInNewContext(code, context);
  const page = { ...definition, data: structuredClone(definition.data), orderNo: 'fixture-order' };
  page.setData = (patch) => { calls.patches.push(patch); Object.assign(page.data, patch); };
  page.data.order = shipped();
  return { page, calls };
}

function serviceFixture(response) {
  const calls = [];
  const loader = createLoader({}, {
    [path.join(root, 'services/http.js')]: { request: async (options) => { calls.push(options); return response; } },
  });
  return { orders: loader.load('services/orders.js'), calls };
}

test('official logistics plugin is declared once in a non-preloaded subpackage, outside the startup main package', () => {
  const config = JSON.parse(fs.readFileSync(path.resolve(root, '../../examples/wechat-plugins.json'), 'utf8'));
  assert.equal(config.plugins.logisticsPlugin, undefined);
  const declared = config.subpackages.filter(pkg => pkg.plugins?.logisticsPlugin);
  assert.equal(declared.length, 1);
  assert.deepEqual(declared[0].plugins.logisticsPlugin, { version: '2.1.5', provider: 'wx9ad912bf20548d92' });
  assert.equal(declared[0].root, 'packages/logistics');
  for (const page of declared[0].pages) for (const ext of ['.js', '.json', '.wxml']) assert.ok(fs.existsSync(path.join(root, declared[0].root, page + ext)));
  assert.ok(!JSON.stringify(config.preloadRule || {}).includes('logistics'));
});

test('only shipped or delivered orders with an actual waybill expose tracking; other actions remain unchanged', () => {
  const normalize = createLoader().load('models/order.js').normalizeOrder;
  const order = { ...shipped(), shipments: [{ trackingNo: 'fixture-waybill', status: 'SHIPPED' }] };
  for (const fulfillmentStatus of ['SHIPPED', 'DELIVERED']) assert.equal(normalize({ ...order, fulfillmentStatus }).canViewLogistics, true);
  for (const fulfillmentStatus of ['PENDING', 'PROCESSING', 'RETURNED', '']) assert.equal(normalize({ ...order, fulfillmentStatus }).canViewLogistics, false);
  assert.equal(normalize({ ...order, shipments: [] }).canViewLogistics, false);
  assert.equal(normalize(order).canConfirmReceipt, true);
  assert.equal(normalize({ ...order, status: 'CREATED', paymentStatus: 'NOT_STARTED' }).canPay, true);
});

test('logistics credential read is authenticated, encoded and GET-only', async () => {
  const f = serviceFixture({ ok: true, logistics: logistics() });
  assert.equal((await f.orders.fetchOrderLogistics('fixture/a?b')).waybillToken, 'fixture-only-token');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].path, '/api/account/orders/fixture%2Fa%3Fb/logistics');
  assert.equal(f.calls[0].auth, 'required');
  assert.equal(f.calls[0].method, undefined);
  assert.equal(f.calls[0].data, undefined);
});

test('guest cannot read logistics credentials or issue a network request', async () => {
  let requests = 0;
  const loader = createLoader({ request() { requests++; } }, {
    [path.join(root, 'stores/session.js')]: { readAccessToken: () => '', clearSession() {} },
  });
  await assert.rejects(loader.load('services/orders.js').fetchOrderLogistics('fixture-order'), /AUTH_REQUIRED/);
  assert.equal(requests, 0);
});

test('unavailable logistics drops any credential accidentally returned alongside it', async () => {
  const f = serviceFixture({ ok: true, logistics: { available: false, reason: 'NOT_BOUND', waybillToken: 'must-not-be-used' } });
  const result = await f.orders.fetchOrderLogistics('fixture-order');
  assert.equal(result.available, false);
  assert.equal(result.reason, 'NOT_BOUND');
  assert.equal(result.waybillToken, undefined);
});

test('malformed logistics responses and missing order number fail closed', async () => {
  for (const response of [null, { ok: 'true', logistics: logistics() }, { ok: true }, { ok: true, logistics: { available: 'true' } }, { ok: true, logistics: { available: true, waybillToken: '' } }, { ok: true, logistics: { available: true, waybillToken: 123 } }]) {
    await assert.rejects(serviceFixture(response).orders.fetchOrderLogistics('fixture-order'), /INVALID_LOGISTICS_RESPONSE/);
  }
  const f = serviceFixture({ ok: true, logistics: logistics() });
  for (const orderNo of ['', '  ', null, undefined]) await assert.rejects(f.orders.fetchOrderLogistics(orderNo), /ORDER_NO_REQUIRED/);
  assert.equal(f.calls.length, 0);
});

test('tracking opens lazily with a local token and does not write storage or page data', async () => {
  let options;
  const f = pageFixture({ plugin: { openWaybillTracking: (value) => { options = value; } } });
  assert.equal(f.calls.plugins.length, 0);
  await f.page.viewLogistics();
  assert.deepEqual(f.calls.requests, ['fixture-order']);
  assert.deepEqual(f.calls.plugins, ['logisticsPlugin']);
  assert.equal(options.waybillToken, 'fixture-only-token');
  assert.deepEqual(Object.keys(options), ['waybillToken']);
  assert.equal(f.page.data.logisticsLoading, false);
  assert.equal(f.page.data.logisticsError, '');
  assert.equal(f.page._logisticsBusy, false);
  assert.equal(f.calls.storage.length, 0);
  assert.ok(!JSON.stringify(f.page.data).includes('fixture-only-token'));
  assert.ok(!JSON.stringify(f.calls.patches).includes('fixture-only-token'));
});

test('unshipped orders never request or open logistics', async () => {
  const f = pageFixture();
  f.page.data.order.canViewLogistics = false;
  await f.page.viewLogistics();
  assert.equal(f.calls.requests.length, 0);
  assert.equal(f.calls.plugins.length, 0);
});

test('unbound or disabled logistics retains copy and leaves payment/receipt/after-sales error unchanged', async () => {
  const f = pageFixture({ fetch: async () => ({ available: false, reason: 'NOT_BOUND' }) });
  f.page.data.error = 'previous order action message';
  await f.page.viewLogistics();
  assert.match(f.page.data.logisticsError, /暂无.*复制运单号/);
  assert.equal(f.page.data.error, 'previous order action message');
  assert.equal(f.calls.plugins.length, 0);
  assert.equal(f.page.data.logisticsLoading, false);
  f.page.copyTrackingNo();
  assert.equal(f.calls.copied, 'fixture-waybill');
});

for (const code of ['AUTH_REQUIRED', 'SESSION_CHANGED']) test(`${code} shows sign-in guidance without opening the plugin`, async () => {
  const f = pageFixture({ fetch: async () => { throw Error(code); } });
  await f.page.viewLogistics();
  assert.match(f.page.data.logisticsError, /重新登录/);
  assert.equal(f.calls.plugins.length, 0);
  assert.equal(f.page.data.logisticsLoading, false);
});

for (const statusCode of [401, 403, 404]) test(`HTTP ${statusCode} cannot open a logistics credential`, async () => {
  const f = pageFixture({ fetch: async () => { const error = Error('request denied'); error.statusCode = statusCode; throw error; } });
  await f.page.viewLogistics();
  assert.equal(f.calls.plugins.length, 0);
  assert.equal(f.page.data.logisticsLoading, false);
  assert.match(f.page.data.logisticsError, statusCode === 401 ? /登录/ : /刷新订单/);
});

test('network failure is retryable and cannot modify order actions', async () => {
  let count = 0;
  const f = pageFixture({ fetch: async () => { if (++count === 1) throw Error('NETWORK_REQUEST_FAILED'); return logistics(); } });
  const previous = JSON.stringify(f.page.data.order);
  await f.page.viewLogistics();
  assert.match(f.page.data.logisticsError, /稍后重试.*复制运单号/);
  assert.equal(JSON.stringify(f.page.data.order), previous);
  assert.equal(f.page.data.paying, false);
  assert.equal(f.page.data.confirmingReceipt, false);
  await f.page.viewLogistics();
  assert.equal(f.calls.requests.length, 2);
  assert.equal(f.page.data.logisticsError, '');
});

for (const options of [{ requireAvailable: false }, { asyncAvailable: false }, { plugin: {} }, { plugin: null }]) test(`unsupported plugin provides upgrade and copy fallback: ${JSON.stringify(options)}`, async () => {
  const f = pageFixture(options);
  await f.page.viewLogistics();
  assert.match(f.page.data.logisticsError, /升级微信.*复制运单号/);
  assert.equal(f.page.data.logisticsLoading, false);
  f.page.copyTrackingNo();
  assert.equal(f.calls.copied, 'fixture-waybill');
});

for (const options of [
  { requireError: Error('plugin not registered') },
  { plugin: { openWaybillTracking() { throw Error('native failure'); } } },
  { plugin: { openWaybillTracking: async () => { throw Error('async failure'); } } },
]) test('plugin load, synchronous and async failures remain isolated with finally cleanup', async () => {
  const f = pageFixture(options);
  await f.page.viewLogistics();
  assert.match(f.page.data.logisticsError, /复制运单号/);
  assert.equal(f.page.data.logisticsLoading, false);
  assert.equal(f.page._logisticsBusy, false);
  assert.equal(f.page.data.error, '');
});

test('repeated taps share one request and one plugin opening while pending', async () => {
  let resolve;
  const f = pageFixture({ fetch: () => new Promise((done) => { resolve = done; }) });
  const first = f.page.viewLogistics();
  await f.page.viewLogistics();
  assert.equal(f.calls.requests.length, 1);
  assert.equal(f.page.data.logisticsLoading, true);
  resolve(logistics());
  await first;
  assert.equal(f.calls.plugins.length, 1);
  assert.equal(f.page.data.logisticsLoading, false);
});

test('pending native promise has bounded loading and timeout cleanup', async () => {
  let timeoutCallback, cleared = false;
  const f = pageFixture({
    plugin: { openWaybillTracking: () => new Promise(() => {}) },
    timers: { setTimeout: (callback, milliseconds) => { assert.equal(milliseconds, 12000); timeoutCallback = callback; return 123; }, clearTimeout: (id) => { assert.equal(id, 123); cleared = true; } },
  });
  const pending = f.page.viewLogistics();
  await new Promise(setImmediate);
  assert.equal(f.page.data.logisticsLoading, true);
  timeoutCallback();
  await pending;
  assert.equal(cleared, true);
  assert.equal(f.page.data.logisticsLoading, false);
  assert.match(f.page.data.logisticsError, /复制运单号/);
});

test('leaving the page during credential read never opens a plugin or patches an unloaded page', async () => {
  let resolve;
  const f = pageFixture({ fetch: () => new Promise((done) => { resolve = done; }) });
  const pending = f.page.viewLogistics();
  f.page.onUnload();
  const patchCount = f.calls.patches.length;
  resolve(logistics());
  await pending;
  assert.equal(f.calls.plugins.length, 0);
  assert.equal(f.calls.patches.length, patchCount);
  assert.equal(f.page._logisticsBusy, false);
});

test('a changed shipment, order or shipping eligibility discards a stale credential', async () => {
  for (const mutate of [p => { p.orderNo = 'different-order'; }, p => { p.data.order.shipment.trackingNo = 'new-waybill'; }, p => { p.data.order.canViewLogistics = false; }]) {
    let resolve;
    const f = pageFixture({ fetch: () => new Promise((done) => { resolve = done; }) });
    const pending = f.page.viewLogistics(); mutate(f.page); resolve(logistics()); await pending;
    assert.equal(f.calls.plugins.length, 0);
    assert.equal(f.page.data.logisticsLoading, false);
  }
});

test('payment still uses the resolved order number after an isolated logistics failure', async () => {
  let paidOrderNo;
  const f = pageFixture({ fetch: async () => { throw Error('offline'); }, services: {
    fetchOrder: async () => ({ ...shipped(), orderNo: 'resolved-order', canPay: true }),
    payOrderWithWeChat: async (orderNo) => { paidOrderNo = orderNo; return { paid: true }; },
  } });
  await f.page.loadOrder(); await f.page.viewLogistics(); await f.page.payOrder();
  assert.equal(paidOrderNo, 'resolved-order');
  assert.equal(f.page.data.paying, false);
  assert.ok(f.calls.toasts.includes('支付已确认'));
});

test('WeChat receipt confirmation and after-sales route still operate independently of logistics failures', async () => {
  let view, receiptOrderNo;
  const f = pageFixture({ fetch: async () => { throw Error('offline'); }, services: { confirmOrderReceipt: async (orderNo) => { receiptOrderNo = orderNo; return shipped(); } }, wx: { openBusinessView: (options) => { view = options; } } });
  f.page.data.order.wechatTransactionId = 'fixture-paid-transaction';
  await f.page.viewLogistics();
  f.page.confirmReceipt();
  assert.equal(view.businessType, 'weappOrderConfirm');
  assert.equal(view.extraData.transaction_id, 'fixture-paid-transaction');
  assert.equal(f.page.receiptPending, true);
  f.page.onShow(); await new Promise(setImmediate);
  assert.equal(receiptOrderNo, 'fixture-order');
  assert.equal(f.page.data.confirmingReceipt, false);
  f.page.requestAfterSales();
  assert.deepEqual(f.calls.routes, ['/pages/after-sales-create/index?orderNo=fixture-order']);
});

test('page load prefetches only read-only status once, manual refresh retries, and no lifecycle action opens the plugin', async () => {
  const f = pageFixture();
  await f.page.loadOrder();
  await new Promise(setImmediate);
  assert.equal(f.calls.requests.length, 1);
  f.page.onPullDownRefresh(); await new Promise(setImmediate);
  f.page.onShow(); await new Promise(setImmediate);
  await f.page.syncReceipt();
  assert.equal(f.calls.requests.length, 2);
  assert.equal(f.calls.plugins.length, 0);
});

test('prefetch keeps credentials local, shows valid trace and never opens the plugin or writes storage', async () => {
  const f = pageFixture({ fetch: async () => ({ ...logistics(), status: 2 }) });
  await f.page.loadOrder(); await new Promise(setImmediate);
  assert.equal(f.page.data.logisticsState, 'ready');
  assert.equal(f.page.data.logisticsTraceLabel, '运输中');
  assert.equal(f.calls.requests.length, 1);
  assert.equal(f.calls.plugins.length, 0);
  assert.equal(f.calls.storage.length, 0);
  assert.ok(!JSON.stringify(f.calls.patches).includes('fixture-only-token'));
  assert.equal(f.page.data.order.fulfillmentStatus, 'SHIPPED');
  assert.equal(f.page.data.order.canConfirmReceipt, true);
});

test('unshipped orders never prefetch and clear a previous shipment trace', async () => {
  const f = pageFixture({ services: { fetchOrder: async () => ({ ...shipped(), canViewLogistics: false, fulfillmentStatus: 'PROCESSING', shipment: null }) } });
  f.page.setData({ logisticsState: 'ready', logisticsTraceLabel: '已签收', logisticsError: 'old error' });
  await f.page.loadOrder();
  assert.equal(f.calls.requests.length, 0);
  assert.equal(f.page.data.logisticsState, 'idle');
  assert.equal(f.page.data.logisticsTraceLabel, '');
  assert.equal(f.page.data.logisticsError, '');
});

test('missing trace status remains unavailable and cannot advance store delivery or receipt actions', async () => {
  const f = pageFixture({ fetch: async () => ({ ...logistics(), status: null }) });
  await f.page.loadOrder(); await new Promise(setImmediate);
  assert.equal(f.page.data.logisticsState, 'unavailable');
  assert.equal(f.page.data.logisticsTraceLabel, '');
  assert.match(f.page.data.logisticsHint, /暂未获取.*重试/);
  assert.equal(f.page.data.order.fulfillmentStatus, 'SHIPPED');
  assert.equal(f.page.data.order.canConfirmReceipt, true);
});

test('prefetch failure remains isolated and manual refresh can recover it', async () => {
  let failures = true;
  const f = pageFixture({ fetch: async () => { if (failures) throw Error('NETWORK_REQUEST_FAILED'); return { ...logistics(), status: 1 }; } });
  await f.page.loadOrder(); await new Promise(setImmediate);
  assert.equal(f.page.data.error, '');
  assert.equal(f.page.data.logisticsState, 'error');
  assert.match(f.page.data.logisticsHint, /复制运单号/);
  failures = false; f.page.onPullDownRefresh(); await new Promise(setImmediate);
  assert.equal(f.page.data.logisticsState, 'ready');
  assert.equal(f.page.data.logisticsTraceLabel, '已揽件');
  assert.equal(f.calls.plugins.length, 0);
});

test('view taps during read-only prefetch do not duplicate the request or open a plugin', async () => {
  let finish;
  const f = pageFixture({ fetch: () => new Promise(resolve => { finish = resolve; }) });
  await f.page.loadOrder();
  assert.equal(f.page.data.logisticsState, 'checking');
  await f.page.viewLogistics();
  assert.equal(f.calls.requests.length, 1);
  finish({ ...logistics(), status: 0 }); await new Promise(setImmediate);
  assert.equal(f.page.data.logisticsTraceLabel, '暂无揽收信息');
  assert.equal(f.calls.plugins.length, 0);
});

test('older shipment status or failure cannot replace a newer shipment trace', async () => {
  for (const rejectOld of [false, true]) {
    let firstResolve, firstReject;
    const f = pageFixture({ fetch: orderNo => orderNo === 'fixture-order' ? new Promise((resolve, reject) => { firstResolve = resolve; firstReject = reject; }) : Promise.resolve({ ...logistics(), status: 1 }) });
    const first = f.page.prefetchLogistics(f.page.data.order);
    f.page.orderNo = 'new-order';
    f.page.data.order = { ...shipped(), orderNo: 'new-order', shipment: { trackingNo: 'new-waybill' } };
    await f.page.prefetchLogistics(f.page.data.order);
    if (rejectOld) firstReject(Error('old network failure')); else firstResolve({ ...logistics(), status: 4 });
    await first;
    assert.equal(f.page.data.logisticsTraceLabel, '已揽件');
    assert.equal(f.page.data.logisticsState, 'ready');
  }
});

test('leaving during a status prefetch cannot patch the unloaded page', async () => {
  let finish;
  const f = pageFixture({ fetch: () => new Promise(resolve => { finish = resolve; }) });
  const pending = f.page.prefetchLogistics(f.page.data.order);
  f.page.onUnload(); const patches = f.calls.patches.length;
  finish({ ...logistics(), status: 4 }); await pending;
  assert.equal(f.calls.patches.length, patches);
  assert.equal(f.calls.plugins.length, 0);
});

test('a stale order read cannot replace a newer order or launch a wrong status prefetch', async () => {
  let resolveOld, reads = 0;
  const f = pageFixture({ services: { fetchOrder: () => ++reads === 1 ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve({ ...shipped(), orderNo: 'new-order' }) } });
  const old = f.page.loadOrder();
  await f.page.loadOrder();
  resolveOld({ ...shipped(), orderNo: 'old-order' }); await old; await new Promise(setImmediate);
  assert.equal(f.page.orderNo, 'new-order');
  assert.deepEqual(f.calls.requests, ['new-order']);
  assert.equal(f.page.data.loading, false);
});

test('a corrected carrier with the same waybill is a new shipment identity for prefetch and plugin opening', async () => {
  let finishOld, reads = 0;
  const f = pageFixture({ fetch: () => ++reads === 1 ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve({ ...logistics(), status: 1 }) });
  f.page.data.order.shipment.trackingCompany = '原快递';
  const old = f.page.prefetchLogistics(f.page.data.order);
  f.page.data.order.shipment.trackingCompany = '更正快递';
  await f.page.prefetchLogistics(f.page.data.order);
  finishOld({ ...logistics(), status: 4 }); await old;
  assert.equal(f.calls.requests.length, 2);
  assert.equal(f.page.data.logisticsTraceLabel, '已揽件');
  let finishClick;
  const g = pageFixture({ fetch: () => new Promise(resolve => { finishClick = resolve; }) });
  g.page.data.order.shipment.trackingCompany = '原快递';
  const click = g.page.viewLogistics();
  g.page.data.order.shipment.trackingCompany = '更正快递';
  finishClick(logistics()); await click;
  assert.equal(g.calls.plugins.length, 0);
});

test('status cache is bounded to thirty seconds and refresh does not open the plugin', async () => {
  const f = pageFixture({ fetch: async () => ({ ...logistics(), status: 0 }) });
  await f.page.prefetchLogistics(f.page.data.order);
  await f.page.prefetchLogistics(f.page.data.order);
  assert.equal(f.calls.requests.length, 1);
  f.page._logisticsPrefetchedAt = Date.now() - 30001;
  await f.page.prefetchLogistics(f.page.data.order);
  assert.equal(f.calls.requests.length, 2);
  assert.equal(f.calls.plugins.length, 0);
});

test('simulator tracking tap preserves displayed real status and copy without loading a plugin or fresh credential', async () => {
  const f = pageFixture({ wx: { getDeviceInfo: () => ({ platform: 'devtools' }) } });
  f.page.setData({ logisticsState: 'ready', logisticsTraceLabel: '运输中' });
  await f.page.viewLogistics();
  assert.equal(f.calls.requests.length, 0);
  assert.equal(f.calls.plugins.length, 0);
  assert.deepEqual(f.calls.toasts, ['请在手机预览中查看物流']);
  assert.equal(f.page.data.logisticsState, 'ready');
  assert.equal(f.page.data.logisticsTraceLabel, '运输中');
  assert.equal(f.page.data.logisticsLoading, false);
  f.page.copyTrackingNo(); assert.equal(f.calls.copied, 'fixture-waybill');
});

test('missing session cannot request or asynchronously load tracking', async () => {
  const f = pageFixture({ services: { readAccessToken: () => '' } });
  await f.page.viewLogistics();
  assert.equal(f.calls.requests.length, 0);
  assert.equal(f.calls.plugins.length, 0);
  assert.match(f.page.data.logisticsError, /重新登录/);
});

test('session change during credential read cannot load the plugin', async () => {
  let session = 'session-a', finish;
  const f = pageFixture({ services: { readAccessToken: () => session }, fetch: () => new Promise(resolve => { finish = resolve; }) });
  const operation = f.page.viewLogistics(); session = 'session-b'; finish(logistics()); await operation;
  assert.equal(f.calls.plugins.length, 0);
  assert.match(f.page.data.logisticsError, /重新登录/);
});

test('phone async loading rechecks page, order, shipment and session before opening the official plugin', async () => {
  for (const mutate of [p => p.onUnload(), p => { p.orderNo = 'other-order'; }, p => { p.data.order.shipment.trackingNo = 'other-waybill'; }, p => { p.data.order.shipment.trackingCompany = 'other-carrier'; }, p => { p.data.order.canViewLogistics = false; }, () => {}]) {
    let finishLoad, opened = 0, session = 'session-a';
    const f = pageFixture({ services: { readAccessToken: () => session }, loadPlugin: () => new Promise(resolve => { finishLoad = resolve; }) });
    const operation = f.page.viewLogistics(); await new Promise(setImmediate);
    assert.deepEqual(f.calls.plugins, ['logisticsPlugin']);
    mutate(f.page); session = 'session-b';
    finishLoad({ openWaybillTracking() { opened++; } }); await operation;
    assert.equal(opened, 0);
    assert.equal(f.page._logisticsBusy, false);
    assert.ok(!JSON.stringify(f.page.data).includes('fixture-only-token'));
  }
});

test('async plugin download is bounded, deduplicates concurrent requests and allows an explicit retry after timeout', async () => {
  let timeout, loads = 0;
  const f = pluginFixture({ wx: { getDeviceInfo: () => ({ platform: 'ios' }) }, loadPlugin: () => ++loads === 1 ? new Promise(() => {}) : Promise.resolve({ openWaybillTracking() {} }), timers: { setTimeout: callback => { timeout = callback; return 7; }, clearTimeout: () => {} } });
  assert.equal(f.calls.plugins.length, 0);
  const first = f.api.loadLogisticsPlugin();
  const second = f.api.loadLogisticsPlugin(); assert.equal(first, second);
  await new Promise(setImmediate); assert.equal(loads, 1);
  timeout(); await assert.rejects(first, /LOGISTICS_LOAD_TIMEOUT/);
  const plugin = await f.api.loadLogisticsPlugin();
  assert.equal(typeof plugin.openWaybillTracking, 'function'); assert.equal(loads, 2);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader, root } = require('./test-loader.cjs');

function loadPage(file, wx = {}, overrides = {}) {
  const loader = createLoader({ getStorageSync: () => null, ...wx }, overrides);
  loader.load(file);
  const page = loader.page;
  page.setData = values => Object.assign(page.data, values);
  return page;
}

test('WeChat order link resolves payment number before subsequent order actions', async () => {
  let fetched, cancelled, afterSalesUrl;
  const page = loadPage('pages/order-detail/index.js', {
    stopPullDownRefresh() {},
    showModal: async options => options.success({ confirm: true }),
    navigateTo: options => { afterSalesUrl = options.url; },
  }, {
    [path.join(root, 'services/orders.js')]: {
      fetchOrder: async number => { fetched = number; return { orderNo: 'VK-STORE-1', canCancel: true, canRequestAfterSales: true }; },
      cancelOrder: async number => { cancelled = number; return { orderNo: number }; },
    },
  });
  page.orderNo = 'VK-STORE-1W2';
  await page.loadOrder();
  assert.equal(fetched, 'VK-STORE-1W2');
  assert.equal(page.orderNo, 'VK-STORE-1');
  page.requestAfterSales();
  assert.equal(afterSalesUrl, '/pages/after-sales-create/index?orderNo=VK-STORE-1');
  page.cancelOrder();
  await Promise.resolve();
  assert.equal(cancelled, 'VK-STORE-1');
});

test('account order shortcut carries its filter through the first order load', async () => {
  let url;
  const account = loadPage('pages/account/index.js', { navigateTo: value => { url = value.url; } });
  account.openEntry({ currentTarget: { dataset: { route: '/pages/orders/index?filter=unpaid' } } });
  const orders = loadPage('pages/orders/index.js', { stopPullDownRefresh() {} }, {
    [path.join(root, 'services/orders.js')]: { fetchOrders: async () => [
      { orderNo: 'unpaid', canPay: true },
      { orderNo: 'paid', canPay: false, paymentStatus: 'PAID', fulfillmentStatus: 'PENDING' },
    ] },
  });
  orders.onLoad({ filter: new URLSearchParams(url.split('?')[1]).get('filter') });
  await orders.loadOrders();
  assert.equal(orders.data.activeFilter, 'unpaid');
  assert.deepEqual(Array.from(orders.data.visibleOrders, item => item.orderNo), ['unpaid']);
  orders.onLoad({ filter: 'unknown' });
  assert.equal(orders.data.activeFilter, 'all');
});

test('detail disclosure only changes display state, preserving chosen variant and quantity', () => {
  const page = loadPage('pages/product-detail/index.js');
  page.setData({ selectedSize: 'M', selectedColor: '白色', quantity: 2 });
  const toggle = section => page.toggleSection({ currentTarget: { dataset: { section } } });
  toggle('detailsOpen');
  toggle('careOpen');
  assert.equal(page.data.detailsOpen, false);
  assert.equal(page.data.careOpen, true);
  toggle('quantity');
  assert.equal(page.data.quantity, 2);
  assert.equal(page.data.selectedSize, 'M');
  assert.equal(page.data.selectedColor, '白色');
});

test('specification sheet dismissal preserves selection and is blocked during cart submission', async () => {
  const page = loadPage('pages/product-detail/index.js');
  page.setData({ selectedSize: 'L', selectedColor: '白色', quantity: 3 });
  page.openSpecs();
  assert.equal(page.data.specOpen, true);
  page.setData({ adding: true });
  page.closeSpecs();
  assert.equal(page.data.specOpen, true);
  page.setData({ adding: false });
  page.closeSpecs();
  assert.equal(page.data.specOpen, true);
  assert.equal(page.data.specClosing, true);
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(page.data.specOpen, false);
  assert.equal(page.data.specClosing, false);
  assert.equal(page.data.selectedSize, 'L');
  assert.equal(page.data.quantity, 3);
});

test('reopening a closing specification sheet cancels its pending dismissal', async () => {
  const page = loadPage('pages/product-detail/index.js');
  page.openSpecs();
  page.closeSpecs();
  page.openSpecs();
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(page.data.specOpen, true);
  assert.equal(page.data.specClosing, false);
  page.onUnload();
});

test('unloading a product cancels pending animation updates', async () => {
  const page = loadPage('pages/product-detail/index.js');
  page.openSpecs();
  page.closeSpecs();
  page.onUnload();
  let updates = 0;
  page.setData = () => { updates++; };
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(updates, 0);
});

test('image feedback recovers after an error without affecting other sources', () => {
  const page = loadPage('pages/product-detail/index.js');
  const event = source => ({ currentTarget: { dataset: { source } } });
  page.onMediaLoad(event('first.jpg'));
  page.onMediaError(event('second.jpg'));
  page.onMediaError(event('first.jpg'));
  page.onMediaLoad(event('first.jpg'));
  assert.equal(page.data.mediaLoaded['first.jpg'], true);
  assert.equal(page.data.mediaFailed['first.jpg'], false);
  assert.equal(page.data.mediaFailed['second.jpg'], true);
});

test('visitor member entry opens login without accepting either privacy choice', () => {
  let navigation = 0;
  const page = loadPage('pages/account/index.js', { pageScrollTo() {}, navigateTo() { navigation++; } });
  page.openMember();
  assert.equal(page.data.loginOpen, true);
  assert.equal(page.data.consented, false);
  assert.equal(page.data.crossBorderConsented, false);
  assert.equal(navigation, 0);
  page.setData({ loggedIn: true });
  page.openMember();
  assert.equal(navigation, 1);
});

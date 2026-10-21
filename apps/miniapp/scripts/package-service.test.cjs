const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader, root } = require('./test-loader.cjs');

function fixture({ signedIn = true, consent = true, verify, care } = {}) {
  const state = { signedIn, consent, token: 'fixture-session' };
  const calls = { tabs: [], pages: [], me: 0, products: 0 };
  const loader = createLoader({
    switchTab(options) { calls.tabs.push(options.url); options.complete?.(); },
    navigateTo(options) { calls.pages.push(options.url); options.complete?.(); },
    showToast() {},
  }, {
    [path.join(root, 'stores/session.js')]: { hasSession: () => state.signedIn, readAccessToken: () => state.token },
    [path.join(root, 'stores/privacy-consent.js')]: { isPrivacyAccepted: () => state.consent },
    [path.join(root, 'services/auth.js')]: { fetchCurrentUser: async () => { calls.me++; return verify ? verify() : { id: 'fixture-user' }; } },
    [path.join(root, 'services/catalog.js')]: { fetchProductBySlug: async (slug, options) => { calls.products++; assert.equal(slug, 'x1-air-white'); assert.equal(options.force, true); return care ? care() : { name: 'Essential Brief Demo', careInstructions: '30℃以下轻柔洗涤；不可漂白；不可烘干；阴凉处晾干。具体洗护要求以商品洗标为准。' }; } },
  });
  loader.load('pages/package-service/index.js');
  const page = loader.page;
  page.data = structuredClone(page.data);
  page.setData = patch => Object.assign(page.data, patch);
  page.onLoad();
  return { page, state, calls, navigation: loader.load('stores/navigation.js') };
}

const event = service => ({ type: 'tap', currentTarget: { dataset: { service } } });

test('QR entry requires login before any account or product fetch and remembers the exact return page', async () => {
  const { page, calls, navigation } = fixture({ signedIn: false });
  await page.onShow();
  assert.equal(page.data.authorized, false);
  assert.deepEqual(calls.tabs, ['/pages/account/index']);
  assert.equal(navigation.consumeMemberLoginReturn(), '/pages/package-service/index');
  assert.equal(calls.me, 0); assert.equal(calls.products, 0);
});

test('a saved session without current privacy consent must go through the existing login flow', async () => {
  const { page, calls, navigation } = fixture({ consent: false });
  await page.onShow();
  assert.equal(page.data.authorized, false); assert.equal(calls.me, 0);
  assert.equal(navigation.consumeMemberLoginReturn(), '/pages/package-service/index');
});

test('service choices stay hidden until server-side login validation succeeds', async () => {
  let resolve;
  const { page, calls } = fixture({ verify: () => new Promise(done => { resolve = done; }) });
  const pending = page.onShow();
  page.openService(event('size'));
  assert.equal(page.data.authorized, false); assert.equal(page.data.checking, true);
  assert.equal(calls.pages.length, 0);
  resolve({ id: 'fixture-user' }); await pending;
  assert.equal(page.data.authorized, true); assert.equal(page.data.checking, false);
  assert.equal(calls.products, 0);
});

test('an expired login response redirects to login instead of exposing service content', async () => {
  const { page, calls } = fixture({ verify: async () => { const error = new Error('AUTH_REQUIRED'); error.statusCode = 401; throw error; } });
  await page.onShow();
  assert.equal(page.data.authorized, false);
  assert.deepEqual(calls.tabs, ['/pages/account/index']);
});

test('account validation network failures show a retry and a successful retry reveals the page', async () => {
  let fail = true;
  const { page, calls } = fixture({ verify: () => { if (fail) throw Error('offline'); return { id: 'fixture-user' }; } });
  await page.onShow();
  assert.equal(page.data.authorized, false); assert.match(page.data.accessError, /重试/);
  assert.equal(calls.tabs.length, 0);
  fail = false; await page.checkAccess();
  assert.equal(page.data.authorized, true); assert.equal(page.data.accessError, '');
});

test('switching accounts during login validation never reveals the previous account page', async () => {
  let resolve;
  const { page, state, calls } = fixture({ verify: () => new Promise(done => { resolve = done; }) });
  const pending = page.onShow(); state.token = 'different-session';
  resolve({ id: 'old-user' }); await pending;
  assert.equal(page.data.authorized, false);
  assert.deepEqual(calls.tabs, ['/pages/account/index']);
});

test('hiding the page invalidates a delayed login response', async () => {
  let resolve;
  const { page } = fixture({ verify: () => new Promise(done => { resolve = done; }) });
  const pending = page.onShow(); page.onHide();
  resolve({ id: 'fixture-user' }); await pending;
  assert.equal(page.data.authorized, false);
});

test('unknown service input cannot navigate to an arbitrary route', async () => {
  const { page, calls } = fixture(); await page.onShow();
  page.openService(event('/pages/checkout/index'));
  assert.equal(calls.tabs.length + calls.pages.length + calls.products, 0);
});

test('session expiry on a service tap returns to login and performs no navigation to a protected destination', async () => {
  const { page, state, calls } = fixture(); await page.onShow(); state.signedIn = false;
  page.openService(event('after-sales'));
  assert.equal(calls.pages.length, 0); assert.deepEqual(calls.tabs, ['/pages/account/index']);
});

test('the login return whitelist accepts only the fixed package service route', () => {
  const loader = createLoader(); const navigation = loader.load('stores/navigation.js');
  navigation.rememberMemberLoginReturn('/pages/package-service/index');
  assert.equal(navigation.consumeMemberLoginReturn(), '/pages/package-service/index');
  navigation.rememberMemberLoginReturn('/pages/package-service/index?redirect=https://example.com');
  assert.equal(navigation.consumeMemberLoginReturn(), '');
});

test('care parsing preserves the merchant washing temperature and label notice', () => {
  const { packageCare } = createLoader().load('models/package-service.js');
  const result = packageCare({ name: 'X1 Air', careInstructions: '30℃以下轻柔洗涤；\n不可漂白；不可烘干；\n阴凉处晾干。\n具体洗护要求以商品洗标为准。' });
  assert.equal(result.title, 'X1 Air'); assert.equal(result.rows.length, 5);
  assert.equal(result.rows[0].text, '30℃以下轻柔洗涤'); assert.match(result.rows[4].text, /以商品洗标为准/);
  assert.equal(packageCare(null), null); assert.equal(packageCare({ careInstructions: ' ；\n' }), null);
});


test('package controls open the two complete guide modules and existing account services',async()=>{const {page,calls}=fixture();await page.onShow();for(const key of ['size','care','after-sales'])page.openService(event(key));page.openService(event('member'));assert.deepEqual(calls.pages,['/pages/size-guide/index','/pages/care-guide/index','/pages/after-sales/index']);assert.deepEqual(calls.tabs,['/pages/account/index']);assert.equal(calls.products,0);});

test('prototype property names cannot become package destinations',async()=>{const {page,calls}=fixture();await page.onShow();for(const key of ['constructor','toString','__proto__'])page.openService(event(key));assert.equal(calls.pages.length+calls.tabs.length,0);});

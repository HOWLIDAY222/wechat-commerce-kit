const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader, root } = require('./test-loader.cjs');
const tick = () => new Promise(setImmediate);

function pageFixture(file, wx = {}, overrides = {}) {
  const loader = createLoader(wx, Object.fromEntries(Object.entries(overrides).map(([file, value]) => [path.join(root, file), value])));
  loader.load(file);
  const page = loader.page;
  page.data = structuredClone(page.data);
  page.setData = patch => Object.assign(page.data, patch);
  return { page, loader };
}

test('feedback is optional on devices without vibration support', () => {
  const { tapFeedback } = createLoader().load('utils/haptics.js');
  assert.equal(tapFeedback(), false);
});

test('rapid button taps produce one strong short pulse and later taps can pulse again', t => {
  let now = 0;
  t.mock.method(Date, 'now', () => now);
  const calls = [];
  const { tapFeedback } = createLoader({ vibrateShort: options => calls.push(options) }).load('utils/haptics.js');
  for (let index = 0; index < 6; index++) tapFeedback();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].type, 'heavy');
  now = 179; assert.equal(tapFeedback(), false);
  now = 180; assert.equal(tapFeedback(), true);
  assert.equal(calls.length, 2);
});

test('native throws, failure callbacks and rejected promises never escape feedback', async () => {
  assert.doesNotThrow(() => createLoader({ vibrateShort() { throw Error('unsupported'); } }).load('utils/haptics.js').tapFeedback());
  assert.doesNotThrow(() => createLoader({ vibrateShort(options) { options.fail({ errMsg: 'vibrateShort:fail' }); } }).load('utils/haptics.js').tapFeedback());
  createLoader({ vibrateShort: () => Promise.reject(Error('device disabled')) }).load('utils/haptics.js').tapFeedback();
  await tick();
});

test('cart acknowledges a real tap immediately without pulsing again on delayed success', async t => {
  let now = 0; t.mock.method(Date, 'now', () => now);
  let finish, pulses = 0, writes = 0;
  const { page } = pageFixture('pages/product-detail/index.js', { showToast() {}, vibrateShort() { pulses++; } }, {
    'stores/session.js': { hasSession: () => true },
    'services/cart.js': { addCartItem: async () => { writes++; await new Promise(resolve => { finish = resolve; }); } },
  });
  page.slug = 'x1-air-white'; page.dismissSpecs = () => {};
  page.setData({ product: { isPurchasable: true }, variant: { soldOut: false }, selectedSize: 'M', selectedColor: '白色' });
  const event = { type: 'tap', currentTarget: { dataset: {} } };
  const pending = page.confirmPurchase(event);
  await page.confirmPurchase(event);
  assert.equal(writes, 1); assert.equal(pulses, 1);
  now = 2000; finish(); await pending;
  assert.equal(pulses, 1); assert.equal(page.data.added, true); assert.equal(page.data.adding, false);
});

test('cart failure preserves the error after acknowledging the initial tap', async () => {
  let pulses = 0;
  const { page } = pageFixture('pages/product-detail/index.js', { showToast() {}, vibrateShort() { pulses++; } }, {
    'stores/session.js': { hasSession: () => true },
    'services/cart.js': { addCartItem: async () => { throw Error('INSUFFICIENT_INVENTORY'); } },
  });
  page.setData({ product: { isPurchasable: true }, variant: { soldOut: false } });
  await page.confirmPurchase({ type: 'tap', currentTarget: { dataset: {} } });
  assert.equal(pulses, 1); assert.equal(page.data.added, false); assert.equal(page.data.adding, false);
});

test('a broken vibration API cannot turn a successful profile save into an error', async () => {
  const { page } = pageFixture('pages/member-profile/index.js', { showToast() {}, vibrateShort() { throw Error('device disabled'); } }, {
    'stores/session.js': { hasSession: () => true },
    'services/member-profile.js': { saveMemberProfile: async () => ({ profile: { registeredAt: '2026-10-01', revision: 2 } }) },
  });
  page.applyProfile = result => { page.data.profile = result.profile; };
  page.setData({ loading: false, loaded: true, canEdit: true, accountPhone: '13900000002', profile: { registeredAt: '2026-10-01', revision: 1 } });
  await page.saveProfile({ type: 'tap', currentTarget: { dataset: {} } });
  assert.equal(page.data.profile.revision, 2);
  assert.equal(page.data.savedMessage, '会员资料已保存。');
  assert.equal(page.data.error, ''); assert.equal(page.data.saving, false);
});

function operationFixture(wx, memberOperation) {
  const loader = createLoader(wx, {
    [path.join(root, 'stores/session.js')]: { hasSession: () => true, readStoredUser: () => ({ id: 'test-member' }) },
    [path.join(root, 'services/member-operations.js')]: { memberOperation },
  });
  const page = loader.load('utils/member-operations-page.js').operationsPage();
  page.data = { ...page.data, overview: { registered: true } };
  page.setData = patch => Object.assign(page.data, patch);
  page.overviewIdentity = 'test-member';
  page.loadOperations = async () => true;
  return page;
}

test('programmatic member operations do not pulse on server completion', async () => {
  for (const action of ['submit_survey', 'submit_social_submission', 'claim_task', 'draw']) {
    let pulses = 0, finish;
    const page = operationFixture({ vibrateShort() { pulses++; } }, () => new Promise(resolve => { finish = resolve; }));
    const pending = page.performOperation(action, {});
    assert.equal(pulses, 0);
    assert.equal(await page.performOperation(action, {}), null);
    finish({ ok: true }); await pending;
    assert.equal(pulses, 0); assert.equal(page.data.busy, false);
  }
});

test('submission failure, share preparation and ordinary reactions do not pulse', async () => {
  for (const action of ['submit_survey', 'draw', 'submit_social_submission']) {
    let pulses = 0;
    const page = operationFixture({ vibrateShort() { pulses++; } }, async () => { throw Error('NETWORK_ERROR'); });
    assert.equal(await page.performOperation(action, {}), null);
    assert.equal(pulses, 0); assert.equal(page.data.busy, false);
  }
  for (const action of ['create_share', 'react_post']) {
    let pulses = 0;
    const page = operationFixture({ vibrateShort() { pulses++; } }, async () => ({ ok: true }));
    await page.performOperation(action, {});
    assert.equal(pulses, 0);
  }
});

test('leaving a member page before confirmation prevents delayed feedback', async () => {
  let pulses = 0, finish;
  const page = operationFixture({ vibrateShort() { pulses++; } }, () => new Promise(resolve => { finish = resolve; }));
  const pending = page.performOperation('submit_survey', {});
  page.onUnload(); finish({ ok: true }); await pending;
  assert.equal(pulses, 0);
});

test('a follow-up list failure cannot introduce a delayed pulse', async () => {
  let pulses = 0;
  const page = operationFixture({ vibrateShort() { pulses++; } }, async () => ({ ok: true }));
  page.loadOperations = async () => false;
  assert.ok(await page.performOperation('submit_survey', {}));
  assert.equal(pulses, 0);
  assert.match(page.data.error, /操作已保存/);
});

test('cancelled lottery confirmation preserves one tap acknowledgement and never requests a draw', async () => {
  let pulses = 0, writes = 0;
  const { page } = pageFixture('pages/member-lottery/index.js', { showModal: options => options.success({ confirm: false }), vibrateShort() { pulses++; } });
  page.canOperate = () => true;
  page.performOperation = async () => { writes++; };
  page.data.lotteries = [{ id: 'test-draw', enabled: true, canAttempt: true, costPoints: 20, title: '积分抽奖' }];
  await page.draw({ type: 'tap', currentTarget: { dataset: { id: 'test-draw' } } });
  assert.equal(writes, 0); assert.equal(pulses, 1); assert.equal(page.data.busy, false);
});

test('diagnostics retain native failure text without claiming a physical vibration happened', () => {
  const results = [];
  const feedback = createLoader({ vibrateShort(options) { options.fail({ errMsg: 'vibrateShort:fail disabled' }); } }).load('utils/haptics.js');
  feedback.testFeedback('short', result => results.push(result));
  assert.equal(results[0].status, 'failed');
  assert.equal(feedback.feedbackDiagnostics()[0].message, 'vibrateShort:fail disabled');
  const copy = feedback.feedbackDiagnostics(); copy[0].status = 'changed';
  assert.equal(feedback.feedbackDiagnostics()[0].status, 'failed');
});

test('long vibration is used only by the explicit diagnostic action', () => {
  const calls = [];
  const feedback = createLoader({ vibrateLong(options) { calls.push(options); options.success({ errMsg: 'vibrateLong:ok' }); } }).load('utils/haptics.js');
  assert.equal(feedback.tapFeedback(), false);
  feedback.testFeedback('long', () => {});
  assert.equal(calls.length, 1);
  assert.equal(Object.hasOwn(calls[0], 'type'), false);
  assert.equal(feedback.feedbackDiagnostics().at(-1).status, 'accepted');
});

test('diagnostic timeout releases the UI when native callbacks never return', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const results = [];
  createLoader({ vibrateShort() {} }).load('utils/haptics.js').testFeedback('short', value => results.push(value));
  assert.equal(results.length, 0);
  t.mock.timers.tick(2000);
  assert.equal(results[0].status, 'timeout');
});

test('contact test starts in the tap handler and distinguishes API acceptance from device sensation', () => {
  let called = false;
  const { page } = pageFixture('pages/contact/index.js', { vibrateShort(options) { called = true; options.success(); } });
  page.onLoad({ haptics: '1' });
  assert.equal(page.data.hapticTestOpen, true); assert.equal(called, false);
  page.runHapticTest({ currentTarget: { dataset: { kind: 'short' } } });
  assert.equal(called, true); assert.equal(page.data.hapticBusy, false);
  assert.match(page.data.hapticStatus, /已调用/); assert.doesNotMatch(page.data.hapticStatus, /已震动/);
});

test('contact test displays native failures and keeps diagnostics free of account details', () => {
  let copied;
  const { page } = pageFixture('pages/contact/index.js', {
    vibrateShort(options) { options.fail({ errMsg: 'vibrateShort:fail unsupported' }); },
    getDeviceInfo: () => ({ platform: 'ios', model: 'iPhone', system: 'iOS', deviceId: 'private-device-id' }),
    getAppBaseInfo: () => ({ version: '8.test', SDKVersion: '3.test' }),
    getAccountInfoSync: () => ({ miniProgram: { version: '0.1.70', envVersion: 'develop' }, plugin: { appId: 'private-plugin-id' } }),
    setClipboardData(options) { copied = JSON.parse(options.data); },
  });
  page.onLoad(); page.runHapticTest({ currentTarget: { dataset: { kind: 'short' } } });
  assert.match(page.data.hapticStatus, /调用失败/); assert.equal(page.data.hapticBusy, false);
  page.copyHapticDiagnostic();
  assert.equal(copied.version, require('../package.json').version); assert.equal(copied.platform, 'ios'); assert.equal(copied.feedback[0].status, 'failed');
  assert.doesNotMatch(JSON.stringify(copied), /private-device-id|private-plugin-id/);
});

test('diagnostic callbacks cannot update the help page after it is closed', () => {
  let complete;
  const { page } = pageFixture('pages/contact/index.js', { vibrateShort(options) { complete = options.success; } });
  page.onLoad(); page.runHapticTest(); page.onUnload();
  const state = JSON.stringify(page.data); complete();
  assert.equal(JSON.stringify(page.data), state);
});

test('the homepage purchase button pulses before starting its native transition', () => {
  const calls = [];
  const { page } = pageFixture('pages/home/home.js', { vibrateShort(options) { calls.push({ pulse: options.type }); options.success(); }, navigateTo(options) { calls.push({ route: options.url }); } });
  page.data.product = { slug: 'x1-air-white' };
  page.openPurchase({ type: 'tap', currentTarget: { dataset: { slug: 'x1-air-white' } } });
  assert.equal(calls[0].pulse, 'heavy');
  assert.match(calls[1].route, /x1-air-white/);
});

test('size and style taps acknowledge valid choices while disabled choices stay silent', t => {
  let now = 0; t.mock.method(Date, 'now', () => now);
  const pulses = [];
  const { page } = pageFixture('pages/product-detail/index.js', { vibrateShort(options) { pulses.push(options.type); options.success(); } });
  page.refreshSelection = () => {};
  page.data.product = { quantityPricing: { styles: [{ key: 'upgraded' }] } };
  page.chooseStyle({ type: 'tap', currentTarget: { dataset: { style: 'upgraded' } } });
  now = 200;
  page.chooseSize({ type: 'tap', currentTarget: { dataset: { size: 'L' } } });
  assert.equal(page.data.selectedStyle, 'upgraded'); assert.equal(page.data.selectedSize, 'L');
  assert.deepEqual(pulses, ['heavy', 'heavy']);
  now = 400;
  page.chooseSize({ type: 'tap', currentTarget: { dataset: { size: 'S', disabled: true } } });
  assert.equal(pulses.length, 2); assert.equal(page.data.selectedSize, 'L');
});

test('header component taps pulse once and preserve their custom event', () => {
  const events = []; let pulses = 0;
  const loader = createLoader({ vibrateShort(options) { pulses++; options.success(); } });
  loader.load('components/brand-header/index.js');
  const component = { triggerEvent: event => events.push(event), ...loader.component.methods };
  component.openSubscriptions({ type: 'tap', currentTarget: { dataset: {} } });
  assert.equal(pulses, 1); assert.deepEqual(events, ['subscribe']);
});

test('programmatic calls and text input do not create click feedback', () => {
  let pulses = 0;
  const { page } = pageFixture('pages/products/index.js', { vibrateShort(options) { pulses++; options.success(); } });
  page.clearSearch();
  page.onSearch({ type: 'input', detail: { value: 'X1' } });
  assert.equal(pulses, 0);
  page.clearSearch({ type: 'tap', currentTarget: { dataset: {} } });
  assert.equal(pulses, 1);
});

test('all four native tab pages register tab-click feedback', () => {
  for (const file of ['pages/home/home.js', 'pages/products/index.js', 'pages/cart/index.js', 'pages/account/index.js']) {
    let pulses = 0;
    const { page } = pageFixture(file, { vibrateShort(options) { pulses++; options.success(); } });
    page.onTabItemTap({ index: '1', pagePath: 'pages/products/index', text: '商品' });
    assert.equal(pulses, 1, file);
  }
});

test('empty sheet interception does not create a vibration', () => {
  let pulses = 0;
  const { page } = pageFixture('pages/product-detail/index.js', { vibrateShort(options) { pulses++; options.success(); } });
  page.stopSheet({ type: 'tap', currentTarget: { dataset: {} } });
  assert.equal(pulses, 0);
});

test('native authorization button feedback cannot accept privacy or change its state', () => {
  let pulses = 0;
  const loader = createLoader({ vibrateShort(options) { pulses++; options.success(); } });
  loader.load('components/privacy-sheet/index.js');
  const state = { visible: true, nativeRequired: true, busy: false };
  const component = { data: state, ...loader.component.methods };
  component.feedbackTap({ type: 'tap', currentTarget: { dataset: {} } });
  assert.equal(pulses, 1); assert.deepEqual(component.data, state);
});

test('tap decoration preserves the original receiver, exact promise and thrown business error', () => {
  const loader = createLoader({ vibrateShort() { throw Error('unsupported hardware'); } });
  const decorate = loader.load('utils/tap-feedback.js').withTapFeedback;
  const pending = Promise.resolve('saved');
  const page = decorate({ count: 0, save(value) { this.count++; assert.equal(value.type, 'tap'); return pending; }, fail() { throw Error('BUSINESS_FAILURE'); } }, ['save', 'fail']);
  const event = { type: 'tap', currentTarget: { dataset: {} } };
  assert.equal(page.save(event), pending); assert.equal(page.count, 1);
  assert.throws(() => page.fail(event), /BUSINESS_FAILURE/);
});

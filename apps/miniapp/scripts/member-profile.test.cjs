const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createLoader, root } = require('./test-loader.cjs');
const plain = value => JSON.parse(JSON.stringify(value));

function response(overrides = {}) {
  return { ok: true, profile: { surname: '', givenName: '', displayName: '', gender: null, region: [], birthday: null, registeredAt: null, updatedAt: null, revision: 0 }, accountPhone: '13900000002', canEdit: true, canCompleteRegistration: true, ...overrides };
}
function pageFixture({ logged = true, value = response(), fetchError, saveError, saveResult, pendingSave = false } = {}) {
  const calls = [];
  let resolveSave;
  let user = { id: 'current-account', name: '原有顾客', phone: value.accountPhone };
  const overrides = {};
  overrides[path.join(root, 'stores/session.js')] = { hasSession: () => logged };
  overrides[path.join(root, 'services/auth.js')] = { getCachedUser: () => user };
  overrides[path.join(root, 'services/member-profile.js')] = {
    fetchMemberProfile: async () => { calls.push('fetch'); if (fetchError) throw fetchError; return plain({ profile: value.profile, accountPhone: value.accountPhone, canEdit: value.canEdit, canCompleteRegistration: value.canCompleteRegistration }); },
    saveMemberProfile: async (...args) => { calls.push({ save: plain(args) }); if (pendingSave) await new Promise(resolve => { resolveSave = resolve; }); if (saveError) throw saveError; return saveResult || plain({ profile: { ...value.profile, revision: 1, registeredAt: '2026-10-18T00:00:00.000Z' }, accountPhone: value.accountPhone, canEdit: true, canCompleteRegistration: true }); },
    rememberProfileAccountReturn: intent => calls.push({ intent }),
  };
  const loader = createLoader({ hideShareMenu: () => {}, getWindowInfo: () => ({ statusBarHeight: 24 }), pageScrollTo: options => calls.push({ scroll: options.selector }), switchTab: options => calls.push({ switchTab: options.url }), navigateTo: options => calls.push({ navigateTo: options.url }), showToast: options => calls.push({ toast: options.title }) }, overrides);
  loader.load('pages/member-profile/index.js');
  const page = loader.page;
  page.data = plain(page.data);
  page.setData = patch => { for (const [key, value] of Object.entries(patch)) { const keys = key.split('.'); let target = page.data; while (keys.length > 1) target = target[keys.shift()]; target[keys[0]] = value; } };
  return { page, calls, setLogged: next => { logged = next; }, setUser: next => { user = next; }, release: () => resolveSave() };
}

test('birthday validation uses real Gregorian dates and Beijing day boundary', () => {
  const model = createLoader().load('models/member-profile.js');
  assert.equal(model.beijingToday(new Date('2026-10-17T16:00:00Z')), '2026-10-18');
  for (const date of [null, '', '1900-01-01', '2000-02-29', '2026-10-18']) assert.equal(model.validMemberBirthday(date, '2026-10-18'), true);
  for (const date of ['1899-12-31', '1900-02-29', '2026-02-30', '2026-10-19', '2026-1-1']) assert.equal(model.validMemberBirthday(date, '2026-10-18'), false);
});

test('profile writer only sends whitelisted optional fields and optimistic revision', () => {
  const model = createLoader().load('models/member-profile.js');
  const body = model.memberProfileWrite({ ...model.memberProfileForm(), surname: ' 张 ', displayName: ' 小张 ', phone: 'unverified', userId: 'other', marketing: true }, 3, true, '2026-10-18');
  assert.deepEqual(plain(body), { surname: '张', givenName: '', displayName: '小张', gender: null, region: [], birthday: null, expectedRevision: 3, completeRegistration: true });
});

test('profile writer rejects malformed optional fields instead of silently losing data', () => {
  const model = createLoader().load('models/member-profile.js');
  const base = model.memberProfileForm();
  for (const patch of [{ surname: 'a'.repeat(41) }, { givenName: 'x\n' }, { displayName: 'a'.repeat(81) }, { gender: 'OTHER' }, { region: ['山东省'] }, { region: ['山东省', '', '市南区'] }, { birthday: '2026-02-30' }]) assert.throws(() => model.memberProfileWrite({ ...base, ...patch }, 0, false, '2026-10-18'));
  assert.throws(() => model.memberProfileWrite(base, -1));
});

test('profile GET rejects incomplete data and preserves read-only unbound account state', () => {
  const model = createLoader().load('models/member-profile.js');
  const dto = model.readMemberProfileResponse(response({ accountPhone: null, canEdit: false, canCompleteRegistration: false }));
  assert.equal(dto.canEdit, false);
  for (const value of [{ ok: true }, response({ accountPhone: '138****8000' }), response({ profile: { ...response().profile, revision: -1 } }), response({ profile: { ...response().profile, birthday: '2001-02-29' } })]) assert.throws(() => model.readMemberProfileResponse(value));
});

test('profile service uses existing auth transport with no automatic PUT retry', async () => {
  const calls = [];
  const overrides = {};
  overrides[path.join(root, 'services/http.js')] = { request: async options => { calls.push(options); return response(); } };
  const loader = createLoader({}, overrides);
  const service = loader.load('services/member-profile.js');
  await service.fetchMemberProfile();
  await service.saveMemberProfile(loader.load('models/member-profile.js').memberProfileForm(), 0, true);
  assert.equal(calls[0].path, '/api/account/member-profile');
  assert.equal(calls[0].auth, 'required');
  assert.equal(calls[1].method, 'PUT');
  assert.equal(calls[1].retries, 0);
  assert.equal(calls[1].data.completeRegistration, true);
  assert.equal(Object.hasOwn(calls[1].data, 'phone'), false);
});

test('profile account-return helper is one-shot and cannot carry arbitrary navigation', () => {
  const service = createLoader().load('services/member-profile.js');
  service.rememberProfileAccountReturn('phone');
  assert.equal(service.consumeProfileAccountReturn(), 'phone');
  assert.equal(service.consumeProfileAccountReturn(), '');
  service.rememberProfileAccountReturn('/malicious/path');
  assert.equal(service.consumeProfileAccountReturn(), 'login');
});

test('guest profile does not fetch or submit and goes through existing account login gate', async () => {
  const { page, calls } = pageFixture({ logged: false });
  page.onShow();
  await page.saveProfile();
  assert.deepEqual(calls, [{ intent: 'login' }, { switchTab: '/pages/account/index' }]);
  assert.equal(page.data.loaded, false);
});

test('unbound customer sees read-only profile and cannot save', async () => {
  const { page, calls } = pageFixture({ value: response({ accountPhone: null, canEdit: false, canCompleteRegistration: false }) });
  await page.loadProfile();
  await page.saveProfile();
  assert.equal(calls.some(call => call.save), false);
  page.bindPhone();
  assert.deepEqual(calls.slice(-2), [{ intent: 'phone' }, { switchTab: '/pages/account/index' }]);
});

test('explicit completion saves only profile and updates its own revision', async () => {
  const { page, calls } = pageFixture();
  await page.loadProfile();
  page.onFieldInput({ currentTarget: { dataset: { field: 'displayName' } }, detail: { value: '新称呼' } });
  await page.saveProfile();
  const write = calls.find(call => call.save).save;
  assert.equal(write[0].displayName, '新称呼');
  assert.equal(write[1], 0);
  assert.equal(write[2], true);
  assert.equal(page.data.profile.revision, 1);
});

test('registered existing customer edits without repeating registration', async () => {
  const current = response(); current.profile.registeredAt = '2026-10-01T00:00:00.000Z'; current.profile.revision = 4;
  const { page, calls } = pageFixture({ value: current });
  await page.loadProfile(); await page.saveProfile();
  assert.equal(calls.find(call => call.save).save[2], false);
});

test('duplicate save is suppressed and unloaded response cannot update page', async () => {
  const { page, calls, release } = pageFixture({ pendingSave: true });
  await page.loadProfile();
  const first = page.saveProfile(); await new Promise(setImmediate); await page.saveProfile();
  assert.equal(calls.filter(call => call.save).length, 1);
  page.onUnload(); release(); await first;
  assert.equal(page.data.profile.revision, 0);
  assert.equal(calls.some(call => call.toast), false);
});

test('revision conflict retains draft and blocks accidental overwrite until fresh load', async () => {
  const { page, calls } = pageFixture({ saveError: new Error('MEMBER_PROFILE_REVISION_CONFLICT') });
  await page.loadProfile();
  page.onFieldInput({ currentTarget: { dataset: { field: 'displayName' } }, detail: { value: '保留草稿' } });
  await page.saveProfile(); await page.saveProfile();
  assert.equal(page.data.form.displayName, '保留草稿');
  assert.equal(page.data.conflict, true);
  assert.equal(calls.filter(call => call.save).length, 1);
});

test('returning from optional subscription page preserves unsaved draft', async () => {
  const { page, calls } = pageFixture();
  page.onShow(); await new Promise(setImmediate);
  page.onFieldInput({ currentTarget: { dataset: { field: 'displayName' } }, detail: { value: '未保存称呼' } });
  page.onShow(); await new Promise(setImmediate);
  assert.equal(page.data.form.displayName, '未保存称呼');
  assert.equal(calls.filter(call => call === 'fetch').length, 1);
});

test('same-account verified phone change refreshes editing eligibility exactly once', async () => {
  const value = response({ accountPhone: null, canEdit: false, canCompleteRegistration: false });
  const { page, calls, setUser } = pageFixture({ value });
  page.onShow(); await new Promise(setImmediate);
  assert.equal(page.data.canEdit, false);
  value.accountPhone = '13900000002'; value.canEdit = true; value.canCompleteRegistration = true;
  setUser({ id: 'current-account', phone: '13900000002' });
  page.onShow(); await new Promise(setImmediate);
  assert.equal(page.data.canEdit, true);
  assert.equal(page.data.accountPhone, '13900000002');
  page.onShow(); await new Promise(setImmediate);
  assert.equal(calls.filter(call => call === 'fetch').length, 2);
});

test('server phone normalization does not discard a same-account draft on every return', async () => {
  const { page, calls, setUser } = pageFixture();
  setUser({ id: 'current-account', phone: null });
  page.onShow(); await new Promise(setImmediate);
  page.onFieldInput({ currentTarget: { dataset: { field: 'displayName' } }, detail: { value: '仍在填写' } });
  page.onShow(); await new Promise(setImmediate);
  assert.equal(page.data.form.displayName, '仍在填写');
  assert.equal(calls.filter(call => call === 'fetch').length, 1);
});

test('show resets unloaded state so an eligible reload can apply', async () => {
  const { page, calls } = pageFixture();
  page.onUnload(); page.onShow(); await new Promise(setImmediate);
  assert.equal(page.unloaded, false);
  assert.equal(page.data.loaded, true);
  assert.equal(calls.filter(call => call === 'fetch').length, 1);
});

test('unbound avatar and nickname entrances reach the existing verified phone flow', async () => {
  for (const action of ['openAvatarSettings', 'editName']) {
    const { page, calls } = pageFixture({ value: response({ accountPhone: null, canEdit: false, canCompleteRegistration: false }) });
    page.onShow(); await new Promise(setImmediate);
    page[action]();
    assert.deepEqual(calls.slice(-2), [{ intent: 'phone' }, { switchTab: '/pages/account/index' }], action);
    assert.equal(page.data.nameFocused, false);
    assert.equal(calls.some(call => call.save), false);
  }
});

test('native nickname blur captures recommendation and preserves manual input when no value is provided', async () => {
  const { page } = pageFixture(); page.onShow(); await new Promise(setImmediate);
  page.editName(); assert.equal(page.data.nameFocused, true);
  page.onNameBlur({ detail: { value: '微信昵称建议' } });
  assert.equal(page.data.form.displayName, '微信昵称建议');
  assert.equal(page.data.nameFocused, false);
  page.onFieldInput({ currentTarget: { dataset: { field: 'displayName' } }, detail: { value: '手动昵称' } });
  page.onNameBlur({ detail: {} });
  assert.equal(page.data.form.displayName, '手动昵称');
  page.onNameBlur({ detail: { value: '' } });
  assert.equal(page.data.form.displayName, '');
});

test('a delayed nickname blur cannot copy an old account draft into the current account', async () => {
  const { page, setUser } = pageFixture(); page.onShow(); await new Promise(setImmediate);
  page.onFieldInput({ currentTarget: { dataset: { field: 'displayName' } }, detail: { value: '保留原草稿' } });
  setUser({ id: 'different-account', phone: '13900000005' });
  page.onNameBlur({ detail: { value: '上个账号的昵称' } });
  assert.equal(page.data.form.displayName, '保留原草稿');
});

test('profile offers native nickname entry and a visible phone action instead of a disabled registration', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/member-profile/index.wxml'), 'utf8');
  assert.match(wxml, /<input[^>]*type="nickname"[^>]*bindblur="onNameBlur"/);
  assert.match(wxml, /<button[^>]*bindtap="editName"[^>]*aria-label="绑定手机号，设置昵称"/);
  assert.match(wxml, /<button[^>]*bindtap="bindPhone">绑定手机号<\/button>/);
  assert.doesNotMatch(wxml, /自动保存，可随时更换|生日及其他选填资料可随时|手机号通过微信授权或短信|member-disclosure|member-subscriptions__copy/);
});

test('member UI has separate optional subscription, manual region, policy links and no invented rewards', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/member-profile/index.wxml'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'pages/member-profile/index.js'), 'utf8');
  assert.match(wxml, /mode="region"/);
  assert.match(wxml, /订阅品牌消息/);
  for (const method of ['openTerms', 'openPrivacy', 'openMiniPrivacy']) assert.match(wxml, new RegExp('bindtap="' + method + '"'));
  assert.doesNotMatch(js, /getLocation|chooseLocation|linkPhoneToAccount|updateOrder|createOrder/);
  assert.doesNotMatch(wxml, /赚取100|生日月专属礼遇|跨境第三方|已满18/);
});

test('new order shortcuts only filter display and preserve the existing shipping link', () => {
  const loader = createLoader();
  loader.load('pages/orders/index.js');
  const page = loader.page;
  page.setData = patch => Object.assign(page.data, patch);
  const rows = [
    { orderNo: 'pending', status: 'CONFIRMED', paymentStatus: 'PAID', fulfillmentStatus: 'PENDING' },
    { orderNo: 'preparing', status: 'CONFIRMED', paymentStatus: 'PAID', fulfillmentStatus: 'PROCESSING' },
    { orderNo: 'shipped', status: 'CONFIRMED', paymentStatus: 'PAID', fulfillmentStatus: 'SHIPPED' },
    { orderNo: 'delivered', status: 'CONFIRMED', paymentStatus: 'PAID', fulfillmentStatus: 'DELIVERED' },
    { orderNo: 'unpaid', status: 'CREATED', paymentStatus: 'NOT_STARTED', fulfillmentStatus: 'PENDING', canPay: true },
    { orderNo: 'cancelled', status: 'CANCELLED', paymentStatus: 'CANCELLED', fulfillmentStatus: 'PENDING' },
    { orderNo: 'refunded', status: 'CONFIRMED', paymentStatus: 'REFUNDED', fulfillmentStatus: 'SHIPPED' },
  ];
  const before = JSON.stringify(rows);
  for (const [filter, expected] of [['unshipped', ['pending', 'preparing']], ['shipped', ['shipped']], ['shipping', ['pending', 'preparing', 'shipped']]]) {
    page.onLoad({ filter });
    assert.equal(page.data.activeFilter, filter);
    page.applyFilter(filter, rows);
    assert.deepEqual(Array.from(page.data.visibleOrders, row => row.orderNo), expected);
  }
  assert.equal(JSON.stringify(rows), before);
});

test('member center cards retain original benefits and do not advertise unconfigured rewards', () => {
  const wxml = fs.readFileSync(path.join(root, 'pages/account/index.wxml'), 'utf8');
  for (const marker of ['account-wallet', 'account-claim', 'account-points', 'account-newcomer', '商品礼品卡']) {
    if (marker === '商品礼品卡') assert.match(fs.readFileSync(path.join(root, 'pages/account/index.js'), 'utf8'), /商品礼品卡/);
    else assert.match(wxml, new RegExp(marker));
  }
  for (const route of ['unpaid', 'unshipped', 'shipped']) assert.match(wxml, new RegExp('filter=' + route));
  assert.doesNotMatch(wxml, /每月最高|每有1位|抽奖.*惊喜好礼|赚取100|邀请.*[+＋]\d/);
  assert.match(wxml, /operations\.xiaohongshuVisible/);
  assert.match(wxml, /operations\.enterpriseVisible/);
});

test('member summary failure shows unknown values rather than an invented zero balance', async () => {
  const overrides = {};
  overrides[path.join(root, 'stores/session.js')] = { hasSession: () => true };
  overrides[path.join(root, 'services/auth.js')] = { getCachedUser: () => ({ id: 'same' }) };
  overrides[path.join(root, 'services/member.js')] = { fetchMember: async () => { throw new Error('NETWORK_REQUEST_FAILED'); } };
  overrides[path.join(root, 'services/member-profile.js')] = { fetchMemberProfile: async () => { throw new Error('MEMBER_PROFILE_UNAVAILABLE'); } };
  overrides[path.join(root, 'services/member-operations.js')] = { fetchMemberOperations: async () => { throw new Error('MEMBER_OPERATIONS_UNAVAILABLE'); } };
  const loader = createLoader({}, overrides); loader.load('pages/account/index.js'); const page = loader.page;
  page.setData = patch => Object.assign(page.data, patch);
  await page.loadMemberSummary();
  assert.equal(page.data.memberPoints, '—');
  assert.equal(page.data.memberCouponCount, '—');
  assert.equal(page.data.operations, null);
});

test('account phone intent resumes profile only after the existing verified binding succeeds', async () => {
  const calls = []; let user = { id: 'old', phone: null };
  const overrides = {};
  overrides[path.join(root, 'stores/session.js')] = { hasSession: () => true };
  overrides[path.join(root, 'services/auth.js')] = { getCachedUser: () => user, fetchCurrentUser: async () => user, linkPhoneToAccount: async (phone, code) => { calls.push({ phone, code }); user = { id: 'merged', phone }; return user; } };
  overrides[path.join(root, 'services/guest-sync.js')] = { syncGuestCart: async () => { calls.push('sync'); } };
  overrides[path.join(root, 'services/member.js')] = { fetchMemberPromotions: async () => ({}), fetchMember: async () => ({}) };
  overrides[path.join(root, 'services/member-profile.js')] = { consumeProfileAccountReturn: () => 'phone', fetchMemberProfile: async () => ({ profile: { displayName: '' } }) };
  overrides[path.join(root, 'services/member-operations.js')] = { fetchMemberOperations: async () => ({}) };
  const loader = createLoader({ pageScrollTo: () => {}, stopPullDownRefresh: () => {}, showToast: () => {}, navigateTo: value => calls.push({ url: value.url }) }, overrides);
  loader.load('pages/account/index.js'); const page = loader.page; page.setData = patch => Object.assign(page.data, patch);
  page.onShow(); await new Promise(setImmediate);
  assert.equal(page.data.phoneLinkOpen, true);
  assert.equal(calls.some(call => call.url), false);
  page.setData({ phone: '13900000002', smsCode: '123456', smsSent: true });
  await page.verifyPhoneLink();
  assert.deepEqual(calls.slice(0, 2), ['sync', { phone: '13900000002', code: '123456' }]);
  assert.equal(calls[calls.length - 1].url, '/pages/member-profile/index');
});

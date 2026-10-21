const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLoader, root } = require('./test-loader.cjs');

const ownCode = 'OWN_invite-123';
const home = '/pages/home/home';
function overview(patch = {}) {
  return { ok: true, registered: true, tasks: [{ key: 'INVITE', enabled: true, state: 'AVAILABLE', title: '邀请入会' }],
    referral: { code: ownCode, invited: 0, rewarded: 0, bound: false }, ...patch };
}
function fixture({ value = overview(), guest = false, userId = 'MEMBER-A', options = {} } = {}) {
  const store = new Map([['merchantkit.session', guest ? null : { accessToken: 'test-invite-session', expiresAt: '2099-01-01' }],
    ['merchantkit.user', { id: userId }]]);
  const calls = [], routes = [], service = { fetchMemberOperations: async () => structuredClone(value),
    memberOperation: async (action, payload) => { calls.push({ action, payload }); return { ok: true }; } };
  const loader = createLoader({ getStorageSync: key => store.get(key), setStorageSync: (key, item) => store.set(key, item), removeStorageSync: key => store.delete(key),
    switchTab: ({ url }) => routes.push(url), navigateTo: ({ url }) => routes.push(url), stopPullDownRefresh() {} },
  { [path.join(root, 'services/member-operations.js')]: service,
    [path.join(root, 'utils/member-referral.js')]: { capturePendingReferral: () => ({ status: 'none' }), maybeBindPendingReferral: async () => ({ status: 'none' }), pendingReferralStatus: () => ({ status: 'none' }) } });
  loader.load('pages/member-invite/index.js');
  const page = loader.page; page.data = structuredClone(page.data); page.setData = patch => Object.assign(page.data, patch); page.prepareOwnInvitation = async () => {}; page.onLoad(options);
  return { page, store, calls, routes, loader, service };
}
function assertHome(page) {
  const card = page.onShareAppMessage(); assert.equal(card.path, home); assert.equal(card.title, 'MerchantKit');
  assert.equal(card.imageUrl, '/assets/brand/member-invite-share.jpg');
  assert.doesNotMatch(JSON.stringify(card), /referralCode|优惠券|积分|领取/);
}

test('current registered member shares their own invitation without a business write', async () => {
  const f = fixture(); await f.page.loadOperations(); const before = JSON.stringify(f.page.data);
  const card = f.page.onShareAppMessage(); assert.equal(card.title, '邀请你加入 MerchantKit 会员');
  assert.equal(card.imageUrl, '/assets/brand/member-invite-share.jpg');
  assert.equal(card.path, '/pages/member-invite/index?referralCode=' + ownCode); assert.equal(f.calls.length, 0);
  assert.equal(JSON.stringify(f.page.data), before); assert.equal(f.routes.length, 0);
});

test('received invitation and unknown callback fields never become this member referral code', async () => {
  const f = fixture({ options: { referralCode: 'FRIEND123', key: 'INVITE', next: home } }); await f.page.loadOperations();
  const card = f.page.onShareAppMessage({ from: 'button', target: { dataset: { referralCode: 'FORGED123', key: 'OTHER' } }, query: 'referralCode=FORGED123' });
  assert.equal(card.path, '/pages/member-invite/index?referralCode=' + ownCode); assert.equal(f.page.incomingCode, 'FRIEND123'); assert.equal(f.calls.length, 0);
  f.page.setData({ overview: { ...f.page.data.overview, referral: { code: null } } }); assertHome(f.page);
});

test('malformed or non-string current referral codes fall back to an ordinary brand card', async () => {
  for (const code of [null, undefined, '', 'short', 'a'.repeat(81), 'abc def', 'abc?def', 'abc&def', 'abc#def', 'https://evil.invalid', '邀请12345', 123456, ['INVITE123'], { code: 'INVITE123' }]) {
    const f = fixture({ value: overview({ referral: { code } }) }); await f.page.loadOperations(); assertHome(f.page); assert.equal(f.calls.length, 0);
  }
});

test('only the current exact enabled INVITE task can produce a dedicated invitation card', async () => {
  for (const tasks of [[], [{ key: 'OTHER', enabled: true, state: 'AVAILABLE' }], [{ key: 'INVITE', enabled: false, state: 'DISABLED' }],
    [{ key: 'INVITE', enabled: 'true', state: 'AVAILABLE' }], [{ key: 'INVITE', enabled: true, state: 'DISABLED' }],
    [{ key: 'INVITE', enabled: true, state: 'UNKNOWN' }], [{ key: 'INVITE', enabled: true, state: 'AVAILABLE' }, { key: 'INVITE', enabled: true, state: 'AVAILABLE' }]]) {
    const f = fixture({ value: overview({ tasks }) }); await f.page.loadOperations();
    f.page.setData({ inviteTask: { key: 'INVITE', enabled: true, state: 'AVAILABLE' } }); assertHome(f.page); assert.equal(f.calls.length, 0);
  }
});

test('guests and accounts without completed membership never share a dedicated invitation', async () => {
  const guest = fixture({ guest: true }); await guest.page.loadOperations(); assertHome(guest.page);
  const unregistered = fixture({ value: overview({ registered: false }) }); await unregistered.page.loadOperations(); assertHome(unregistered.page);
  const noIdentity = fixture({ userId: '' }); await noIdentity.page.loadOperations(); assertHome(noIdentity.page);
  const unloaded = fixture(); assertHome(unloaded.page);
});

test('busy, loading, failed, guest or disposed snapshots cannot share an old invite', async () => {
  for (const flag of ['busy', 'loading', 'syncFailed', 'guest', 'disposed']) {
    const f = fixture(); await f.page.loadOperations(); if (flag === 'disposed') f.page.onUnload(); else f.page.setData({ [flag]: true });
    assertHome(f.page); assert.equal(f.calls.length, 0);
  }
});

test('account switch and logout block the previous account invitation before any reload', async () => {
  for (const change of [f => f.store.set('merchantkit.user', { id: 'MEMBER-B' }), f => f.store.delete('merchantkit.session'), f => f.store.delete('merchantkit.user')]) {
    const f = fixture(); await f.page.loadOperations(); change(f); assertHome(f.page); assert.equal(f.calls.length, 0);
  }
});

test('failed refresh cannot keep sharing the last successfully loaded invitation', async () => {
  const f = fixture(); await f.page.loadOperations(); f.service.fetchMemberOperations = async () => { throw Error('NETWORK_REQUEST_FAILED'); };
  await f.page.loadOperations(); assert.equal(f.page.data.syncFailed, true); assertHome(f.page); assert.equal(f.calls.length, 0);
});

test('valid received code survives login return while invalid or foreign query values are discarded', () => {
  const valid = fixture({ guest: true, options: { referralCode: 'FRIEND123', next: 'https://evil.invalid' } });
  valid.page.goLogin(); assert.equal(valid.loader.load('stores/navigation.js').consumeMemberLoginReturn(), '/pages/member-invite/index?referralCode=FRIEND123');
  for (const code of ['abc&def', 'a'.repeat(81), ['FRIEND123'], { code: 'FRIEND123' }]) {
    const invalid = fixture({ guest: true, options: { referralCode: code } }); invalid.page.goLogin();
    assert.equal(invalid.loader.load('stores/navigation.js').consumeMemberLoginReturn(), '/pages/member-invite/index');
  }
});

test('the fixed invitation cover is a real lightweight packaged JPEG at the requested card ratio', () => {
  const image = fs.readFileSync(path.join(root, 'assets/brand/member-invite-share.jpg'));
  assert.ok(image.length > 0 && image.length < 100 * 1024); assert.equal(image.readUInt16BE(0), 0xffd8);
  let dimensions = null;
  for (let offset = 2; offset + 8 < image.length;) {
    assert.equal(image[offset], 0xff); const marker = image[offset + 1];
    if ([0xc0, 0xc1, 0xc2].includes(marker)) { dimensions = { width: image.readUInt16BE(offset + 7), height: image.readUInt16BE(offset + 5) }; break; }
    const length = image.readUInt16BE(offset + 2); assert.ok(length >= 2); offset += length + 2;
  }
  assert.deepEqual(dimensions, { width: 500, height: 400 });
});

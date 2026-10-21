const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const { createLoader, root } = require('./test-loader.cjs');
function fixture(options = {}) {
  const storage = options.storage || new Map(), calls = [];
  const state = { owner: 'A', loggedIn: true, registered: true, enabled: true, bound: false, writeFails: false, identityFails: false, ...options };
  const service = { fetchMemberOperations: async () => { if (state.fetch) return state.fetch(); return { registered: state.registered, tasks: [{ key: 'INVITE', enabled: state.enabled }], referral: { bound: state.bound } }; },
    memberOperation: async (action, payload) => { calls.push({ action, payload }); if (state.action) return state.action(action, payload); state.bound = true; return { ok: true, bound: true }; } };
  const loader = createLoader({ getStorageSync: key => storage.get(key), setStorageSync: (key, value) => { if (state.writeFails) throw Error('quota'); storage.set(key, structuredClone(value)); } }, {
    [path.join(root, 'stores/session.js')]: { hasSession: () => { if (state.identityFails) throw Error('storage unavailable'); return state.loggedIn; }, readStoredUser: () => ({ id: state.owner }) },
    [path.join(root, 'services/member-operations.js')]: service,
  });
  return { helper: loader.load('utils/member-referral.js'), state, calls, storage, service };
}

test('incoming invitation survives login and membership registration, then binds once without a confirmation', async () => {
  const f = fixture({ loggedIn: false, registered: false }); f.helper.capturePendingReferral('FRIEND123');
  assert.equal((await f.helper.maybeBindPendingReferral()).status, 'waiting_login'); assert.equal(f.calls.length, 0);
  const resumed = fixture({ storage: f.storage, registered: false }); assert.equal((await resumed.helper.maybeBindPendingReferral()).status, 'waiting_membership');
  resumed.state.registered = true; assert.equal((await resumed.helper.maybeBindPendingReferral()).status, 'bound');
  await resumed.helper.maybeBindPendingReferral(); assert.deepEqual(JSON.parse(JSON.stringify(resumed.calls)), [{ action: 'bind_referral', payload: { code: 'FRIEND123' } }]);
});

test('automatic account hooks do not inherit the previous account invitation, but a new explicit link can be captured', async () => {
  const f = fixture(); f.helper.capturePendingReferral('FIRST123'); f.state.owner = 'B';
  assert.equal((await f.helper.maybeBindPendingReferral()).status, 'account_changed'); assert.equal(f.calls.length, 0);
  f.helper.capturePendingReferral('SECOND123'); assert.equal((await f.helper.maybeBindPendingReferral()).status, 'bound'); assert.equal(f.calls[0].payload.code, 'SECOND123');
  const guest = fixture(); guest.helper.capturePendingReferral('FIRST123'); guest.state.loggedIn = false;
  guest.helper.capturePendingReferral('GUEST123'); guest.state.owner = 'C'; guest.state.loggedIn = true;
  assert.equal((await guest.helper.maybeBindPendingReferral()).status, 'bound'); assert.equal(guest.calls[0].payload.code, 'GUEST123');
});

test('same-account pending and in-flight invitations cannot be replaced by another link or double submitted', async () => {
  const f = fixture(); let resolve; f.state.action = () => new Promise(done => { resolve = done; });
  f.helper.capturePendingReferral('FIRST123'); f.helper.capturePendingReferral('SECOND123');
  const first = f.helper.maybeBindPendingReferral(); await new Promise(setImmediate);
  f.helper.capturePendingReferral('THIRD123'); const second = f.helper.maybeBindPendingReferral();
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].payload.code, 'FIRST123'); resolve({ ok: true, bound: true }); await Promise.all([first, second]);
});

test('the first anonymous pending link keeps its attribution when login precedes the authentication hook', async () => {
  const f = fixture({ loggedIn: false }); f.helper.capturePendingReferral('FIRST123');
  f.state.loggedIn = true; f.helper.capturePendingReferral('SECOND123');
  assert.equal((await f.helper.maybeBindPendingReferral()).status, 'bound'); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].payload.code, 'FIRST123');
});

test('ambiguous binding failure is persisted and ordinary refreshes do not repeat its POST', async () => {
  const f = fixture({ action: async () => { throw Error('NETWORK_REQUEST_FAILED'); } }); f.helper.capturePendingReferral('FIRST123');
  assert.equal((await f.helper.maybeBindPendingReferral()).status, 'retry'); await f.helper.maybeBindPendingReferral(); assert.equal(f.calls.length, 1);
  const resumed = fixture({ storage: f.storage }); assert.equal((await resumed.helper.maybeBindPendingReferral()).status, 'retry'); assert.equal(resumed.calls.length, 0);
  assert.equal((await resumed.helper.maybeBindPendingReferral({ retry: true })).status, 'bound'); assert.equal(resumed.calls[0].payload.code, 'FIRST123');
});

test('a committed but unanswered binding is resolved by a read and never credits or binds twice', async () => {
  const f = fixture({ action: async () => { throw Error('NETWORK_REQUEST_FAILED'); } }); f.helper.capturePendingReferral('FIRST123'); await f.helper.maybeBindPendingReferral();
  f.state.bound = true; assert.equal((await f.helper.maybeBindPendingReferral()).status, 'already_bound'); assert.equal(f.calls.length, 1);
  f.helper.capturePendingReferral('SECOND123'); await f.helper.maybeBindPendingReferral(); assert.equal(f.calls.length, 1);
});

test('phone, membership or activity changes before a POST restore pending state and permit later automatic binding', async () => {
  for (const message of ['MEMBER_PHONE_REQUIRED', 'MEMBERSHIP_REQUIRED', 'MEMBER_OPERATIONS_DISABLED']) {
    const f = fixture({ action: async () => { throw Error(message); } }); f.helper.capturePendingReferral('FIRST123'); await f.helper.maybeBindPendingReferral();
    assert.equal(f.helper.pendingReferralStatus().status, 'pending'); f.state.action = null;
    assert.equal((await f.helper.maybeBindPendingReferral()).status, 'bound'); assert.equal(f.calls.length, 2);
  }
});

test('invalid invitations can be replaced by a different explicit link while ineligible accounts never auto retry', async () => {
  const f = fixture({ action: async () => { throw Error('MEMBER_OPERATIONS_INVALID_REFERRAL'); } }); f.helper.capturePendingReferral('BADCODE123');
  assert.equal((await f.helper.maybeBindPendingReferral()).status, 'invalid'); f.helper.capturePendingReferral('GOODCODE123'); f.state.action = null;
  assert.equal((await f.helper.maybeBindPendingReferral()).status, 'bound'); assert.equal(f.calls[1].payload.code, 'GOODCODE123');
  const old = fixture({ action: async () => { throw Error('MEMBER_OPERATIONS_NEW_MEMBER_REQUIRED'); } }); old.helper.capturePendingReferral('FIRST123'); await old.helper.maybeBindPendingReferral();
  await old.helper.maybeBindPendingReferral(); assert.equal(old.calls.length, 1); assert.equal(old.helper.pendingReferralStatus().status, 'ineligible');
});

test('no identity storage exception can synchronously fail a successful authentication hook', async () => {
  const f = fixture(); f.helper.capturePendingReferral('FIRST123'); f.state.identityFails = true;
  assert.doesNotThrow(() => f.helper.capturePendingReferral('SECOND123'));
  let operation; assert.doesNotThrow(() => { operation = f.helper.maybeBindPendingReferral(); });
  assert.equal((await operation).status, 'storage_failed'); assert.equal(f.calls.length, 0);
  const loader = createLoader({ getStorageSync: () => { throw Error('storage unavailable'); } }); const helper = loader.load('utils/member-referral.js');
  assert.doesNotThrow(() => helper.pendingReferralStatus()); assert.equal((await helper.maybeBindPendingReferral()).status, 'storage_failed');
});

test('failed persistence blocks background hooks but permits one explicit retry from the current page memory', async () => {
  const f = fixture({ writeFails: true }); assert.equal(f.helper.capturePendingReferral('FIRST123').status, 'storage_failed');
  assert.equal((await f.helper.maybeBindPendingReferral()).status, 'storage_failed'); assert.equal(f.calls.length, 0);
  assert.equal((await f.helper.maybeBindPendingReferral({ retry: true, allowMemory: true })).status, 'bound');
  await f.helper.maybeBindPendingReferral(); assert.equal(f.calls.length, 1); assert.equal(f.helper.pendingReferralStatus().status, 'bound');
});

test('account change during an eligibility read cannot send the previous account invitation', async () => {
  let resolve; const f = fixture({ fetch: () => new Promise(done => { resolve = done; }) }); f.helper.capturePendingReferral('FIRST123');
  const waiting = f.helper.maybeBindPendingReferral(); f.state.owner = 'B'; resolve({ registered: true, tasks: [{ key: 'INVITE', enabled: true }], referral: { bound: false } });
  assert.equal((await waiting).status, 'account_changed'); assert.equal(f.calls.length, 0);
});

test('invitation page has no internal code, hand entry or manual confirmation UI', () => {
  const xml = fs.readFileSync(path.join(root, 'pages/member-invite/index.wxml'), 'utf8');
  assert.doesNotMatch(xml, /邀请码|receivedCode|referral\.code|bindReferral|生成我的|<input/);
  assert.match(xml, /邀请好友/); assert.match(xml, /重新准备邀请/); assert.match(xml, /邀请记录/);
});

function pageFixture(options = {}) {
  const state = { owner: 'A', loggedIn: true, registered: true, enabled: true, code: null, bound: false, failCreate: false, writeFails: false, ...options }, calls = [], routes = [], storage = new Map();
  const value = () => ({ registered: state.registered, pointsBalance: 0, tasks: [{ key: 'INVITE', enabled: state.enabled, state: state.enabled ? 'AVAILABLE' : 'DISABLED' }],
    referral: { code: state.code, bound: state.bound, invited: 0, rewarded: 0 }, lotteries: [], surveys: [], posts: [] });
  const service = { fetchMemberOperations: async () => value(), memberOperation: async (action, payload) => {
    calls.push({ action, payload }); if (action === 'create_referral') { if (state.failCreate) throw Error('NETWORK_REQUEST_FAILED'); state.code = 'OWN_CODE123'; return { ok: true, code: state.code }; }
    if (action === 'bind_referral') { state.bound = true; return { ok: true, bound: true }; } throw Error('Unexpected action');
  } };
  const loader = createLoader({ getStorageSync: key => storage.get(key), setStorageSync: (key, value) => { if (state.writeFails) throw Error('quota'); storage.set(key, structuredClone(value)); }, switchTab: ({ url }) => routes.push(url), navigateTo: ({ url }) => routes.push(url), stopPullDownRefresh() {} }, {
    [path.join(root, 'stores/session.js')]: { hasSession: () => state.loggedIn, readStoredUser: () => ({ id: state.owner }) },
    [path.join(root, 'services/member-operations.js')]: service,
  });
  loader.load('pages/member-invite/index.js'); const page = loader.page; page.data = structuredClone(page.data); page.setData = patch => Object.assign(page.data, patch); page.onLoad(options.entry || {});
  return { page, state, calls, routes, loader, service };
}

test('inviter page automatically prepares one own share identifier after loading and never repeats it on refresh', async () => {
  const f = pageFixture(); await f.page.loadOperations(); assert.equal(f.page.data.inviteReady, true); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].action, 'create_referral');
  await f.page.loadOperations(); await f.page.loadOperations(); assert.equal(f.calls.length, 1); assert.equal(f.page.data.loading, false); assert.equal(f.page.data.busy, false);
  const card = f.page.onShareAppMessage(); assert.match(card.path, /referralCode=OWN_CODE123/); assert.equal(f.calls.length, 1);
});

test('recipient page binds the received invitation without a manual confirmation, then prepares its own different share identifier', async () => {
  const f = pageFixture({ entry: { referralCode: 'FRIEND123' } }); await f.page.loadOperations();
  assert.deepEqual(f.calls.map(row => row.action), ['bind_referral', 'create_referral']); assert.equal(f.calls[0].payload.code, 'FRIEND123');
  assert.equal(f.page.data.referralText, '邀请关系已建立。'); assert.match(f.page.onShareAppMessage().path, /referralCode=OWN_CODE123/);
  await f.page.loadOperations(); assert.equal(f.calls.length, 2);
});

test('preparation failure exposes only explicit retry and normal refresh does not post again', async () => {
  const f = pageFixture({ failCreate: true }); await f.page.loadOperations(); assert.equal(f.page.data.invitePrepareFailed, true); assert.equal(f.calls.length, 1);
  await f.page.loadOperations(); assert.equal(f.calls.length, 1); f.state.failCreate = false; await f.page.retryInvitePreparation();
  assert.equal(f.calls.length, 2); assert.equal(f.page.data.inviteReady, true); assert.equal(f.page.data.invitePrepareFailed, false);
});

test('no invitation is created or bound before registration or when the activity is closed', async () => {
  for (const options of [{ registered: false }, { loggedIn: false }, { enabled: false }]) {
    const f = pageFixture({ ...options, entry: { referralCode: 'FRIEND123' } }); await f.page.loadOperations(); assert.equal(f.calls.length, 0);
  }
});

test('invitation storage failures never block ordinary login or membership registration navigation', async () => {
  const guest = pageFixture({ loggedIn: false, writeFails: true, entry: { referralCode: 'FRIEND123' } }); guest.page.goLogin();
  assert.deepEqual(guest.routes, ['/pages/account/index']); assert.equal(guest.calls.length, 0); assert.match(guest.page.data.referralError, /未保存/);
  const member = pageFixture({ registered: false, writeFails: true, entry: { referralCode: 'FRIEND123' } }); member.page.joinMember();
  assert.deepEqual(member.routes, ['/pages/member/index']); assert.equal(member.calls.length, 0);
});

test('a new account loaded during old preparation always has a retry entry and never inherits the old result', async () => {
  const f = pageFixture(); let resolve, first = true;
  f.service.memberOperation = async (action, payload) => {
    f.calls.push({ action, payload }); if (first) { first = false; return new Promise(done => { resolve = done; }); }
    f.state.code = 'OWN_B123'; return { ok: true, code: f.state.code };
  };
  const old = f.page.loadOperations(); await new Promise(setImmediate); assert.equal(f.calls.length, 1);
  f.state.owner = 'B'; await f.page.loadOperations(); resolve({ ok: true, code: 'OWN_A123' }); await old;
  assert.equal(f.page.data.inviteReady, false); assert.equal(f.page.data.invitePrepareFailed, true); assert.equal(f.page.data.autoProcessing, false);
  assert.equal(f.page.onShareAppMessage().path, '/pages/home/home'); await f.page.retryInvitePreparation();
  assert.equal(f.page.data.inviteReady, true); assert.match(f.page.onShareAppMessage().path, /referralCode=OWN_B123/); assert.equal(f.calls.length, 2);
});

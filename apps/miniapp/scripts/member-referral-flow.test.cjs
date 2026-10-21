const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader, root } = require('./test-loader.cjs');

function load(file, overrides, wx = {}) {
  const loader = createLoader({ showToast() {}, pageScrollTo() {}, stopPullDownRefresh() {}, ...wx }, overrides);
  loader.load(file);
  const page = loader.page; page.data = structuredClone(page.data); page.setData = value => Object.assign(page.data, value);
  return page;
}
function account({ failLogin = false, failPhone = false, failSync = false, signedIn = false, referral = () => Promise.resolve({ status: 'none' }) } = {}) {
  const user = { id: 'current-user', phone: '13900000002' }, calls = [];
  const overrides = {
    [path.join(root, 'stores/session.js')]: { hasSession: () => signedIn },
    [path.join(root, 'services/auth.js')]: {
      getCachedUser: () => ({ ...user, phone: null }),
      loginWithWeChat: async () => { if (failLogin) throw Error('LOGIN_FAILED'); signedIn = true; return { ...user, phone: null }; },
      fetchCurrentUser: async () => user,
      linkWeChatPhone: async () => { if (failPhone) throw Error('PHONE_FAILED'); return user; },
      linkPhoneToAccount: async () => { if (failPhone) throw Error('PHONE_FAILED'); return user; },
    },
    [path.join(root, 'services/guest-sync.js')]: { syncGuestCart: async () => { calls.push('cart'); if (failSync) throw Error('CART_SYNC_PENDING'); } },
    [path.join(root, 'utils/member-referral.js')]: { maybeBindPendingReferral: () => { calls.push('referral'); return referral(); } },
  };
  const page = load('pages/account/index.js', overrides);
  page.loadMemberPromotions = () => {}; page.loadMemberSummary = () => {}; page.finishMemberLogin = () => calls.push('navigate');
  page.setData({ consented: true, crossBorderConsented: true, phoneConsent: true, smsCode: '123456', phone: user.phone });
  return { page, calls };
}

test('login resumes an incoming referral without waiting for its network request', async () => {
  const f = account({ referral: () => new Promise(() => {}) }); await f.page.signIn();
  assert.equal(f.page.data.loggedIn, true); assert.equal(f.page.data.loading, false);
  assert.deepEqual(f.calls, ['referral', 'cart', 'navigate']);
});
test('failed login never attempts referral binding; referral errors do not break successful login', async () => {
  const failed = account({ failLogin: true }); await failed.page.signIn(); assert.equal(failed.calls.length, 0);
  const ok = account({ referral: async () => { throw Error('NETWORK_FAILED'); } }); await ok.page.signIn();
  assert.equal(ok.page.data.loggedIn, true); assert.equal(ok.page.data.error, ''); assert.ok(ok.calls.includes('navigate'));
});
test('phone authorization resumes referral only after cart sync and phone linking succeed', async () => {
  const ok = account({ signedIn: true }); await ok.page.authorizePhone({ detail: { code: 'phone-code' } });
  assert.deepEqual(ok.calls, ['cart', 'referral', 'navigate']);
  for (const options of [{ failPhone: true }, { failSync: true }]) {
    const failed = account({ signedIn: true, ...options }); await failed.page.authorizePhone({ detail: { code: 'phone-code' } });
    assert.equal(failed.calls.includes('referral'), false);
  }
});
test('SMS phone linking and confirmed account reload resume referral without an extra user action', async () => {
  const linked = account({ signedIn: true }); await linked.page.verifyPhoneLink(); assert.deepEqual(linked.calls, ['cart', 'referral', 'navigate']);
  const failed = account({ signedIn: true, failPhone: true }); await failed.page.verifyPhoneLink(); assert.equal(failed.calls.includes('referral'), false);
  const reloaded = account({ signedIn: true }); await reloaded.page.loadAccount(); assert.equal(reloaded.calls.filter(value => value === 'referral').length, 1);
});
test('membership joining resumes referral after success, without delaying membership confirmation', async () => {
  const calls = [];
  const page = load('pages/member/index.js', {
    [path.join(root, 'services/member.js')]: { memberAction: async action => calls.push(action) },
    [path.join(root, 'utils/member-referral.js')]: { maybeBindPendingReferral: () => { calls.push('referral'); return new Promise(() => {}); } },
  });
  page.setData({ loading: false, accepted: true }); page.showActionResult = async () => calls.push('confirmed');
  await page.join(); assert.deepEqual(calls, ['join', 'referral', 'confirmed']); assert.equal(page.data.busy, false);
  calls.length = 0; await page.perform('claim', 'coupon'); assert.deepEqual(calls, ['claim', 'confirmed']);
});
test('failed or unconsented membership joining never resumes referral binding', async () => {
  let attempts = 0;
  const page = load('pages/member/index.js', {
    [path.join(root, 'services/member.js')]: { memberAction: async () => { throw Error('MEMBER_PHONE_REQUIRED'); } },
    [path.join(root, 'utils/member-referral.js')]: { maybeBindPendingReferral: async () => { attempts++; } },
  });
  page.setData({ loading: false, accepted: false }); await page.join(); assert.equal(attempts, 0);
  page.setData({ accepted: true }); await page.join(); assert.equal(attempts, 0);
});
test('profile registration resumes pending referral only after a successful current-page save', async () => {
  let attempts = 0, fail = false;
  const page = load('pages/member-profile/index.js', {
    [path.join(root, 'stores/session.js')]: { hasSession: () => true },
    [path.join(root, 'services/member-profile.js')]: { saveMemberProfile: async () => { if (fail) throw Error('SAVE_FAILED'); return {}; } },
    [path.join(root, 'utils/member-referral.js')]: { maybeBindPendingReferral: async () => { attempts++; } },
  });
  page.applyProfile = () => {}; page.setData({ loaded: true, canEdit: true, accountPhone: '13900000002', profile: { registeredAt: null, revision: 0 } });
  await page.saveProfile(); assert.equal(attempts, 1);
  fail = true; await page.saveProfile(); assert.equal(attempts, 1);
  fail = false; page.setData({ profile: { registeredAt: '2026-10-18', revision: 1 } }); await page.saveProfile(); assert.equal(attempts, 1);
});

test('an incoming invitation survives login and phone verification, then binds once on membership joining', async () => {
  const store = new Map(), writes = []; let joined = false, bound = false;
  const user = () => store.get('merchantkit.user');
  const saveUser = value => { store.set('merchantkit.session', { accessToken: 'local-session', expiresAt: '2099-01-01' }); store.set('merchantkit.user', value); return value; };
  const loader = createLoader({ getStorageSync: key => store.get(key), setStorageSync: (key, value) => store.set(key, value), removeStorageSync: key => store.delete(key), showToast() {}, pageScrollTo() {}, stopPullDownRefresh() {} }, {
    [path.join(root, 'services/auth.js')]: { getCachedUser: user,
      loginWithWeChat: async () => saveUser({ id: 'new-member', phone: null }),
      linkWeChatPhone: async () => saveUser({ id: 'new-member', phone: '13900000002' }),
    },
    [path.join(root, 'services/guest-sync.js')]: { syncGuestCart: async () => {} },
    [path.join(root, 'services/member.js')]: { memberAction: async action => { assert.equal(action, 'join'); joined = true; } },
    [path.join(root, 'services/member-operations.js')]: {
      fetchMemberOperations: async () => ({ registered: !!user()?.phone && joined, tasks: [{ key: 'INVITE', enabled: true }], referral: { bound } }),
      memberOperation: async (action, payload) => { writes.push({ action, code: payload.code }); assert.equal(action, 'bind_referral'); bound = true; return { bound: true }; },
    },
  });
  const referral = loader.load('utils/member-referral.js'); referral.capturePendingReferral('FRIEND_123456');
  loader.load('pages/account/index.js'); const accountPage = loader.page; accountPage.data = structuredClone(accountPage.data); accountPage.setData = value => Object.assign(accountPage.data, value);
  accountPage.loadMemberPromotions = () => {}; accountPage.loadMemberSummary = () => {}; accountPage.finishMemberLogin = () => {};
  accountPage.setData({ consented: true, crossBorderConsented: true, phoneConsent: true });
  await accountPage.signIn(); await new Promise(setImmediate); assert.equal(writes.length, 0);
  await accountPage.authorizePhone({ detail: { code: 'verified-phone-code' } }); await new Promise(setImmediate); assert.equal(writes.length, 0);
  loader.load('pages/member/index.js'); const memberPage = loader.page; memberPage.data = structuredClone(memberPage.data); memberPage.setData = value => Object.assign(memberPage.data, value);
  memberPage.setData({ loading: false, accepted: true }); memberPage.showActionResult = async () => {};
  await memberPage.join(); await new Promise(setImmediate);
  assert.deepEqual(writes, [{ action: 'bind_referral', code: 'FRIEND_123456' }]); assert.equal(referral.pendingReferralStatus().status, 'bound');
  await accountPage.authorizePhone({ detail: { code: 'second-phone-code' } }); await referral.maybeBindPendingReferral();
  assert.equal(writes.length, 1);
});

const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const { createLoader, root } = require('./test-loader.cjs');
const choiceKey = 'merchantkit.privacy.choice.v1';
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(options = {}) {
  const storage = options.storage || new Map(), calls = [], reads = [], pages = options.pages || []; let nativeHandler;
  const wx = { getStorageSync(key) { reads.push(key); if (options.storageReadFails) throw Error('storage'); return storage.get(key); },
    setStorageSync(key, value) { if (options.storageWriteFails) throw Error('quota'); storage.set(key, plain(value)); }, removeStorageSync: key => storage.delete(key),
    reLaunch: value => calls.push({ route: value.url }), navigateTo: value => calls.push({ route: value.url }), navigateBack: () => calls.push({ back: true }), switchTab: value => calls.push({ route: value.url }),
    request: value => { calls.push({ request: value }); value.success({ statusCode: 200, data: { ok: true } }); },
    uploadFile: () => calls.push({ upload: true }), downloadFile: () => calls.push({ download: true }), login: () => calls.push({ login: true }), requestPayment: () => calls.push({ payment: true }), requestSubscribeMessage: () => calls.push({ subscribe: true }),
    onNeedPrivacyAuthorization: fn => { nativeHandler = fn; }, getWindowInfo: () => ({ statusBarHeight: 24 }), ...options.wx };
  const loader = createLoader(wx, options.overrides || {}, { globalData: {} }, { privacyAccepted: false, pages });
  const consent = loader.load('stores/privacy-consent.js'), flow = loader.load('utils/privacy-flow.js');
  return { storage, calls, reads, pages, loader, consent, flow, native: resolve => nativeHandler(resolve) };
}
function mountSheet(f) {
  if (!f.pages.length) f.pages.push({ route: 'pages/home/home', options: {}, data: {} });
  f.loader.load('components/privacy-sheet/index.js'); const definition = f.loader.component;
  const component = { data: plain(definition.data), ...definition.methods, setData(patch) { Object.assign(this.data, patch); } };
  definition.lifetimes.attached.call(component); return { component, definition };
}
function press(component, method, serial=component.data.serial) { component[method]({currentTarget:{dataset:{privacySerial:serial}}}); }

test('a historical September agreement requires a fresh decision without discarding account or commerce history', () => {
  const storage = new Map([
    [choiceKey, { version: 'privacy-v1.0-demo-2026-10-21', miniProgramVersion: 'miniapp-privacy-20260916-phone', choice: 'accepted', decidedAt: '2026-10-01T00:00:00Z' }],
    ['merchantkit.session', { accessToken: 'synthetic-existing-session', expiresAt: '2099-01-01T00:00:00Z' }],
    ['merchantkit.user', { id: 'synthetic-existing-member' }],
    ['synthetic.order-history', [{ orderNo: 'OLD-SYNTHETIC-ORDER' }]],
    ['synthetic.points-history', [{ id: 'old-ledger', delta: 100 }]],
  ]);
  const original = plain([...storage.entries()]), f = fixture({ storage });
  const session = f.loader.load('stores/session.js');
  f.flow.showInitialPrivacy({ path: 'pages/home/home' }); const { component } = mountSheet(f);
  assert.equal(component.data.visible, true); assert.equal(f.consent.isPrivacyAccepted(), false); assert.equal(session.hasSession(), false);
  assert.deepEqual(plain([...storage.entries()]), original); assert.equal(f.calls.length, 0);
  press(component, 'accept');
  assert.equal(component.data.visible, false); assert.equal(session.readAccessToken(), 'synthetic-existing-session');
  assert.equal(storage.get(choiceKey).miniProgramVersion, 'community-miniapp-privacy-v1');
  for (const [key, value] of original.filter(([key]) => key !== choiceKey)) assert.deepEqual(plain(storage.get(key)), value);
  assert.equal(f.calls.some(row => row.request || row.login || row.payment || row.subscribe), false);
});

test('the bundled current mini notice, saved agreement and current accepted visitor use the same published version', () => {
  const f = fixture(), config = f.loader.load('config/index.js').config;
  const documents = f.loader.load('content/documents.js').documents;
  const rendered = f.loader.load('models/document-nodes.js').documentNodes;
  assert.equal(config.miniProgramPrivacyVersion, 'community-miniapp-privacy-v1');
  assert.ok(Array.isArray(documents['miniprogram-privacy'].nodes));
  assert.match(JSON.stringify(documents['miniprogram-privacy'].nodes), /community-miniapp-privacy-v1/);
  assert.equal(typeof rendered, 'function');
  f.consent.savePrivacyChoice('accepted');
  assert.equal(f.storage.get(choiceKey).miniProgramVersion, config.miniProgramPrivacyVersion);
  assert.equal(f.flow.showInitialPrivacy({ path: 'pages/home/home' }), false);
  assert.equal(mountSheet(f).component.data.visible, false); assert.equal(f.calls.length, 0);
});

test('a 0.1.65 October agreement is refreshed for student processing without clearing the existing member session', () => {
  const storage = new Map([[choiceKey, {version:'privacy-v1.0-demo-2026-10-21',miniProgramVersion:'miniapp-privacy-20261013-contact',choice:'accepted',decidedAt:'2026-10-18T00:00:00Z'}],
    ['merchantkit.session',{accessToken:'existing-october-session',expiresAt:'2099-01-01T00:00:00Z'}],['merchantkit.user',{id:'existing-october-member'}]]);
  const f=fixture({storage});f.flow.showInitialPrivacy({path:'pages/home/home'});const {component}=mountSheet(f);assert.equal(component.data.visible,true);assert.equal(f.consent.isPrivacyAccepted(),false);
  press(component,'accept');assert.equal(f.loader.load('stores/session.js').readAccessToken(),'existing-october-session');assert.equal(storage.get(choiceKey).miniProgramVersion,'community-miniapp-privacy-v1');assert.equal(f.calls.length,0);
});

test('refusing the updated notice preserves anonymous product browsing and blocks the historical account services', async () => {
  const f = fixture();
  f.storage.set('merchantkit.session', { accessToken: 'synthetic-existing-session', expiresAt: '2099-01-01T00:00:00Z' });
  const { component } = mountSheet(f); press(component, 'decline');
  const http = f.loader.load('services/http.js');
  await http.request({ path: '/api/products' });
  assert.equal(f.calls.filter(row => row.request).length, 1);
  assert.equal(Object.keys(f.calls[0].request.header).some(key => key.toLowerCase() === 'authorization'), false);
  await assert.rejects(http.request({ path: '/api/miniprogram/member', auth: 'required' }), /PRIVACY_CONSENT_REQUIRED/);
  await assert.rejects(http.request({ path: '/api/orders', method: 'POST', auth: 'required' }), /PRIVACY_CONSENT_REQUIRED/);
  assert.equal(f.calls.filter(row => row.request).length, 1); assert.equal(f.storage.has('merchantkit.session'), true);
});

test('WeChat login and phone exchange send the same mini notice version that was read and accepted', async () => {
  const requests = [], writes = [], overrides = {};
  overrides[path.join(root, 'services/http.js')] = { request: async options => {
    requests.push(plain(options)); return { ok: true, session: { accessToken: 'synthetic-session' }, user: { id: 'synthetic-member' } };
  } };
  overrides[path.join(root, 'stores/session.js')] = { writeSession: (...args) => writes.push(args) };
  const f = fixture({ overrides, wx: { login: options => options.success({ code: 'synthetic-one-time-code' }) } });
  f.consent.savePrivacyChoice('accepted'); const auth = f.loader.load('services/auth.js');
  await auth.loginWithWeChat({ privacyConsent: true, crossBorderConsent: true });
  await auth.linkWeChatPhone('synthetic-phone-code');
  const version = f.storage.get(choiceKey).miniProgramVersion;
  assert.equal(version, 'community-miniapp-privacy-v1');
  assert.deepEqual(requests.map(item => item.path), ['/api/miniprogram/auth/wechat', '/api/miniprogram/auth/link-phone/wechat']);
  for (const item of requests) assert.equal(item.data.miniProgramPrivacyVersion, version);
  assert.equal(requests[1].retries, 0); assert.equal(writes.length, 2);
});

function miniContentPage(body, marker = 'synthetic notice') {
  return { key: 'miniprogram-privacy', name: '小程序隐私说明', version: 1, document: { sections: [{ id: 'notice', type: 'contentGrid', visible: true, sortOrder: 0, items: [{ id: 'version', title: '版本与适用范围', body }, { id: 'body', title: marker, body: '合成正文' }] }] }, assets: {} };
}
function contentFixture({ fresh, cached, bundled, pageKey = 'miniprogram-privacy' } = {}) {
  const overrides = {};
  overrides[path.join(root, 'services/content.js')] = { fetchPublishedPage: async () => { if (fresh) return fresh; throw Error('NETWORK_REQUEST_FAILED'); } };
  overrides[path.join(root, 'stores/content.js')] = { readPage: () => cached || null };
  if (bundled) overrides[path.join(root, 'content/documents.js')] = { documents: bundled };
  const f = fixture({ overrides, wx: { stopPullDownRefresh() {} } });
  f.loader.load('pages/content/index.js'); const page = f.loader.page;
  page.setData = patch => Object.assign(page.data, patch); page.onLoad({ pageKey });
  return { ...f, page };
}

test('an offline old mini notice cache cannot supersede the verified current bundled body', async () => {
  const f = contentFixture({ cached: miniContentPage('版本：miniapp-privacy-20260916-phone；更新日期：2026年9月16日。', 'OLD-CACHED-NOTICE') });
  await f.page.load();
  const nodes = JSON.stringify(f.page.data.nodes);
  assert.match(nodes, /版本：community-miniapp-privacy-v1/); assert.doesNotMatch(nodes, /OLD-CACHED-NOTICE|miniapp-privacy-20260916-phone/);
  assert.equal(f.page.data.missing, false); assert.equal(f.consent.isPrivacyAccepted(), false); assert.equal(f.storage.has(choiceKey), false);
});

test('fresh or cached mini notices require one declared current version, not a historical mention or a future version', async () => {
  for (const body of [
    '版本：miniapp-privacy-20260916-phone；历史说明提到 community-miniapp-privacy-v1。',
    '版本：miniapp-privacy-20261101-future；历史说明提到 community-miniapp-privacy-v1。',
    '版本：community-miniapp-privacy-v1\n版本：miniapp-privacy-20260916-phone',
    '历史记录提到 community-miniapp-privacy-v1，但没有当前版本声明。',
  ]) {
    const candidate = miniContentPage(body, 'MISMATCHED-NOTICE'), f = contentFixture({ fresh: candidate, cached: candidate });
    const previous = { version: 'privacy-v1.0-demo-2026-10-21', miniProgramVersion: 'miniapp-privacy-20260916-phone', choice: 'accepted', decidedAt: '2026-10-01T00:00:00Z' };
    f.storage.set(choiceKey, previous); await f.page.load();
    assert.doesNotMatch(JSON.stringify(f.page.data.nodes), /MISMATCHED-NOTICE|miniapp-privacy-20261101-future/);
    assert.match(JSON.stringify(f.page.data.nodes), /版本：community-miniapp-privacy-v1/);
    assert.deepEqual(f.storage.get(choiceKey), previous); assert.equal(f.consent.isPrivacyAccepted(), false); assert.equal(f.calls.length, 0);
  }
});

test('a current version network body and a current stale cache remain readable without changing consent', async () => {
  const current = miniContentPage('版本：community-miniapp-privacy-v1；更新日期：2026年10月13日。\n历史正文曾提及 miniapp-privacy-20260916-phone。', 'CURRENT-NOTICE');
  for (const options of [{ fresh: current }, { cached: current }]) {
    const f = contentFixture(options); await f.page.load();
    assert.match(JSON.stringify(f.page.data.nodes), /CURRENT-NOTICE/); assert.equal(f.page.data.missing, false);
    assert.equal(f.storage.has(choiceKey), false); assert.equal(f.calls.length, 0);
  }
});

test('no valid mini notice candidate clears stale rendered content and reports unavailable', async () => {
  const wrong = miniContentPage('版本：miniapp-privacy-20260916-phone', 'WRONG-NOTICE');
  const f = contentFixture({ fresh: wrong, cached: wrong, bundled: { 'miniprogram-privacy': { title: '小程序隐私说明', nodes: '<p>版本：miniapp-privacy-20260916-phone</p>' } } });
  f.page.setData({ nodes: ['PREVIOUS-NOTICE'], actions: [{ label: '旧入口' }], source: 'old', version: 1 });
  await f.page.load(); assert.equal(f.page.data.missing, true); assert.deepEqual(plain(f.page.data.nodes), []);
  assert.deepEqual(plain(f.page.data.actions), []); assert.equal(f.page.data.source, ''); assert.equal(f.storage.has(choiceKey), false);
});

test('other documents keep their existing network and stale-cache behavior without a mini notice version field', async () => {
  const other = { key: 'about', name: '品牌介绍', document: { sections: [{ id: 'about', type: 'hero', sortOrder: 0, title: 'UNCHANGED-OTHER-PAGE', body: '品牌正文' }] }, assets: {} };
  for (const options of [{ fresh: other }, { cached: other }]) {
    const f = contentFixture({ ...options, pageKey: 'about' }); await f.page.load();
    assert.match(JSON.stringify(f.page.data.nodes), /UNCHANGED-OTHER-PAGE/); assert.equal(f.page.data.missing, false);
  }
});

test('an undecided visitor has no assumed agreement; obsolete policy choices require a new decision', () => {
  const f = fixture(); assert.equal(f.consent.isPrivacyAccepted(), false); assert.equal(f.consent.hasPrivacyChoice(), false);
  f.storage.set(choiceKey, { version: 'old', choice: 'accepted', decidedAt: new Date().toISOString() }); assert.equal(f.consent.isPrivacyAccepted(), false);
  f.flow.showInitialPrivacy({ path: 'pages/home/home' }); const { component } = mountSheet(f); assert.equal(component.data.visible, true); assert.equal(f.calls.length, 0);
});

test('declining leaves public product and policy browsing available and does not reopen the initial notice on every visit', () => {
  const f = fixture(); f.consent.savePrivacyChoice('browse'); assert.equal(f.consent.isPrivacyAccepted(), false); assert.equal(f.consent.hasPrivacyChoice(), true);
  assert.equal(f.flow.showInitialPrivacy({ path: 'pages/products/index' }), false); assert.equal(f.flow.showInitialPrivacy({ path: 'pages/content/index', query: { pageKey: 'privacy-policy' } }), false);
  assert.equal(f.calls.length, 0); assert.equal(f.flow.showInitialPrivacy({ path: 'pages/member/index' }), true);
});

test('only an explicit successful versioned decision enables private services', () => {
  const f = fixture(); f.consent.savePrivacyChoice('accepted'); const value = f.storage.get(choiceKey);
  assert.equal(value.choice, 'accepted'); assert.equal(value.version, 'privacy-v1.0-demo-2026-10-21'); assert.equal(value.miniProgramVersion, 'community-miniapp-privacy-v1'); assert.equal(f.consent.isPrivacyAccepted(), true);
  const broken = fixture({ storageWriteFails: true }); assert.throws(() => broken.consent.savePrivacyChoice('accepted'), /PRIVACY_STORAGE_FAILED/); assert.equal(broken.consent.isPrivacyAccepted(), false);
  assert.doesNotThrow(() => broken.consent.savePrivacyChoice('browse')); assert.equal(broken.consent.hasPrivacyChoice(), true);
});

test('existing account credentials stay hidden until agreement and remain recoverable after acceptance', () => {
  const f = fixture(); f.storage.set('merchantkit.session', { accessToken: 'private-token', expiresAt: '2099-01-01' }); f.storage.set('merchantkit.user', { id: 'A', phone: '13900000002' });
  const session = f.loader.load('stores/session.js'); assert.equal(session.hasSession(), false); assert.equal(session.readStoredUser(), null); assert.equal(f.storage.has('merchantkit.session'), true);
  f.consent.savePrivacyChoice('accepted'); assert.equal(session.readAccessToken(), 'private-token'); assert.equal(session.readStoredUser().id, 'A');
});

test('choosing basic browsing withdraws the previous agreement even if storage cannot be updated', async () => {
  const saved = fixture(); saved.consent.savePrivacyChoice('accepted');
  const f = fixture({ storage: saved.storage, storageWriteFails: true }); assert.equal(f.consent.isPrivacyAccepted(), true);
  assert.equal(f.consent.savePrivacyChoice('browse'), false); assert.equal(f.consent.isPrivacyAccepted(), false); assert.equal(f.consent.hasPrivacyChoice(), true);
  await assert.rejects(() => f.loader.load('services/http.js').request({ path: '/api/orders', method: 'POST' }), /PRIVACY_CONSENT_REQUIRED/);
  assert.equal(f.calls.some(row => row.request), false);
});

test('public browsing requests after refusal never send a stored or caller-supplied bearer token', async () => {
  const f = fixture(); f.consent.savePrivacyChoice('browse'); f.storage.set('merchantkit.session', { accessToken: 'private-token', expiresAt: '2099-01-01' });
  const http = f.loader.load('services/http.js');
  for (const route of ['/api/products', '/api/miniprogram/pages/privacy-policy', '/api/miniprogram/layouts/home', '/api/miniprogram/newcomer', '/api/miniprogram/subscriptions']) await http.request({ path: route, headers: { Authorization: 'forged', aUtHoRiZaTiOn: 'also-forged' } });
  const requests = f.calls.filter(row => row.request); assert.equal(requests.length, 5); for (const row of requests) assert.equal(Object.keys(row.request.header).some(key => key.toLowerCase() === 'authorization'), false);
});

test('private reads, writes and login codes are blocked before any network or native login call', async () => {
  const f = fixture(); const http = f.loader.load('services/http.js');
  for (const input of [{ path: '/api/miniprogram/me', auth: 'required' }, { path: '/api/miniprogram/member' }, { path: '/api/orders', method: 'POST' }, { path: '/api/miniprogram/member-operations', method: 'POST' }]) await assert.rejects(() => http.request(input), /PRIVACY_CONSENT_REQUIRED/);
  await assert.rejects(() => f.loader.load('services/auth.js').loginWithWeChat({ privacyConsent: true, crossBorderConsent: true }), /PRIVACY_CONSENT_REQUIRED/);
  assert.equal(f.calls.some(row => row.request || row.login), false);
});

test('native upload, download, payment and subscription entry points fail closed without prior agreement', async () => {
  const f = fixture(); const avatar = f.loader.load('services/member-avatar.js'), social = f.loader.load('services/member-social.js');
  for (const operation of [() => avatar.uploadMemberAvatar('wxfile://tmp/test.jpg', 0), () => avatar.downloadMemberAvatar({ hasAvatar: true, revision: 1 }),
    () => social.uploadSocialProof('wxfile://tmp/test.jpg', 'request_123'), () => social.downloadSocialProof({}),
    () => f.loader.load('services/after-sales.js').uploadAfterSalesImage('AS123', 'wxfile://tmp/test.jpg'), () => f.loader.load('services/evidence.js').loadEvidenceImages({ imageUrls: [] }),
    () => f.loader.load('services/payments.js').payOrderWithWeChat('ORDER123'), () => f.loader.load('services/subscriptions.js').requestNativeSubscriptions(['template_valid_12345'])]) await assert.rejects(operation, /PRIVACY_CONSENT_REQUIRED/);
  assert.equal(f.calls.some(row => row.upload || row.download || row.payment || row.subscribe || row.request), false);
});

test('policy choice keeps the original invitation page and never accepts unknown callback keys or external destinations', () => {
  let resumed=0; const f = fixture({ pages: [{ route: 'pages/member-invite/index', options: { referralCode: 'FRIEND123' }, onShow() { resumed++; } }] }); f.flow.showInitialPrivacy({ path: 'pages/member-invite/index', query: { referralCode: 'FRIEND123', next: 'https://evil.invalid', token: 'secret' } });
  const { component } = mountSheet(f); press(component,'decline'); assert.equal(f.pages.at(-1).route, 'pages/member-invite/index'); assert.equal(f.calls.length, 0);
  f.flow.openPrivacyPage(); press(component,'accept'); assert.equal(resumed, 1); assert.equal(f.calls.length, 0);
  assert.equal(f.flow.safePrivacyTarget('//evil.invalid', {}), null); assert.equal(f.flow.safePrivacyTarget('pages/unknown/index', {}), null);
  assert.deepEqual(plain(f.flow.safePrivacyTarget('pages/member-invite/index', { referralCode: 'bad&code' })), { route: 'pages/member-invite/index', query: {} });
});

test('returning from a manually opened policy keeps the current login page instance and its pending destination', () => {
  const f = fixture({ pages: [{ route: 'pages/account/index' }, { route: 'pages/privacy/index' }] }); f.flow.rememberPrivacyTarget('pages/account/index', {}); f.consent.savePrivacyChoice('accepted'); f.flow.completePrivacyPage(true);
  assert.deepEqual(f.calls, [{ back: true }]);
});

test('policy return preserves supported social activity tabs and discards unrelated input', () => {
  const f = fixture();
  for (const tab of ['follow', 'share', 'history', 'interaction', 'repost']) assert.deepEqual(plain(f.flow.safePrivacyTarget('pages/member-community/index', { tab, next: 'https://evil.invalid' })), { route: 'pages/member-community/index', query: { tab } });
  assert.deepEqual(plain(f.flow.safePrivacyTarget('pages/member-community/index', { tab: 'unknown' })), { route: 'pages/member-community/index', query: {} });
});

test('official contact components refresh directly from the sheet decision without a fake page lifecycle', () => {
  for (const file of ['components/enterprise-contact/index.js', 'components/service-contact/index.js']) {
    const f = fixture({ pages: [{ route: 'pages/contact/index' }] }); const { component: modal } = mountSheet(f);
    f.loader.load(file); const definition = f.loader.component;
    const c = { properties: {}, data: plain(definition.data), ...definition.methods, setData: patch => Object.assign(c.data, patch) };
    definition.lifetimes.attached.call(c); const key = file.includes('enterprise-') ? 'configured' : 'privacyAccepted'; assert.equal(c.data[key], false);
    press(modal,'accept'); assert.equal(c.data[key], true);
    f.consent.savePrivacyChoice('browse'); f.flow.completePrivacyPage(false); assert.equal(c.data[key], false);
    if (c.acceptPrivacy) { c.acceptPrivacy(); assert.equal(modal.data.visible, true); }
    assert.equal(f.calls.some(row => row.request || row.login || row.subscribe || row.route), false);
  }
});

test('referral capture and binding wait for policy agreement without storing the code or reading account identity', async () => {
  let requests = 0; const f = fixture({ pages: [{ route: 'pages/member-invite/index', options: { referralCode: 'FRIEND123' } }], overrides: { [path.join(root, 'services/member-operations.js')]: { fetchMemberOperations: async () => { requests++; }, memberOperation: async () => { requests++; } } } });
  const referral = f.loader.load('utils/member-referral.js'); assert.equal(referral.capturePendingReferral('FRIEND123').status, 'privacy_required'); assert.equal((await referral.maybeBindPendingReferral()).status, 'privacy_required');
  assert.equal(f.storage.size, 0); assert.equal(f.reads.some(key => key === 'merchantkit.user' || key === 'merchantkit.session'), false); assert.equal(requests, 0);
  const { component } = mountSheet(f); press(component,'accept'); assert.equal(f.storage.get('merchantkit.member.referral.pending.v1').code, 'FRIEND123'); assert.equal(requests, 0); assert.equal(f.calls.length, 0);
});

test('WeChat privacy authorization is separate and resolves only from the native agreement gesture', () => {
  const f = fixture(); f.consent.savePrivacyChoice('accepted'); f.flow.installNativePrivacy(); const answers = [];
  f.native(answer => answers.push(plain(answer))); assert.equal(answers.length, 0); assert.equal(f.flow.needsNativePrivacy(), true);
  f.loader.load('pages/privacy/index.js'); const page = f.loader.page; page.setData = patch => Object.assign(page.data, patch); page.onLoad({ native: '1' }); page.onShow(); page.accept(); assert.equal(answers.length, 0);
  page.acceptNative(); assert.deepEqual(answers, [{ event: 'agree', buttonId: 'privacy-native-agree' }]); assert.equal(f.flow.needsNativePrivacy(), false);
  f.native(answer => answers.push(plain(answer))); page.decline(); assert.equal(answers.at(-1).event, 'disagree'); assert.equal(f.consent.isPrivacyAccepted(), true);
});

test('native privacy cannot silently grant the brand policy before the visitor has agreed', () => {
  const f = fixture(); f.flow.installNativePrivacy(); const answers = []; f.native(answer => answers.push(plain(answer)));
  assert.deepEqual(answers, [{ event: 'disagree' }]); assert.equal(f.consent.isPrivacyAccepted(), false);
});

test('leaving native privacy authorization resolves it as declined without accepting brand consent again', () => {
  const f = fixture(); f.consent.savePrivacyChoice('accepted'); f.flow.installNativePrivacy(); const answers = []; f.native(answer => answers.push(plain(answer)));
  f.loader.load('pages/privacy/index.js'); const page = f.loader.page; page.setData = patch => Object.assign(page.data, patch); page.onLoad({ native: '1' }); page.onUnload();
  assert.deepEqual(answers, [{ event: 'disagree' }]); assert.equal(f.flow.needsNativePrivacy(), false); assert.equal(f.consent.isPrivacyAccepted(), true);
});

test('the full packaged policy is shown without inventing a new published body version or checked consent', () => {
  const f = fixture(); f.loader.load('pages/privacy/index.js'); const page = f.loader.page;
  assert.match(page.data.policyNodes,/社区演示/);assert.match(page.data.policyNodes,/不构成实际商家/); assert.doesNotMatch(page.data.policyNodes, /版本号：V2.0|附录五/);
  const config = f.loader.load('config/index.js').config; assert.equal(config.privacyConsentVersion, 'privacy-v1.0-demo-2026-10-21'); assert.equal(config.privacyNoticeVersion, 'privacy-v1.0-demo-2026-10-21');
});

test('all actual business pages contain one unconditionally mounted sheet host, independently of their headers', () => {
  const app=JSON.parse(fs.readFileSync(path.join(root,'app.json'),'utf8')); assert.equal(app.usingComponents['privacy-sheet'],'/components/privacy-sheet/index');
  const pages=app.pages.filter(route=>route!=='pages/privacy/index'); assert.equal(pages.length,33); for(const route of ['pages/package-service/index','pages/size-guide/index','pages/care-guide/index'])assert.ok(pages.includes(route));
  for(const route of pages){const xml=fs.readFileSync(path.join(root,route+'.wxml'),'utf8');assert.equal([...xml.matchAll(/<privacy-sheet id="privacy-sheet"\s*\/>/g)].length,1,route);assert.match(xml,/<privacy-sheet id="privacy-sheet"\s*\/>\s*$/,route);}
  const xml=fs.readFileSync(path.join(root,'components/privacy-sheet/index.wxml'),'utf8');assert.match(xml,/<root-portal/);assert.doesNotMatch(xml,/rich-text|policyNodes|miniNodes/);
  const def=mountSheet(fixture()).component;assert.equal(Object.hasOwn(def.data,'policyNodes'),false);assert.equal(Object.hasOwn(def.data,'miniNodes'),false);
});

test('startup before host attachment waits for the actual current page rather than opening a blank policy page', () => {
  const f=fixture();f.flow.showInitialPrivacy({path:'pages/product-detail/index',query:{slug:'x1-air-white'}});assert.equal(f.calls.length,0);
  f.pages.push({route:'pages/product-detail/index',options:{slug:'x1-air-white'},data:{product:{slug:'x1-air-white'}}});const {component}=mountSheet(f);assert.equal(component.data.visible,true);press(component,'decline');assert.equal(f.pages[0].data.product.slug,'x1-air-white');assert.equal(f.calls.length,0);
});

test('brand acceptance refreshes the current page once without replaying onLoad, login or registration', () => {
  let shown=0,loaded=0;const f=fixture({pages:[{route:'pages/account/index',options:{},onShow(){shown++;},onLoad(){loaded++;}}]});const {component}=mountSheet(f);
  press(component,'accept');press(component,'accept');press(component,'acceptNative');assert.equal(shown,1);assert.equal(loaded,0);assert.equal(component.data.visible,false);assert.equal(f.calls.some(row=>row.request||row.login||row.route),false);
  assert.equal(f.flow.showInitialPrivacy({path:'pages/home/home'}),false);assert.equal(f.flow.openPrivacyPage(),false);
});

test('refusal closes in place and later basic browsing does not repeatedly reopen the sheet', () => {
  const f=fixture({pages:[{route:'pages/product-detail/index',options:{slug:'x1-air-white'},data:{selectedSize:'M',quantity:2}}]});const {component,definition}=mountSheet(f);press(component,'decline');definition.pageLifetimes.show.call(component);
  assert.equal(component.data.visible,false);assert.deepEqual(f.pages[0].data,{selectedSize:'M',quantity:2});assert.equal(f.calls.length,0);assert.equal(f.consent.isPrivacyAccepted(),false);
  f.flow.openPrivacyPage();assert.equal(component.data.visible,true);
});

test('reading either complete policy temporarily hides the sheet and returns to the same unresolved request', () => {
  let resumed=0;const owner={route:'pages/member-invite/index',options:{referralCode:'FRIEND123'},onShow(){resumed++;}};const f=fixture({pages:[owner]});const {component,definition}=mountSheet(f);
  f.flow.rememberPrivacyTarget(owner.route,owner.options);let captured=0;f.flow.deferPrivacyCapture('FRIEND123',()=>{captured++;});const originalSerial=component.data.serial;
  for(const [method,key] of [['openPolicy','privacy-policy'],['openMiniPolicy','miniprogram-privacy']]){
    press(component,method);assert.equal(component.data.visible,false);assert.equal(f.calls.at(-1).route,'/pages/content/index?pageKey='+key);
    definition.pageLifetimes.hide.call(component);f.pages.push({route:'pages/content/index',options:{pageKey:key},data:{pageKey:key}});const doc=mountSheet(f);assert.equal(doc.component.data.visible,false);
    doc.definition.lifetimes.detached.call(doc.component);f.pages.pop();definition.pageLifetimes.show.call(component);assert.equal(component.data.visible,true);assert.equal(component.data.serial,originalSerial);assert.equal(f.consent.hasPrivacyChoice(),false);
  }
  press(component,'accept');assert.equal(captured,1);assert.equal(resumed,1);
});

test('a hidden or destroyed old page cannot accept or open a policy on behalf of a newer page', () => {
  const a={route:'pages/home/home',options:{}},b={route:'pages/member-invite/index',options:{referralCode:'OTHER123'}};const f=fixture({pages:[a]});const old=mountSheet(f);const oldSerial=old.component.data.serial;
  old.definition.pageLifetimes.hide.call(old.component);f.pages.push(b);f.flow.showInitialPrivacy({path:b.route,query:b.options});const current=mountSheet(f);assert.equal(old.component.data.visible,false);assert.equal(current.component.data.visible,true);
  assert.equal(f.flow.decidePrivacySheet(true,oldSerial,false,old.component.privacyHost),false);assert.equal(f.flow.openPrivacyDocument('privacy-policy',oldSerial,old.component.privacyHost),false);
  old.definition.lifetimes.detached.call(old.component);assert.equal(current.component.data.visible,true);assert.equal(f.consent.isPrivacyAccepted(),false);press(current.component,'decline');assert.equal(f.calls.some(row=>row.route),false);
});

test('only the current validated invitation continuation runs after agreement, once', () => {
  const f=fixture({pages:[{route:'pages/member-invite/index',options:{referralCode:'FIRST123'}}]});const {component}=mountSheet(f);let first=0,second=0;
  f.flow.rememberPrivacyTarget('pages/member-invite/index',{referralCode:'FIRST123'});f.flow.deferPrivacyCapture('FIRST123',()=>first++);
  f.flow.rememberPrivacyTarget('pages/member-invite/index',{referralCode:'SECOND123'});f.flow.deferPrivacyCapture('SECOND123',()=>second++);assert.equal(f.flow.deferPrivacyCapture('FIRST123',()=>first++),false);
  press(component,'accept');press(component,'accept');assert.equal(first,0);assert.equal(second,1);
});

test('the native sheet requires the native event and never replays the owner page lifecycle', () => {
  let shown=0;const f=fixture({pages:[{route:'pages/account/index',options:{},onShow(){shown++;}}]});f.consent.savePrivacyChoice('accepted');const {component}=mountSheet(f);f.flow.installNativePrivacy();const answers=[];
  f.native(value=>answers.push(plain(value)));assert.equal(component.data.nativeRequired,true);assert.equal(component.data.visible,true);press(component,'accept');assert.equal(answers.length,0);
  press(component,'acceptNative');assert.deepEqual(answers,[{event:'agree',buttonId:'privacy-native-agree'}]);assert.equal(shown,0);assert.equal(f.consent.isPrivacyAccepted(),true);
  f.native(value=>answers.push(plain(value)));press(component,'decline');assert.equal(answers.at(-1).event,'disagree');assert.equal(f.consent.isPrivacyAccepted(),true);
});

test('destroying a native owner rejects pending authorization while temporary policy reading preserves it', () => {
  const owner={route:'pages/account/index',options:{}};const f=fixture({pages:[owner]});f.consent.savePrivacyChoice('accepted');const sheet=mountSheet(f);f.flow.installNativePrivacy();const answers=[];f.native(value=>answers.push(plain(value)));
  f.flow.openPrivacyDocument('privacy-policy',sheet.component.data.serial,sheet.component.privacyHost);sheet.definition.pageLifetimes.hide.call(sheet.component);f.pages.push({route:'pages/content/index',options:{pageKey:'privacy-policy'}});const doc=mountSheet(f);assert.equal(answers.length,0);assert.equal(doc.component.data.visible,false);
  sheet.definition.lifetimes.detached.call(sheet.component);assert.deepEqual(answers,[{event:'disagree'}]);assert.equal(f.flow.needsNativePrivacy(),false);
});

test('new native requests raised during a previous callback cannot inherit that agreement', () => {
  const f=fixture({pages:[{route:'pages/account/index',options:{}}]});f.consent.savePrivacyChoice('accepted');const {component}=mountSheet(f);f.flow.installNativePrivacy();const answers=[];
  f.native(value=>{answers.push({first:value.event});f.native(next=>answers.push({second:next.event}));});press(component,'acceptNative');assert.deepEqual(answers,[{first:'agree'}]);assert.equal(component.data.visible,true);assert.equal(component.data.nativeRequired,true);
  press(component,'decline');assert.deepEqual(answers,[{first:'agree'},{second:'disagree'}]);
});

test('tab bar restoration is owned only by this sheet and respects an already open share layer or timeline preview', () => {
  const calls=[];const f=fixture({pages:[{route:'pages/home/home',data:{}}],wx:{hideTabBar:()=>calls.push('hide'),showTabBar:()=>calls.push('show')}});const {component}=mountSheet(f);assert.deepEqual(calls,['hide']);press(component,'decline');assert.deepEqual(calls,['hide','show']);
  for(const page of [{route:'pages/home/home',data:{isTimelinePreview:true}},{route:'pages/products/index',data:{},selectComponent(){return {data:{open:true}};}},{route:'pages/products/index',data:{},selectComponent(){return {data:{timelineGuide:true}};}}]){const untouched=[];const current=fixture({pages:[page],wx:{hideTabBar:()=>untouched.push('hide'),showTabBar:()=>untouched.push('show')}});const sheet=mountSheet(current);press(sheet.component,'decline');assert.deepEqual(untouched,[]);}
});

test('failed consent persistence leaves the sheet open; refusal still closes safely without storage', () => {
  let shown=0;const f=fixture({storageWriteFails:true,pages:[{route:'pages/home/home',data:{},onShow(){shown++;}}]});const {component}=mountSheet(f);press(component,'accept');assert.equal(component.data.visible,true);assert.match(component.data.error,/未保存/);assert.equal(shown,0);assert.equal(f.consent.isPrivacyAccepted(),false);
  press(component,'decline');assert.equal(component.data.visible,false);assert.equal(f.consent.hasPrivacyChoice(),true);assert.equal(f.consent.isPrivacyAccepted(),false);
});

test('a delayed native or brand event cannot borrow a newer request serial from component data', () => {
  const f=fixture({pages:[{route:'pages/account/index',options:{}}]});f.consent.savePrivacyChoice('accepted');const {component}=mountSheet(f);f.flow.installNativePrivacy();const first=[],second=[];
  f.native(value=>first.push(plain(value)));const oldSerial=component.data.serial;press(component,'decline');f.native(value=>second.push(plain(value)));assert.notEqual(component.data.serial,oldSerial);
  press(component,'acceptNative',oldSerial);press(component,'decline',oldSerial);assert.deepEqual(first,[{event:'disagree'}]);assert.equal(second.length,0);assert.equal(component.data.visible,true);component.acceptNative();assert.equal(second.length,0);
  press(component,'acceptNative');assert.deepEqual(second,[{event:'agree',buttonId:'privacy-native-agree'}]);
  const brand=fixture({pages:[{route:'pages/home/home',options:{}}]});const sheet=mountSheet(brand).component;const oldBrand=sheet.data.serial;press(sheet,'decline');brand.flow.openPrivacyPage();press(sheet,'accept',oldBrand);assert.equal(brand.consent.isPrivacyAccepted(),false);assert.equal(sheet.data.visible,true);press(sheet,'accept');assert.equal(brand.consent.isPrivacyAccepted(),true);
});

test('a different nonpolicy page cannot display or resolve a hidden old page native authorization', () => {
  const a={route:'pages/account/index',options:{}},b={route:'pages/products/index',options:{}};const f=fixture({pages:[a]});f.consent.savePrivacyChoice('accepted');const old=mountSheet(f);f.flow.installNativePrivacy();const answers=[];f.native(value=>answers.push(plain(value)));const oldSerial=old.component.data.serial;
  old.definition.pageLifetimes.hide.call(old.component);f.pages.push(b);const current=mountSheet(f);assert.deepEqual(answers,[{event:'disagree'}]);assert.equal(current.component.data.visible,false);assert.equal(f.flow.needsNativePrivacy(),false);
  assert.equal(f.flow.decidePrivacySheet(true,oldSerial,true,current.component.privacyHost),false);press(old.component,'acceptNative',oldSerial);assert.equal(answers.length,1);
});

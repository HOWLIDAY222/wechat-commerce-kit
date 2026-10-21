const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createLoader, root } = require('./test-loader.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
const avatar = (patch = {}) => ({ available: true, hasAvatar: true, revision: 3, updatedAt: '2026-10-18T08:00:00.000Z', ...patch });

function transport() {
  let token = 'member-A-token', cleared = false;
  const uploads = [], downloads = [], requests = [];
  const wx = { uploadFile: options => uploads.push(options), downloadFile: options => downloads.push(options) };
  const loader = createLoader(wx, {
    [path.join(root, 'stores/session.js')]: { readAccessToken: () => token, clearSession: () => { cleared = true; token = ''; } },
    [path.join(root, 'services/http.js')]: { request: async options => { requests.push(plain(options)); return { ok: true, avatar: avatar({ hasAvatar: false, revision: 4 }) }; } },
  });
  return { service: loader.load('services/member-avatar.js'), loader, uploads, downloads, requests, setToken: value => { token = value; }, wasCleared: () => cleared };
}

function profileFixture({ upload, download, remove } = {}) {
  let logged = true, user = { id: 'member-A', name: 'A', phone: '13900000003' };
  const calls = [];
  const response = { profile: { surname: '', givenName: '', displayName: 'A', gender: null, region: [], birthday: null, registeredAt: '2026-10-01T00:00:00.000Z', updatedAt: null, revision: 2 }, accountPhone: user.phone, canEdit: true, canCompleteRegistration: true, avatar: avatar() };
  const loader = createLoader({ hideShareMenu() {}, getWindowInfo: () => ({ statusBarHeight: 20 }), canIUse: () => true }, {
    [path.join(root, 'stores/session.js')]: { hasSession: () => logged },
    [path.join(root, 'services/auth.js')]: { getCachedUser: () => user },
    [path.join(root, 'services/member-profile.js')]: { fetchMemberProfile: async () => plain(response), saveMemberProfile: async () => { calls.push({ profileSave: true }); return plain(response); }, rememberProfileAccountReturn() {} },
    [path.join(root, 'services/member-avatar.js')]: {
      downloadMemberAvatar: async value => { calls.push({ download: value.revision }); return download ? download(value) : value.hasAvatar ? 'wxfile://tmp/member-avatar.jpg' : ''; },
      uploadMemberAvatar: async (...args) => { calls.push({ upload: plain(args) }); return upload ? upload(...args) : avatar({ revision: 4 }); },
      removeMemberAvatar: async revision => { calls.push({ remove: revision }); return remove ? remove(revision) : avatar({ hasAvatar: false, revision: 4 }); },
    },
  });
  loader.load('pages/member-profile/index.js'); const page = loader.page; page.data = plain(page.data);
  page.setData = patch => { for (const [key, value] of Object.entries(patch)) { const keys = key.split('.'); let obj = page.data; while (keys.length > 1) obj = obj[keys.shift()]; obj[keys[0]] = value; } };
  page.onLoad();
  return { page, calls, response, setLogged: value => { logged = value; }, setUser: value => { user = value; } };
}
async function show(fixture) { fixture.page.onShow(); await new Promise(setImmediate); }

test('avatar upload sends a local file with bearer auth and current revision only once', async () => {
  const x = transport(); const pending = x.service.uploadMemberAvatar('wxfile://tmp/avatar.jpg', 3);
  assert.equal(x.uploads.length, 1); const request = x.uploads[0];
  assert.match(request.url, /\/api\/account\/member-profile\/avatar$/); assert.equal(request.name, 'file');
  assert.equal(request.header.Authorization, 'Bearer member-A-token'); assert.deepEqual(plain(request.formData), { expectedRevision: '3' });
  request.success({ statusCode: 200, data: JSON.stringify({ ok: true, avatar: avatar({ revision: 4 }) }) });
  assert.equal((await pending).revision, 4); assert.equal(x.uploads.length, 1);
});

test('avatar upload refuses arbitrary remote images, malformed paths and invalid revisions before transport', async () => {
  const x = transport();
  for (const [file, revision] of [['https://evil.invalid/image.jpg', 0], ['javascript:bad', 0], ['wxfile://tmp/a\n.jpg', 0], ['wxfile://tmp/a.jpg', -1], ['wxfile://tmp/a.jpg', 1.5]]) await assert.rejects(x.service.uploadMemberAvatar(file, revision), /INVALID_MEMBER_AVATAR/);
  assert.equal(x.uploads.length, 0);
});

test('late upload result cannot be assigned after bearer session changes', async () => {
  const x = transport(); const pending = x.service.uploadMemberAvatar('wxfile://tmp/a.jpg', 3); x.setToken('member-B-token');
  x.uploads[0].success({ statusCode: 200, data: JSON.stringify({ ok: true, avatar: avatar({ revision: 4 }) }) });
  await assert.rejects(pending, /SESSION_CHANGED/);
});

test('avatar download remains authenticated and displays only a native temporary path', async () => {
  const x = transport(); const pending = x.service.downloadMemberAvatar(avatar()); const request = x.downloads[0];
  assert.match(request.url, /avatar\?revision=3$/); assert.equal(request.header.Authorization, 'Bearer member-A-token');
  request.success({ statusCode: 200, tempFilePath: 'wxfile://tmp/private-avatar.jpg' }); assert.equal(await pending, 'wxfile://tmp/private-avatar.jpg');
  const invalid = x.service.downloadMemberAvatar(avatar()); x.downloads[1].success({ statusCode: 200, tempFilePath: 'https://public.invalid/avatar.jpg' }); await assert.rejects(invalid, /MEMBER_AVATAR_DOWNLOAD_FAILED/);
});

test('unauthorized upload clears the expired session and no-avatar reads make no request', async () => {
  const x = transport(); assert.equal(await x.service.downloadMemberAvatar(avatar({ hasAvatar: false })), ''); assert.equal(x.downloads.length, 0);
  const pending = x.service.uploadMemberAvatar('wxfile://tmp/a.jpg', 3); x.uploads[0].success({ statusCode: 401, data: JSON.stringify({ ok: false, error: 'AUTH_REQUIRED' }) }); await assert.rejects(pending, /AUTH_REQUIRED/); assert.equal(x.wasCleared(), true);
});

test('avatar removal uses authenticated DELETE without retries or membership mutations', async () => {
  const x = transport(); const result = await x.service.removeMemberAvatar(3);
  assert.equal(result.hasAvatar, false); assert.deepEqual(x.requests, [{ path: '/api/account/member-profile/avatar', method: 'DELETE', data: { expectedRevision: 3 }, auth: 'required', retries: 0 }]);
});

test('choose-avatar and remove actions persist separately from profile fields', async () => {
  const x = profileFixture(); await show(x); await x.page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://tmp/selected.jpg' } });
  assert.deepEqual(x.calls.find(call => call.upload).upload, ['wxfile://tmp/selected.jpg', 3]); assert.equal(x.page.data.avatar.revision, 4); assert.match(x.page.data.avatarMessage, /已保存/);
  await x.page.removeAvatar(); assert.equal(x.calls.find(call => call.remove).remove, 4); assert.equal(x.page.data.avatar.hasAvatar, false); assert.equal(x.page.data.avatarPath, '');
  assert.equal(x.calls.some(call => call.profileSave), false);
});

test('double choose is suppressed and unloaded avatar results cannot change the page', async () => {
  let finish; const x = profileFixture({ upload: () => new Promise(resolve => { finish = resolve; }) }); await show(x);
  const first = x.page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://tmp/first.jpg' } }); await x.page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://tmp/second.jpg' } });
  assert.equal(x.calls.filter(call => call.upload).length, 1); x.page.onUnload(); finish(avatar({ revision: 4 })); await first;
  assert.equal(x.page.data.avatar.revision, 3); assert.equal(x.page.data.avatarMessage, '');
});

test('conflicting avatar writes require a fresh server read before another change', async () => {
  const x = profileFixture({ upload: async () => { throw Error('MEMBER_AVATAR_REVISION_CONFLICT'); } }); await show(x);
  await x.page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://tmp/a.jpg' } }); await x.page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://tmp/b.jpg' } });
  assert.equal(x.calls.filter(call => call.upload).length, 1); assert.equal(x.page.data.avatarConflict, true);
  x.response.avatar.revision = 5; await x.page.refreshAvatar(); assert.equal(x.page.data.avatar.revision, 5); assert.equal(x.page.data.avatarConflict, false);
});

test('guest, unbound and unavailable avatar states cannot start an upload', async () => {
  for (const mode of ['guest', 'unbound', 'unavailable']) {
    const x = profileFixture(); if (mode === 'guest') x.setLogged(false); if (mode === 'unbound') x.response.canEdit = false; if (mode === 'unavailable') x.response.avatar.available = false;
    await show(x); await x.page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://tmp/a.jpg' } }); assert.equal(x.calls.some(call => call.upload), false, mode);
  }
});

test('a picker callback belonging to the previous member cannot upload into a switched account', async () => {
  const x = profileFixture(); await show(x); x.setUser({ id: 'member-B', phone: '13900000004' });
  await x.page.onChooseAvatar({ detail: { avatarUrl: 'wxfile://tmp/member-A-selection.jpg' } });
  assert.equal(x.calls.some(call => call.upload), false);
});

test('avatar controls bind real native selection and image fallback handlers', () => {
  const loader = createLoader({ canIUse: () => true }); loader.load('pages/member-profile/index.js');
  const wxml = fs.readFileSync(path.join(root, 'pages/member-profile/index.wxml'), 'utf8');
  assert.match(wxml, /open-type="chooseAvatar"/); assert.match(wxml, /bindchooseavatar="onChooseAvatar"/);
  for (const match of wxml.matchAll(/(?:bind|catch)(?::)?[\w-]+="([A-Za-z][\w]*)"/g)) assert.equal(typeof loader.page[match[1]], 'function', match[1]);
});

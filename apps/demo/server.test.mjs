import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoServer } from './server.mjs';
const server = createDemoServer();
let base;
before(async () => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${server.address().port}`; });
after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });

test('the showcase starts without a database, login, framework install or credentials', async () => {
  const response = await fetch(base);
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.match(body, /Interactive demo/); assert.match(body, /src="\.\/app.js"/);
  assert.equal(response.headers.get('set-cookie'), null);
});
test('local scripts and styles are served with appropriate content types', async () => {
  for (const [file, type] of [['/app.js', 'javascript'], ['/demo-state.mjs', 'javascript'], ['/styles.css', 'css']]) {
    const response = await fetch(base + file);
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), new RegExp(type));
    assert.ok((await response.text()).length > 100);
  }
});
test('both original product photos load as complete PNG images', async () => {
  for (const file of ['/assets/canvas-tote.png', '/assets/notebook-set.png']) {
    const response = await fetch(base + file), bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.ok(bytes.readUInt32BE(16) >= 600); assert.ok(bytes.readUInt32BE(20) >= 600);
  }
});
test('server source, environment files, database APIs and unknown paths are not public endpoints', async () => {
  for (const file of ['/.env.local', '/.git/config', '/server.mjs', '/server.test.mjs', '/api/orders', '/not-a-page']) {
    assert.equal((await fetch(base + file)).status, 404);
  }
});
test('write requests cannot create real orders or mutate server data', async () => {
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const response = await fetch(base + '/api/orders', { method });
    assert.equal(response.status, 405); assert.equal(response.headers.get('allow'), 'GET, HEAD');
  }
});
test('browser network and unsafe embedding are restricted independently of the production stack', async () => {
  const response = await fetch(base);
  const policy = response.headers.get('content-security-policy');
  assert.match(policy, /connect-src 'none'/); assert.match(policy, /form-action 'none'/); assert.match(policy, /frame-ancestors 'none'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});
test('HEAD reports the same asset length without sending an image body', async () => {
  const response = await fetch(base + '/assets/canvas-tote.png', { method: 'HEAD' });
  assert.equal(response.status, 200); assert.ok(Number(response.headers.get('content-length')) > 100000);
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});

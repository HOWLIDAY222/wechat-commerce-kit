const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createLoader, root } = require('./test-loader.cjs');

const componentPath = 'components/enterprise-contact/index';
const provider = 'wx104a1a20c3f81ec2';
const configId = 'a'.repeat(32);
const privateName = 'PRIVATE_CUSTOMER_NAME';
const privateAvatar = 'https://private.example.invalid/avatar.png';
const completionPromise = /添加成功|已添加(?:成功|好友|企微|品牌)|已成为好友|好友关系已建立|奖励已到账|积分已到账|已发放积分/;

function json(file) { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); }
function result(detail) { return createLoader().load('models/enterprise-contact.js').contactResult(detail); }
function safeResult(value, isError) {
  assert.equal(typeof value?.message, 'string');
  assert.ok(value.message.trim(), 'Every outcome needs an explanatory message.');
  assert.equal(value.isError, isError);
  assert.deepEqual(Object.keys(value).sort(), ['isError', 'message']);
  assert.doesNotMatch(value.message, completionPromise, 'A plugin response is not proof of a friend relationship or reward.');
  assert.doesNotMatch(value.message, /PRIVATE_CUSTOMER_NAME|private\.example\.invalid|<script>|PRIVATE_CALLBACK_TEXT/);
}

function mounted() {
  const externalCalls = [];
  const wx = new Proxy({}, { get(_target, name) { if (name === 'getStorageSync') return () => null; return (...args) => { externalCalls.push({ name, args }); throw Error('Unexpected wx API call: ' + String(name)); }; } });
  const loader = createLoader(wx);
  loader.load(componentPath + '.js');
  const definition = loader.component;
  assert.equal(typeof definition.lifetimes?.attached, 'function');
  assert.equal(typeof definition.lifetimes?.detached, 'function');
  const component = {
    properties: {}, data: structuredClone(definition.data), ...definition.methods,
    setData(patch) { Object.assign(this.data, patch); },
    triggerEvent(name, payload) { externalCalls.push({ name: 'triggerEvent', args: [name, payload] }); },
  };
  definition.lifetimes.attached.call(component);
  return { component, definition, externalCalls };
}

test('enterprise contact registers the official plugin while preserving the logistics plugin', () => {
  const app = JSON.parse(fs.readFileSync(path.resolve(root,'../../examples/wechat-plugins.json'),'utf8'));
  assert.deepEqual(app.plugins.contactPlugin, { provider, version: '1.4.3' });
  const logistics = app.subpackages.filter(pkg => pkg.plugins?.logisticsPlugin);
  assert.equal(logistics.length, 1);
  assert.deepEqual(logistics[0].plugins.logisticsPlugin, { version: '2.1.5', provider: 'wx9ad912bf20548d92' });
  const config = createLoader().load('config/enterprise-contact.js').enterpriseContact;
  assert.equal(config.enabled, true);
  assert.equal(config.configId, configId);
  assert.deepEqual(Object.keys(config).sort(), ['configId', 'enabled']);
});

test('account and points pages use an isolated local wrapper with the official native events', () => {
  const local = json(componentPath + '.json');
  assert.equal(local.component, true);
  assert.equal(local.usingComponents['contact-cell'], '/components/provider-placeholder/index');
  const xml = fs.readFileSync(path.join(root, componentPath + '.wxml'), 'utf8');
  assert.match(xml, /<contact-cell\b/);
  assert.match(xml, /\bplugid="\{\{\s*contactWayId\s*\}\}"/);
  assert.match(xml, /\bbind:startmessage="onContactStart"/);
  assert.match(xml, /\bbind:completemessage="onContactComplete"/);
  for (const page of ['account', 'member-earn']) {
    const config = json(`pages/${page}/index.json`);
    assert.equal(config.usingComponents['enterprise-contact'], '/components/enterprise-contact/index');
    assert.match(fs.readFileSync(path.join(root, `pages/${page}/index.wxml`), 'utf8'), /<enterprise-contact\b/);
  }
});

test('successful message and QR outcomes do not claim an accepted friend request or points', () => {
  for (const detail of [
    { errcode: 0, notifytype: 0 },
    { errcode: 0, notifytype: 1 },
    { errcode: 0, name: privateName, headurl: privateAvatar, errMsg: 'PRIVATE_CALLBACK_TEXT' },
  ]) safeResult(result(detail), false);
});

test('known plugin failures remain explanatory errors without claiming completed contact or rewards', () => {
  const messages = [];
  for (const errcode of [-3002, -3004, -3005, -3008]) {
    const value = result({ errcode, name: privateName, headurl: privateAvatar, errmsg: 'PRIVATE_CALLBACK_TEXT' });
    safeResult(value, true);
    messages.push(value.message);
  }
  assert.ok(new Set(messages).size > 1, 'Configuration and user-action failures should not all become an unexplained generic result.');
});

test('ambiguous -3006 contact-card outcome stays neutral and cannot prove an accepted friendship', () => {
  for (const notifytype of [0, 1]) safeResult(result({ errcode: -3006, notifytype, name: privateName, headurl: privateAvatar }), false);
});

test('missing and untrusted callback data cannot manufacture a successful outcome or leak a payload', () => {
  for (const detail of [undefined, null, {}, [], '<script>PRIVATE_CALLBACK_TEXT</script>', 0,
    { errcode: 999999, name: privateName, headurl: privateAvatar, message: 'PRIVATE_CALLBACK_TEXT' },
    { notifytype: 1, name: privateName, headurl: privateAvatar },
    { errcode: '<script>PRIVATE_CALLBACK_TEXT</script>', notifytype: 1 },
  ]) safeResult(result(detail), true);
});

test('plugin callbacks only update local status and never call wx, notify parents, or retain identity fields', () => {
  for (const detail of [
    { errcode: 0, notifytype: 0 }, { errcode: 0, notifytype: 1 },
    ...[-3002, -3004, -3005, -3006, -3008].map(errcode => ({ errcode })),
    undefined, null, {}, { errcode: '<script>PRIVATE_CALLBACK_TEXT</script>' },
  ]) {
    const { component, externalCalls } = mounted();
    assert.equal(component.data.configured, true);
    assert.equal(component.data.contactWayId, configId);
    assert.doesNotThrow(() => component.onContactStart());
    const incoming = detail && typeof detail === 'object' ? { ...detail, name: privateName, headurl: privateAvatar } : detail;
    assert.doesNotThrow(() => component.onContactComplete({ detail: incoming }));
    const expected = result(incoming);
    assert.equal(component.data.statusMessage, expected.message);
    assert.equal(component.data.statusError, expected.isError);
    assert.deepEqual(externalCalls, []);
    assert.doesNotMatch(JSON.stringify(component.data), /PRIVATE_CUSTOMER_NAME|private\.example\.invalid|PRIVATE_CALLBACK_TEXT/);
    for (const key of ['points', 'pointsBalance', 'taskCompleted', 'friendAdded', 'name', 'headurl']) assert.equal(Object.hasOwn(component.data, key), false);
  }
});

test('unmounted contact components ignore late completion and start callbacks', () => {
  const { component, definition, externalCalls } = mounted();
  component.onContactComplete({ detail: { errcode: -3002 } });
  definition.lifetimes.detached.call(component);
  const previous = structuredClone(component.data);
  component.onContactComplete({ detail: { errcode: 0, name: privateName, headurl: privateAvatar } });
  component.onContactStart();
  assert.deepEqual(component.data, previous);
  assert.deepEqual(externalCalls, []);
});

test('the wrapper has no commerce mutation, persistence, personal-data logging, or service dependency', () => {
  const source = fs.readFileSync(path.join(root, componentPath + '.js'), 'utf8');
  assert.doesNotMatch(source, /(?:from\s*|require\s*\()\s*['"][^'"]*services\//);
  assert.doesNotMatch(source, /\b(?:memberOperation|performOperation|submitContact|claimProfile)\s*\(/);
  assert.doesNotMatch(source, /\b(?:console|wx)\s*\.|\btriggerEvent\s*\(|\b(?:fetch|setStorageSync|setStorage)\s*\(/);
});

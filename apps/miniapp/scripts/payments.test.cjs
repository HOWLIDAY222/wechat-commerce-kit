const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createLoader, root } = require('./test-loader.cjs');

const validParams = { timeStamp: '1789530000', nonceStr: 'test-nonce', package: 'prepay_id=test-only', signType: 'RSA', paySign: 'test-signature' };
function fixture({ enabled = true, provider = 'wechat', params = validParams, paid = false, cashier = 'success', queryError = false } = {}) {
  const calls = [];
  const cashierCalls = [];
  const request = async (options) => {
    calls.push(options);
    if (options.path.endsWith('/create')) return { ok: true, paymentParams: params };
    if (queryError) throw new Error('NETWORK_REQUEST_FAILED');
    return { ok: true, paid };
  };
  const loader = createLoader({ requestPayment: (options) => {
    cashierCalls.push(options);
    if (cashier === 'success') options.success({});
    else options.fail({ errMsg: cashier === 'cancel' ? 'requestPayment:fail cancel' : 'requestPayment:fail' });
  } }, {
    [path.join(root, 'config/index.js')]: { config: { paymentEnabled: enabled, paymentProvider: provider, checkoutEnabled: true } },
    [path.join(root, 'services/http.js')]: { request },
  });
  return { loader, payments: loader.load('services/payments'), calls, cashierCalls };
}

test('disabled payments never create a payment or open the cashier', async () => {
  const f = fixture({ enabled: false });
  await assert.rejects(f.payments.payOrderWithWeChat('order-test'), /PAYMENT_NOT_READY/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.cashierCalls.length, 0);
});
test('a non-WeChat provider cannot be used in the mini-program', async () => {
  const f = fixture({ provider: 'alipay' });
  await assert.rejects(f.payments.payOrderWithWeChat('order-test'), /PAYMENT_NOT_READY/);
  assert.equal(f.calls.length, 0);
});
test('checkout cannot create an unpaid order while payment is unavailable', async () => {
  const f = fixture({ enabled: false });
  await assert.rejects(f.loader.load('services/orders').createOrder('address-test'), /PAYMENT_NOT_READY/);
  assert.equal(f.calls.length, 0);
});
test('concurrent taps share one payment and one cashier', async () => {
  const f = fixture({ paid: true });
  const first = f.payments.payOrderWithWeChat('order-test');
  const second = f.payments.payOrderWithWeChat('order-test');
  assert.equal(first, second);
  assert.equal((await first).paid, true);
  assert.equal(f.cashierCalls.length, 1);
  assert.equal(f.calls.filter(c => c.path.endsWith('/create')).length, 1);
  assert.equal(f.calls.filter(c => c.path.endsWith('/query')).length, 1);
  assert.ok(f.calls.every(c => c.auth === 'required' && c.method === 'POST' && c.data.orderNo === 'order-test'));
});
test('cashier success alone never marks the order paid', async () => {
  const f = fixture();
  const result = await f.payments.payOrderWithWeChat('order-test');
  assert.equal(result.clientResult, 'success');
  assert.equal(result.paid, false);
});
for (const cashier of ['cancel', 'fail']) test(`cashier ${cashier} still queries the actual server result`, async () => {
  const f = fixture({ cashier, paid: true });
  assert.equal((await f.payments.payOrderWithWeChat('order-test')).paid, true);
  assert.equal(f.calls.length, 2);
});
test('a lost result query is reported as unconfirmed, never as unpaid', async () => {
  const f = fixture({ queryError: true });
  await assert.rejects(f.payments.payOrderWithWeChat('order-test'), /PAYMENT_RESULT_UNCONFIRMED/);
  assert.equal(f.cashierCalls.length, 1);
  assert.equal(f.calls.length, 2);
});
test('truthy strings cannot be interpreted as confirmed payment', async () => {
  const f = fixture({ paid: 'false' });
  await assert.rejects(f.payments.queryWeChatPayment('order-test'), /INVALID_WECHAT_PAY_QUERY_RESPONSE/);
});
for (const params of [null, { ...validParams, signType: 'MD5' }, { ...validParams, package: 'arbitrary' }, { ...validParams, paySign: '' }]) {
  test(`invalid payment parameters rejected: ${JSON.stringify(params)}`, async () => {
    const f = fixture({ params });
    await assert.rejects(f.payments.payOrderWithWeChat('order-test'), /INVALID_WECHAT_PAY_RESPONSE/);
    assert.equal(f.cashierCalls.length, 0);
  });
}
test('closed, refunded and unknown orders cannot display a pay action', () => {
  const { normalizeOrder } = createLoader().load('models/order');
  for (const [status, paymentStatus] of [['CLOSED', 'NOT_STARTED'], ['CANCELLED', 'PENDING'], ['CONFIRMED', 'PARTIALLY_REFUNDED'], ['CONFIRMED', 'REFUNDED'], ['CREATED', 'UNKNOWN']]) {
    assert.equal(normalizeOrder({ status, paymentStatus }).canPay, false, `${status}/${paymentStatus}`);
  }
  assert.equal(normalizeOrder({ status: 'CREATED', paymentStatus: 'NOT_STARTED' }).canPay, true);
});

import { request } from './http';
import { config } from '../config/index';
import { isPrivacyAccepted } from '../stores/privacy-consent';

const activePayments = new Map();

export function payOrderWithWeChat(orderNo) {
  if (!isPrivacyAccepted()) return Promise.reject(new Error('PRIVACY_CONSENT_REQUIRED'));
  if (!config.paymentEnabled || config.paymentProvider !== 'wechat') {
    return Promise.reject(new Error('PAYMENT_NOT_READY'));
  }
  if (typeof orderNo !== 'string' || !orderNo.trim()) {
    return Promise.reject(new Error('ORDER_NUMBER_REQUIRED'));
  }
  if (activePayments.has(orderNo)) return activePayments.get(orderNo);
  const payment = executePayment(orderNo).finally(() => activePayments.delete(orderNo));
  activePayments.set(orderNo, payment);
  return payment;
}

async function executePayment(orderNo) {
  const prepared = await request({
    path: '/api/miniprogram/payments/wechat/create',
    method: 'POST',
    data: { orderNo },
    auth: 'required',
  });
  if (!prepared?.ok) throw new Error('INVALID_WECHAT_PAY_RESPONSE');
  const paymentParams = validatePaymentParams(prepared.paymentParams);

  let clientResult = 'success';
  try {
    await requestPayment(paymentParams);
  } catch (error) {
    clientResult = String(error?.message || '').includes('cancel') ? 'cancelled' : 'failed';
  }

  await wait(800);
  try {
    const query = await queryWeChatPayment(orderNo);
    return { ...query, clientResult };
  } catch {
    // The cashier may have charged successfully even if our result query failed.
    throw new Error('PAYMENT_RESULT_UNCONFIRMED');
  }
}

export async function queryWeChatPayment(orderNo) {
  const response = await request({
    path: '/api/miniprogram/payments/wechat/query',
    method: 'POST',
    data: { orderNo },
    auth: 'required',
  });
  if (!response?.ok || typeof response.paid !== 'boolean') throw new Error('INVALID_WECHAT_PAY_QUERY_RESPONSE');
  return response;
}

function validatePaymentParams(params) {
  if (!params || typeof params.timeStamp !== 'string' || !/^\d+$/.test(params.timeStamp)
    || typeof params.nonceStr !== 'string' || !params.nonceStr || params.nonceStr.length > 32
    || typeof params.package !== 'string' || !/^prepay_id=\S+$/.test(params.package)
    || params.signType !== 'RSA' || typeof params.paySign !== 'string' || !params.paySign.trim()) {
    throw new Error('INVALID_WECHAT_PAY_RESPONSE');
  }
  return {
    timeStamp: params.timeStamp,
    nonceStr: params.nonceStr,
    package: params.package,
    signType: 'RSA',
    paySign: params.paySign,
  };
}

function requestPayment(paymentParams) {
  return new Promise((resolve, reject) => {
    wx.requestPayment({
      ...paymentParams,
      success: resolve,
      fail(error) {
        reject(new Error(error?.errMsg || 'WECHAT_PAYMENT_FAILED'));
      },
    });
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

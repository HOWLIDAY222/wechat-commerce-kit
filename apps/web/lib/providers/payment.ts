import { randomUUID } from "crypto";
import { appConfig } from "@/lib/config";
import {
  assertAlipayH5PaymentRequestShape,
  buildAlipayH5PaymentRequest,
} from "@/lib/providers/alipay";

export type PaymentCreateInput = {
  orderNo: string;
  amountCents: number;
  currency: "CNY";
};

export type PaymentCreateResult = {
  provider: "mock" | "alipay";
  paymentId: string;
  status: "requires_redirect" | "paid";
  redirectUrl: string;
  notifyIdentity: MockPaymentIdentity;
};

export type MockPaymentIdentity = {
  appId: string;
  sellerId: string;
  merchantId: string;
  merchantOrderNo: string;
};

export type MockNotifyPayload = MockPaymentIdentity & {
  paymentId?: string;
  orderNo?: string;
  amountCents?: number;
};

export async function createPayment(input: PaymentCreateInput): Promise<PaymentCreateResult> {
  if (input.amountCents <= 0) throw new Error("支付金额无效。");

  if (appConfig.PAYMENT_PROVIDER === "alipay") {
    const request = buildAlipayH5PaymentRequest({
      orderNo: input.orderNo,
      amountCents: input.amountCents,
      subject: `MerchantKit order ${input.orderNo}`,
    });
    assertAlipayH5PaymentRequestShape(request);
    return {
      provider: "alipay",
      paymentId: input.orderNo,
      status: "requires_redirect",
      redirectUrl: request.signedUrl,
      notifyIdentity: {
        appId: "",
        sellerId: "",
        merchantId: "",
        merchantOrderNo: input.orderNo,
      },
    };
  }

  const paymentId = `mock_${randomUUID()}`;
  return {
    provider: "mock",
    paymentId,
    status: "requires_redirect",
    redirectUrl: `/api/payments/mock/success?paymentId=${encodeURIComponent(paymentId)}&orderNo=${encodeURIComponent(input.orderNo)}`,
    notifyIdentity: getMockPaymentIdentity(input.orderNo),
  };
}

export function getMockPaymentIdentity(orderNo: string): MockPaymentIdentity {
  return {
    appId: appConfig.MOCK_PAYMENT_APP_ID,
    sellerId: appConfig.MOCK_PAYMENT_SELLER_ID,
    merchantId: appConfig.MOCK_PAYMENT_MERCHANT_ID,
    merchantOrderNo: orderNo,
  };
}

export function verifyMockNotify(payload: Partial<MockNotifyPayload>) {
  return Boolean(
    payload.paymentId &&
      payload.orderNo &&
      Number(payload.amountCents) > 0 &&
      payload.appId === appConfig.MOCK_PAYMENT_APP_ID &&
      payload.sellerId === appConfig.MOCK_PAYMENT_SELLER_ID &&
      payload.merchantId === appConfig.MOCK_PAYMENT_MERCHANT_ID &&
      payload.merchantOrderNo === payload.orderNo,
  );
}

export function assertMockNotifyIdentity(payload: Partial<MockNotifyPayload>) {
  if (!payload.paymentId || !payload.orderNo || Number(payload.amountCents) <= 0) {
    throw new Error("INVALID_MOCK_PAYMENT_NOTIFY");
  }
  if (payload.appId !== appConfig.MOCK_PAYMENT_APP_ID) throw new Error("PAYMENT_APP_ID_MISMATCH");
  if (payload.sellerId !== appConfig.MOCK_PAYMENT_SELLER_ID) throw new Error("PAYMENT_SELLER_ID_MISMATCH");
  if (payload.merchantId !== appConfig.MOCK_PAYMENT_MERCHANT_ID) throw new Error("PAYMENT_MERCHANT_ID_MISMATCH");
  if (payload.merchantOrderNo !== payload.orderNo) throw new Error("PAYMENT_MERCHANT_ORDER_MISMATCH");
}

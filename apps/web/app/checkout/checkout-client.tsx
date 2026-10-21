"use client";

import Image from "next/image";
import Link from "next/link";
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { CreditCard, LockKeyhole, MapPin, Truck } from "lucide-react";
import { formatMoney } from "@/components/storefront/storefront-ui";
import { persistCartCookie } from "@/lib/client/cart-cookie";
import { trackStorefrontEvent } from "@/lib/client/analytics-events";
import { getConsumerErrorMessage } from "@/lib/client/consumer-error-message";
import { calculateShippingQuote, describeShippingRates, MAINLAND_PROVINCES, normalizeMainlandProvince, type ShippingRateConfig } from "@/lib/commerce/shipping-rates";

type CartItem = {
  id: string;
  productImage?: string;
  productName: string;
  color: string;
  size: string;
  quantity: number;
  unitPriceCents: number;
};

type CartSummary = {
  items: CartItem[];
  itemCount: number;
  key?: string;
  discountCents: number;
  payableAmountCents: number;
  subtotalCents: number;
};

type OrderResult = {
  orderNo: string;
  paymentStatus: string;
  payableAmountCents: number;
};

type PaymentResult = {
  provider: "mock" | "alipay";
  paymentId: string;
  redirectUrl: string;
  notifyIdentity: {
    appId: string;
    sellerId: string;
    merchantId: string;
    merchantOrderNo: string;
  };
};

type StatusTone = "idle" | "success" | "error";
type SavedAddress = { id: string; name: string; phone: string; province: string; city: string; district?: string | null; detail: string; isDefault: boolean };
type PendingPayment = {
  amountCents: number;
  orderNo: string;
  payment: PaymentResult;
};

export function CheckoutClient({ initialCart, shippingRateConfig, paymentProvider, savedAddresses = [] }: { initialCart: CartSummary; shippingRateConfig: ShippingRateConfig; paymentProvider: "mock" | "alipay"; savedAddresses?: SavedAddress[] }) {
  const initialAddress = savedAddresses.find((address) => address.isDefault);
  const [selectedAddressId, setSelectedAddressId] = useState(initialAddress?.id ?? "");
  const [recipientName, setRecipientName] = useState(initialAddress?.name ?? "");
  const [recipientPhone, setRecipientPhone] = useState(initialAddress?.phone ?? "");
  const [recipientStreet, setRecipientStreet] = useState(initialAddress ? `${initialAddress.city}${initialAddress.district ?? ""}${initialAddress.detail}` : "");
  const requestLock = useRef(false);
  const [uncertainOrder, setUncertainOrder] = useState(false);
  const [cart, setCart] = useState<CartSummary>(initialCart);
  const [message, setMessage] = useState(initialCart.itemCount > 0 ? "确认信息后提交订单。" : "购物袋为空，请先选择商品。");
  const [tone, setTone] = useState<StatusTone>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [order, setOrder] = useState<OrderResult | null>(null);
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  const [shippingProvince, setShippingProvince] = useState(addressProvince(initialAddress));
  const [quoteState, setQuote] = useState<{key:string;province:string;subtotalCents:number;discountCents:number;discountLabel:string|null;payableAmountCents:number}|null>(null);
  const [quoteFailure,setQuoteError]=useState<{key:string;message:string}|null>(null);
  const [quoteRevision,setQuoteRevision]=useState(0);
  const quoteKey=JSON.stringify([shippingProvince,cart,quoteRevision]);
  const quote=quoteState?.key===quoteKey?quoteState:null;
  const quoteError=quoteFailure?.key===quoteKey?quoteFailure.message:"";
  useEffect(()=>{const controller=new AbortController();if(!shippingProvince || order || !cart.itemCount)return ()=>controller.abort();
    fetch("/api/orders/quote?useCoupons=1&province="+encodeURIComponent(shippingProvince),{cache:"no-store",signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||"报价失败");if(!controller.signal.aborted)setQuote({...data.quote,province:shippingProvince,key:quoteKey});}).catch(error=>{if(!controller.signal.aborted)setQuoteError({key:quoteKey,message:getConsumerErrorMessage(error.message,"优惠与运费读取失败，请重试。")});});return ()=>controller.abort();
  },[shippingProvince,cart.itemCount,order,quoteKey]);
  const shippingQuote = shippingProvince ? calculateShippingQuote(shippingProvince, shippingRateConfig) : null;
  const shippingFeeCents = shippingQuote?.feeCents ?? 0;
  const payableCents = quote?.province === shippingProvince ? quote.payableAmountCents : cart.subtotalCents - cart.discountCents + shippingFeeCents;
  function chooseAddress(id: string) {
    const address = savedAddresses.find((item) => item.id === id);
    setSelectedAddressId(id);
    setRecipientName(address?.name ?? "");
    setRecipientPhone(address?.phone ?? "");
    setShippingProvince(addressProvince(address));
    setRecipientStreet(address ? `${address.city}${address.district ?? ""}${address.detail}` : "");
  }

  async function loadCart(options?: { preserveMessage?: boolean }) {
    try {
    const response = await fetch("/api/cart", { cache: "no-store", credentials: "same-origin" });
    const result = (await response.json().catch(() => ({}))) as { ok?: boolean; cart?: CartSummary; error?: string };
    if (!response.ok || !result.ok || !result.cart) {
      setTone("error");
      setMessage(getConsumerErrorMessage(result.error, "购物袋读取失败，请稍后重试。"));
      return;
    }
    persistCartCookie(result.cart.key);
    setCart(result.cart);
    if (!options?.preserveMessage) {
      setMessage(result.cart.itemCount > 0 ? "确认信息后提交订单。" : "购物袋为空，请先选择商品。");
    }
    } catch {
      setTone("error"); setMessage("暂时无法读取购物袋，请检查连接后重试。");
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCart();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function submitCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestLock.current || order || uncertainOrder || !quote || quote.province !== shippingProvince) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const checkoutAction = submitter?.value === "pay_later" ? "pay_later" : "pay_now";
    const form = new FormData(event.currentTarget);
    const customerName = String(form.get("customerName") ?? "").trim();
    const customerPhone = String(form.get("customerPhone") ?? "").trim();
    const selectedProvince = String(form.get("shippingProvince") ?? "").trim();
    const addressSnapshot = String(form.get("addressSnapshot") ?? "").trim();

    if (!customerName || !customerPhone || !selectedProvince || !addressSnapshot) {
      setTone("error");
      setMessage("请完整填写收货人、联系电话和收货地址。");
      return;
    }

    requestLock.current = true;
    setSubmitting(true);
    setPendingPayment(null);
    setTone("idle");
    setMessage("正在创建订单...");

    let createdOrder: OrderResult | null = null;
    try {
    const orderResponse = await fetch("/api/orders", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerName, customerPhone, shippingProvince: selectedProvince, addressSnapshot, useCoupons:true,expectedPayableCents:quote.payableAmountCents }),
    });
    const orderResult = (await orderResponse.json().catch(() => ({}))) as {
      ok?: boolean;
      order?: OrderResult;
      error?: string;
    };
    if (!orderResponse.ok || !orderResult.ok || !orderResult.order) {
      setSubmitting(false);
      setTone("error");
      setMessage(getConsumerErrorMessage(orderResult.error, "订单创建失败，请稍后重试。"));
      setQuoteRevision(v=>v+1);
      return;
    }
    createdOrder = orderResult.order;
    setOrder(createdOrder);
    trackStorefrontEvent("order_created", { itemCount: cart.itemCount, payNow: checkoutAction === "pay_now" });

    if (checkoutAction === "pay_later") {
      setSubmitting(false);
      setOrder(orderResult.order);
      setTone("success");
      setMessage(`订单 ${orderResult.order.orderNo} 已创建，可在订单中心继续支付。`);
      await loadCart({ preserveMessage: true });
      return;
    }

    setMessage("正在创建支付...");
    const paymentResponse = await fetch("/api/payments/create", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orderNo: orderResult.order.orderNo,
        amountCents: orderResult.order.payableAmountCents,
        currency: "CNY",
      }),
    });
    const paymentResult = (await paymentResponse.json().catch(() => ({}))) as {
      ok?: boolean;
      payment?: PaymentResult;
      error?: string;
    };
    if (!paymentResponse.ok || !paymentResult.ok || !paymentResult.payment) {
      setSubmitting(false);
      setTone("error");
      setMessage(getConsumerErrorMessage(paymentResult.error, "当前无法发起支付，请稍后重试。"));
      return;
    }
    trackStorefrontEvent("payment_attempt", { provider: paymentResult.payment.provider });

    if (paymentResult.payment.provider === "alipay") {
      setMessage("正在跳转支付宝 H5...");
      window.location.href = paymentResult.payment.redirectUrl;
      return;
    }

    setMessage("正在处理支付通知...");
    const notifyResponse = await fetch("/api/payments/mock/notify", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paymentId: paymentResult.payment.paymentId,
        orderNo: orderResult.order.orderNo,
        amountCents: orderResult.order.payableAmountCents,
        ...paymentResult.payment.notifyIdentity,
      }),
    });
    const notifyResult = (await notifyResponse.json().catch(() => ({}))) as {
      ok?: boolean;
      order?: OrderResult;
      error?: string;
    };
    setSubmitting(false);
    if (!notifyResponse.ok || !notifyResult.ok || !notifyResult.order) {
      setTone("error");
      setMessage(getConsumerErrorMessage(notifyResult.error, "支付结果暂未确认，请前往订单中心查看。"));
      return;
    }

    setOrder(notifyResult.order);
    trackStorefrontEvent("payment_success", { provider: "mock" });
    setTone("success");
    setMessage(`订单 ${notifyResult.order.orderNo} 已支付。`);
    await loadCart({ preserveMessage: true });
    } catch {
      setTone("error");
      if (!createdOrder) setUncertainOrder(true);
      setMessage(createdOrder ? "订单已创建，付款结果尚未确认。请在订单详情中继续处理。" : "连接中断，订单结果尚未确认。请先到我的订单检查，避免重复提交。");
    } finally {
      requestLock.current = false;
      setSubmitting(false);
    }
  }

  if (order && !submitting) {
    const paid = order.paymentStatus.toUpperCase() === "PAID";
    return <section className="border-y border-line py-12">
      <h2 className="text-3xl">{paid ? "支付完成" : "订单已创建"}</h2>
      <p className="mt-5 text-sm text-muted">订单 {order.orderNo}</p>
      <p className="mt-4 text-2xl">{paid ? "实付" : "待付"} {formatMoney(order.payableAmountCents)}</p>
      <p className="mt-5 max-w-xl text-sm leading-7 text-muted" role="status">{paid ? (paymentProvider === "mock" ? "本地模拟付款已完成，未发生实际扣款。" : "付款已确认，可在订单详情查看后续配送进度。") : message}</p>
      <div className="mt-8 flex flex-wrap gap-4"><Link className="vk-button vk-button-dark" href={`/account/orders/${encodeURIComponent(order.orderNo)}`}>查看订单</Link><Link className="vk-button vk-button-light" href="/products/x1-air-white">继续选购</Link></div>
    </section>;
  }

  return (
    <div className="checkout-layout grid border-y border-black/15 lg:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.85fr)]">
      <form id="checkout-details" className="checkout-fields min-w-0 lg:pr-12" onSubmit={submitCheckout}>
        <CheckoutSection icon={<MapPin className="h-5 w-5" />} title="收货信息">
          {savedAddresses.length > 0 ? <label className="vk-field mt-5">使用已保存的地址<select value={selectedAddressId} onChange={(event) => chooseAddress(event.target.value)}><option value="">填写新地址</option>{savedAddresses.map((address) => <option key={address.id} value={address.id}>{address.name} · {address.province}{address.city} {address.isDefault ? "（默认）" : ""}</option>)}</select></label> : null}
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <label className="vk-field">
              收货人
              <input autoComplete="shipping name" name="customerName" placeholder="姓名" value={recipientName} onChange={(event) => setRecipientName(event.target.value)} required />
            </label>
            <label className="vk-field">
              联系电话
              <input autoComplete="shipping tel" type="tel" inputMode="tel" name="customerPhone" placeholder="中国大陆手机号" value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} required />
            </label>
          </div>
          <label className="vk-field mt-4">
            省 / 自治区 / 直辖市
            <select className="vk-store-input" name="shippingProvince" onChange={(event) => setShippingProvince(event.target.value)} required value={shippingProvince}>
              <option value="">请选择配送省区</option>
              {MAINLAND_PROVINCES.map((province) => <option key={province} value={province}>{province}</option>)}
            </select>
          </label>
          <label className="vk-field mt-4">
            市 / 区县 / 详细地址
            <textarea autoComplete="shipping street-address" name="addressSnapshot" placeholder="请填写城市、区县、街道及门牌号" value={recipientStreet} onChange={(event) => setRecipientStreet(event.target.value)} required />
          </label>
        </CheckoutSection>

        <CheckoutSection icon={<Truck className="h-5 w-5" />} title="配送方式">
          <div className="mt-5 grid gap-3">
            <label className="flex min-h-16 items-center justify-between border border-black bg-white px-4 text-sm font-semibold">
              <span>
                <input className="mr-3" defaultChecked name="shipping" type="radio" />
                标准配送
                <span className="mt-1 block pl-7 text-xs font-normal text-black/55">{describeShippingRates(shippingRateConfig)}</span>
              </span>
              <strong>{shippingQuote ? formatMoney(shippingFeeCents) : "选择省区后确认"}</strong>
            </label>
          </div>
        </CheckoutSection>

        <CheckoutSection icon={<CreditCard className="h-5 w-5" />} title="支付方式">
          <p className="mt-5 border-y border-line py-5 text-sm">{paymentProvider === "mock" ? "本地测试支付 · 不会扣款" : "支付宝"}</p>
          <p className="mt-4 flex items-center gap-2 text-xs text-black/55">
            <LockKeyhole className="h-4 w-4" />
            支付信息仅用于完成本次交易。
          </p>
        </CheckoutSection>

        <p className="py-5 text-sm text-muted">如需开票或有订单问题，请<Link className="underline underline-offset-4" href="/contact">联系我们</Link>。</p>

      </form>
        <div className="checkout-actions py-8 lg:pr-12">
          <p className={statusClass(tone)} role="status">{message}</p>
          <div className="mt-5 flex flex-wrap gap-3">
            {message.includes("请先登录") ? <Link className="vk-button vk-button-light w-max" href="/auth/login">去登录</Link> : null}
            {uncertainOrder ? <Link className="vk-button vk-button-dark" href="/account/orders">检查我的订单</Link> : null}
            {order ? <Link className="vk-button vk-button-light w-max" href={`/account/orders/${encodeURIComponent(order.orderNo)}`}>查看订单</Link> : null}
            {pendingPayment ? <Link className="vk-button vk-button-dark w-max" href={buildPendingPaymentUrl(pendingPayment)}>继续处理付款</Link> : null}
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            <button className="vk-button vk-button-dark h-14 min-w-[190px] text-base" disabled={!quote || quote.province !== shippingProvince || submitting || cart.itemCount === 0 || Boolean(order) || uncertainOrder} form="checkout-details" name="checkoutAction" type="submit" value="pay_now">
              {submitting ? "处理中..." : `确认并支付 ${formatMoney(payableCents)}`}
            </button>
            <button className="vk-button vk-button-light h-14 min-w-[170px]" disabled={!quote || quote.province !== shippingProvince || submitting || cart.itemCount === 0 || Boolean(order) || uncertainOrder} form="checkout-details" name="checkoutAction" type="submit" value="pay_later">
              稍后支付
            </button>
          </div>
        </div>

      <aside className="h-fit border-t border-black/15 py-8 lg:sticky lg:top-20 lg:border-l lg:border-t-0 lg:py-10 lg:pl-10">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold">订单摘要 <span className="font-normal text-black/45">({cart.itemCount})</span></h2>
          <Link className="text-sm font-semibold underline underline-offset-4" href="/bag">编辑</Link>
        </div>
        <div className="mt-5 grid gap-4">
          {cart.items.map((item) => (
            <div className="grid grid-cols-[88px_minmax(0,1fr)_auto] gap-3 border-b border-line pb-4" key={item.id}>
              <div className="relative aspect-[4/5] overflow-hidden bg-[#f2f0ee]">
                <Image src={item.productImage || "/assets/brand/product-placeholder.webp"} alt={item.productName} fill sizes="88px" className="object-cover" />
              </div>
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-semibold">{item.productName}</p>
                <p className="mt-1 text-xs text-black/55">{item.color} / {item.size}</p>
                <p className="mt-2 text-sm font-semibold">{formatMoney(item.unitPriceCents)}</p>
              </div>
              <span className="text-sm text-black/55">×{item.quantity}</span>
            </div>
          ))}
          {cart.items.length === 0 ? <p className="border-b border-black/10 py-6 text-sm text-black/55">购物袋为空。</p> : null}
        </div>
        <div className="mt-5 grid gap-4 text-sm">
          <Row label="商品金额" value={formatMoney(cart.subtotalCents)} />
          {(quote?.discountCents ?? cart.discountCents)>0 ? <Row label={quote?.discountLabel || "组合优惠"} value={"-"+formatMoney(quote?.discountCents ?? cart.discountCents)} /> : null}
          <p className="my-3 text-xs leading-6">优惠券与组合优惠自动择优。<Link href="/account/membership" className="underline">查看会员卡包</Link></p>{quoteError && <p role="alert">{quoteError}<button type="button" className="underline ml-2" onClick={()=>setQuoteRevision(v=>v+1)}>重新报价</button></p>}
          <Row label="配送费用" value={shippingQuote ? formatMoney(shippingFeeCents) : "待选择省区"} />
          <div className="vk-divider pt-4">
            <Row label="预计总计" value={formatMoney(payableCents)} strong />
          </div>
        </div>
        <p className="mt-5 text-xs leading-6 text-black/50">最终金额以订单提交时显示的信息为准。</p>
      </aside>
    </div>
  );
}

function CheckoutSection({ children, icon, title }: { children: ReactNode; icon?: ReactNode; title: string }) {
  return <section className="border-b border-black/15 py-8 first:pt-0"><h2 className="flex items-center gap-2 text-xl font-semibold">{icon}{title}</h2>{children}</section>;
}

function addressProvince(address?: SavedAddress) {
  if (!address) return "";
  return normalizeMainlandProvince(address.province) ?? "";
}

function Row({ danger, label, strong, value }: { danger?: boolean; label: string; strong?: boolean; value: string }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? "text-xl font-semibold" : ""}`}>
      <span className="text-black/55">{label}</span>
      <span className={danger ? "text-[#d92d20]" : ""}>{value}</span>
    </div>
  );
}

function statusClass(tone: StatusTone) {
  if (tone === "success") return "border-l-2 border-[#067647] pl-4 text-sm font-semibold text-[#067647]";
  if (tone === "error") return "border-l-2 border-[#b42318] pl-4 text-sm font-semibold text-[#b42318]";
  return "border-l-2 border-black/20 pl-4 text-sm text-black/55";
}

function buildPendingPaymentUrl(pendingPayment: PendingPayment) {
  const params = new URLSearchParams({
    amountCents: String(pendingPayment.amountCents),
    appId: pendingPayment.payment.notifyIdentity.appId,
    provider: pendingPayment.payment.provider,
    redirectUrl: pendingPayment.payment.redirectUrl,
    merchantId: pendingPayment.payment.notifyIdentity.merchantId,
    merchantOrderNo: pendingPayment.payment.notifyIdentity.merchantOrderNo,
    orderNo: pendingPayment.orderNo,
    paymentId: pendingPayment.payment.paymentId,
    sellerId: pendingPayment.payment.notifyIdentity.sellerId,
  });
  return `/checkout/pending?${params.toString()}`;
}

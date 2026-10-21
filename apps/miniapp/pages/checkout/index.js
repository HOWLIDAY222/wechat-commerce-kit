import { fetchPickupAvailability } from '../../services/orders';
import { pickupUnavailableLabel } from '../../models/pickup';
import { withTapFeedback } from '../../utils/tap-feedback';
import { fetchAddresses } from '../../services/addresses';
import { fetchCart } from '../../services/cart';
import { createOrder, fetchOrderQuote,fetchDirectCheckout,createDirectOrder } from '../../services/orders';
import {readDirectCheckout,clearDirectCheckout} from '../../stores/direct-checkout';
import { hasSession } from '../../stores/session';
import { config } from '../../config/index';
import { rememberCheckoutLoginReturn } from '../../stores/navigation';

Page(withTapFeedback({
  data: {
    deliveryMethod: 'DELIVERY',
    pickup: null,
    pickupLabel: '',
    address: null,
    addresses: [],
    cart: null,
    error: '',
    loading: true,
    quote: null,
    submitting: false,
    submissionUncertain: false,
    directMode:false,
    checkoutEnabled: config.checkoutEnabled && config.paymentEnabled && config.paymentProvider === 'wechat',
  },

  onLoad(options={}){this.setData({directMode:options.mode==='direct'});},
  onShow() {
    if (hasSession()) this.loadCheckout();
    else { rememberCheckoutLoginReturn(this.data.directMode); wx.switchTab({ url: '/pages/account/index' }); }
  },

  async loadCheckout() {
    if(this.data.submitting)return;
    const loadId = (this.loadId || 0) + 1;
    this.loadId = loadId;
    this.setData({ loading: true, error: '', quote: null });
    try {
      const draft=this.data.directMode?readDirectCheckout():null;
      if(this.data.directMode&&!draft)throw Error('DIRECT_CHECKOUT_EXPIRED');
      this.directDraft=draft;
      const [cart, addresses] = await Promise.allSettled([
        draft?fetchDirectCheckout(draft.selection).then(result=>result.cart):fetchCart(),
        fetchAddresses(),
      ]);
      if (cart.status === 'rejected') throw cart.reason;
      if (addresses.status === 'rejected') throw addresses.reason;
      const selected = wx.getStorageSync('merchantkit.checkoutAddress');
      const address = addresses.value.find((item) => item.id === selected?.id)
        || addresses.value.find((item) => item.isDefault)
        || addresses.value[0]
        || null;
      if (this.loadId !== loadId) return;
      this.setData({
        address,
        addresses: addresses.value,
        cart: cart.value,
      });
      let pickup;
      try { pickup = await fetchPickupAvailability(address?.id); }
      catch { pickup = {enabled:false,eligible:false,point:null,reason:'PICKUP_LOAD_FAILED'}; }
      if(this.loadId !== loadId) return;
      const deliveryMethod = this.data.deliveryMethod === 'PICKUP' && pickup.eligible ? 'PICKUP' : 'DELIVERY';
      this.setData({pickup,deliveryMethod,pickupLabel:pickupUnavailableLabel(pickup,address)});
      const delivery = deliveryMethod === 'PICKUP' ? {deliveryMethod,pickupPointVersion:pickup.point.version} : undefined;
      if (address && cart.value.items.length) {
        const quote = draft?(await fetchDirectCheckout(draft.selection,address.id,delivery)).quote:await fetchOrderQuote(address.id,delivery);
        if (this.loadId === loadId) this.setData({ quote });
      }
    } catch (error) {
      if (this.loadId === loadId) this.setData({ error: checkoutErrorMessage(error?.message) });
    } finally {
      if (this.loadId === loadId) this.setData({ loading: false });
    }
  },

  chooseDelivery(event) {
    const method = event?.currentTarget?.dataset?.method;
    if(this.data.loading || this.data.submitting || this.data.submissionUncertain || !['DELIVERY','PICKUP'].includes(method) || method === this.data.deliveryMethod || method === 'PICKUP' && !this.data.pickup?.eligible) return;
    this.setData({deliveryMethod:method,quote:null});
    this.loadCheckout();
  },
  chooseAddress() {
    if (this.data.submitting || this.data.submissionUncertain) return;
    wx.navigateTo({ url: '/pages/addresses/index?select=1' });
  },

  openMember(event) { if(!this.data.submitting && !this.data.submissionUncertain){const section=['points','wallet'].includes(event?.currentTarget?.dataset?.section)?event.currentTarget.dataset.section:'claim';wx.navigateTo({url:`/pages/member/index?section=${section}&from=checkout`});} },
  retryCheckout() { if(!this.data.submitting && !this.data.submissionUncertain)this.loadCheckout(); },
  editBag() {
    if(this.data.submitting||this.data.submissionUncertain)return;
    if(!this.data.directMode){this.backToBag();return;}
    try{const draft=readDirectCheckout();if(!draft){this.backToBag();return;}const item=draft.selection;wx.navigateTo({url:'/pages/product-detail/index?section=purchase&purchaseAction=buy&slug='+encodeURIComponent(item.productSlug)+'&style='+encodeURIComponent(item.style||'')+'&size='+encodeURIComponent(item.size)+'&color='+encodeURIComponent(item.color)+'&quantity='+item.quantity});}
    catch{this.setData({error:checkoutErrorMessage('DIRECT_CHECKOUT_ACCOUNT_CHANGED')});}
  },
  viewOrders() { wx.navigateTo({ url: '/pages/orders/index' }); },
  backToBag() { wx.switchTab({ url: '/pages/cart/index' }); },

  async submitOrder() {
    if (this.data.loading || !this.data.checkoutEnabled || !this.data.address?.id || !this.data.quote || this.data.submitting || this.data.submissionUncertain) return;
    this.setData({ submitting: true, error: '' });
    try {
      const draft=this.data.directMode?readDirectCheckout():null;
      if(this.data.directMode&&(!draft||draft.requestId!==this.directDraft?.requestId))throw Error('DIRECT_CHECKOUT_EXPIRED');
      const delivery = this.data.deliveryMethod === 'PICKUP' ? {deliveryMethod:'PICKUP',pickupPointVersion:this.data.pickup.point.version} : undefined;
      const order = draft?await createDirectOrder(draft,this.data.address.id,this.data.quote.payableAmountCents,delivery):await createOrder(this.data.address.id, this.data.quote.payableAmountCents,delivery);
      if(draft)clearDirectCheckout(draft.requestId);
      wx.removeStorageSync('merchantkit.checkoutAddress');
      wx.redirectTo({ url: `/pages/order-detail/index?orderNo=${encodeURIComponent(order.orderNo)}` });
    } catch (error) {
      const uncertain = error?.code === 'NETWORK_REQUEST_FAILED' || error?.statusCode >= 500 || error?.message === 'INVALID_ORDER_RESPONSE' || error?.message==='ORDER_REQUEST_CHANGED';
      const message = uncertain ? '订单提交结果暂未确认。请先查看“我的订单”，避免重复下单。' : checkoutErrorMessage(error?.message);
      this.setData({submitting:false});
      await this.loadCheckout();
      this.setData({ error: message, submissionUncertain: uncertain });
    } finally {
      this.setData({ submitting: false });
    }
  },
}, ["chooseDelivery","retryCheckout","viewOrders","backToBag","chooseAddress","editBag","openMember","submitOrder"]));

function checkoutErrorMessage(code) {
  const messages = {
    DIRECT_CHECKOUT_EXPIRED:'本次选购已过期，请返回商品页重新选择。',
    DIRECT_CHECKOUT_ACCOUNT_CHANGED:'账号已变化，请重新选择本次购买的商品。',
    INVALID_DIRECT_SELECTION:'本次商品规格已变化，请重新选择。',
    AUTH_REQUIRED: '登录已过期，请到“我的”重新登录。',
    SESSION_CHANGED: '登录账户已变化，请返回购物袋重新结算。',
    PICKUP_UNAVAILABLE:'线下自提暂未开放，请选择快递配送。',
    PICKUP_AREA_UNAVAILABLE:'当前区域无法使用自提服务，请选择快递配送。',
    PICKUP_POINT_CHANGED:'自提信息已更新，请确认后重新提交。',
    ADDRESS_NOT_FOUND: '收货地址不存在，请重新选择。',
    ADDRESS_REQUIRED: '请选择收货地址。',
    SHIPPING_FEE_CONFIGURATION_REQUIRED: '运费规则尚未准备好，请稍后重试。',
    PRODUCT_QUANTITY_LIMIT_EXCEEDED: '商品数量超过上限，请返回购物袋调整。',
    CART_EMPTY: '购物袋为空，无法提交订单。',
    COMMERCE_SHOWCASE_ONLY: '商城当前为展示模式，尚未开放交易。',
    COMMERCE_PAUSED: '商城交易暂时暂停。',
    INSUFFICIENT_INVENTORY: '部分商品库存不足，请返回购物袋调整。',
    COUPON_CHANGED: '优惠券状态已更新，请确认最新金额后重试。',
    PRICE_CHANGED: '商品价格已更新，请确认最新结算金额。',
    CHECKOUT_NOT_READY: '订单提交暂未开放。',
    PAYMENT_NOT_READY: '微信支付暂未开放，暂时无法提交订单。',
    PRODUCT_SHOWCASE_ONLY: '部分商品当前仅供展示。',
    PRODUCT_SALE_NOT_STARTED: '部分商品尚未开始发售。',
    PRODUCT_SALE_PAUSED: '部分商品发售暂时停止。',
    SHIPPING_FEE_NOT_CONFIGURED: '运费规则尚未完成配置，暂时不能提交订单。',
    SKU_NOT_FOUND: '部分商品规格已失效，请返回购物袋调整。',
  };
  return messages[code] || '结算信息同步失败，请稍后重试。';
}

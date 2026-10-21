import { withTapFeedback } from '../../utils/tap-feedback';
import { cancelOrder, confirmOrderReceipt, fetchOrder, fetchOrderLogistics, fetchOrderDispatchEstimate, repurchaseOrder } from '../../services/orders';
import { payOrderWithWeChat } from '../../services/payments';
import { isLogisticsSimulator, loadLogisticsPlugin } from '../../services/logistics-plugin';
import { readAccessToken } from '../../stores/session';
import { config } from '../../config/index';
import { logisticsPresentation } from '../../models/order';
import { canShowDispatchEstimate, dispatchEstimatePresentation } from '../../models/dispatch-estimate';

Page(withTapFeedback({
  data: {
    cancelling: false,
    error: '',
    loading: true,
    order: null,
    refundDisplay: { visible: false, succeededLabel: '', succeededAmount: '', processingAmount: '' },
    paying: false,
    confirmingReceipt: false,
    repurchasing: false,
    logisticsLoading: false,
    logisticsError: '',
    logisticsState: 'idle',
    logisticsStatusLabel: '',
    logisticsHint: '',
    logisticsTraceLabel: '',
    dispatchEstimate: { visible: false, state: 'hidden', startDate: null, endDate: null, title: '', hint: '' },
    paymentEnabled: config.paymentEnabled && config.paymentProvider === 'wechat',
  },

  onLoad(options) {
    this._unloaded = false;
    this.orderNo = options.orderNo || '';
    this.loadOrder();
  },

  onPullDownRefresh() {
    if (this.data.loading) { wx.stopPullDownRefresh(); return; }
    this._logisticsPrefetchedKey = '';
    this.loadOrder();
  },

  onUnload() {
    this._unloaded = true;
    this._orderReadVersion = (this._orderReadVersion || 0) + 1;
    this._logisticsReadVersion = (this._logisticsReadVersion || 0) + 1;
    this._dispatchEstimateReadVersion = (this._dispatchEstimateReadVersion || 0) + 1;
  },

  onShow() {
    if (this.receiptPending) {
      this.receiptPending = false;
      this.syncReceipt();
    } else if (this.orderNo && this.data.order && !this.data.paying && !this.data.loading) {
      this.loadOrder();
    }
  },

  async syncReceipt() {
    this.setData({ confirmingReceipt: true });
    try {
      const order = await confirmOrderReceipt(this.orderNo);
      this.setData({ order, refundDisplay: order.refundSummary ? refundPresentation(order.refundSummary) : this.data.refundDisplay, error: '' });
      this.refreshDispatchEstimate(order);
      wx.showToast({ title: '已确认收货', icon: 'success' });
    } catch (error) {
      this.setData({ error: error?.message === 'WECHAT_RECEIPT_NOT_CONFIRMED' ? '尚未确认收货，可稍后重试。' : '收货状态同步失败，请稍后重试。' });
    } finally { this.setData({ confirmingReceipt: false }); }
  },

  async loadOrder() {
    if (!this.orderNo) {
      this.setData({ loading: false, error: '缺少订单编号。' });
      return;
    }
    const version = this._orderReadVersion = (this._orderReadVersion || 0) + 1;
    this._dispatchEstimateReadVersion = (this._dispatchEstimateReadVersion || 0) + 1;
    this.setData({ loading: true, error: '', dispatchEstimate: dispatchEstimatePresentation(this.data.order, null, { state: 'loading' }) });
    try {
      const order = await fetchOrder(this.orderNo);
      if (this._unloaded || version !== this._orderReadVersion) return;
      // Order-center links carry the payment number. Use the resolved store
      // order number for subsequent payment, receipt and after-sales actions.
      this.orderNo = order.orderNo;
      this.setData({ order, refundDisplay: refundPresentation(order.refundSummary) });
      this.prefetchLogistics(order);
      this.refreshDispatchEstimate(order);
    } catch (error) {
      if (!this._unloaded && version === this._orderReadVersion) this.setData({ error: error?.message === 'ORDER_NOT_FOUND' ? '订单不存在。' : '订单状态同步失败，请稍后重试。', dispatchEstimate: dispatchEstimatePresentation(this.data.order, null, { state: 'error' }) });
    } finally {
      if (!this._unloaded && version === this._orderReadVersion) this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },

  cancelOrder() {
    if (!this.data.order?.canCancel || this.data.cancelling || this.data.paying) return;
    wx.showModal({
      title: '取消订单',
      content: '未支付订单取消后将释放锁定库存。',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ cancelling: true, error: '' });
        try {
          const order = await cancelOrder(this.orderNo);
          this.setData({ order, refundDisplay: order.refundSummary ? refundPresentation(order.refundSummary) : this.data.refundDisplay });
          this.refreshDispatchEstimate(order);
        } catch (error) {
          this.setData({ error: error?.message === 'PAID_ORDER_CANNOT_CANCEL' ? '已支付订单不能直接取消，请申请售后。' : '订单取消失败，请稍后重试。' });
        } finally {
          this.setData({ cancelling: false });
        }
      },
    });
  },

  async payOrder() {
    if (!this.data.paymentEnabled || !this.data.order?.canPay || this.data.paying || this.data.cancelling) return;
    this.setData({ paying: true, error: '' });
    try {
      const result = await payOrderWithWeChat(this.orderNo);
      await this.loadOrder();
      if (result.paid) wx.showToast({ title: '支付已确认', icon: 'success' });
      else if (result.clientResult === 'cancelled') wx.showToast({ title: '已取消支付', icon: 'none' });
      else wx.showToast({ title: '支付结果确认中', icon: 'none' });
    } catch (error) {
      const message = paymentErrorMessage(error?.message);
      await this.loadOrder();
      this.setData({ error: message });
    } finally {
      this.setData({ paying: false });
    }
  },

  requestAfterSales() {
    if (this.data.order?.canRequestAfterSales) {
      wx.navigateTo({ url: `/pages/after-sales-create/index?orderNo=${encodeURIComponent(this.orderNo)}` });
    }
  },

  copyOrderNo() { if (this.orderNo) wx.setClipboardData({ data: this.orderNo }); },
  copyTrackingNo() { if (this.data.order?.shipment?.trackingNo) wx.setClipboardData({ data: this.data.order.shipment.trackingNo }); },

  async refreshDispatchEstimate(order) {
    if (this._unloaded) return;
    const version = this._dispatchEstimateReadVersion = (this._dispatchEstimateReadVersion || 0) + 1;
    const orderNo = order?.orderNo;
    this.setData({ dispatchEstimate: dispatchEstimatePresentation(order, null, { state: 'loading' }) });
    if (!canShowDispatchEstimate(order)) return;
    try {
      const estimate = await fetchOrderDispatchEstimate(orderNo);
      if (this._unloaded || version !== this._dispatchEstimateReadVersion || this.orderNo !== orderNo || !canShowDispatchEstimate(this.data.order)) return;
      this.setData({ dispatchEstimate: dispatchEstimatePresentation(this.data.order, estimate) });
    } catch {
      if (!this._unloaded && version === this._dispatchEstimateReadVersion && this.orderNo === orderNo && canShowDispatchEstimate(this.data.order)) this.setData({ dispatchEstimate: dispatchEstimatePresentation(this.data.order, null, { state: 'error' }) });
    }
  },

  async prefetchLogistics(order) {
    if (this._unloaded) return;
    const orderNo = order?.orderNo;
    const trackingNo = order?.shipment?.trackingNo;
    const trackingCompany = order?.shipment?.trackingCompany || '';
    const key = order?.canViewLogistics ? `${orderNo}|${trackingCompany}|${trackingNo}|${order.fulfillmentStatus}` : '';
    if (!key) {
      this._logisticsPrefetchedKey = '';
      this._logisticsReadVersion = (this._logisticsReadVersion || 0) + 1;
      this.setData({ logisticsState: 'idle', logisticsStatusLabel: '', logisticsHint: '', logisticsTraceLabel: '', logisticsError: '' });
      return;
    }
    if (this._logisticsPrefetchedKey === key && Date.now() - this._logisticsPrefetchedAt < 30000) return;
    this._logisticsPrefetchedKey = key;
    this._logisticsPrefetchedAt = Date.now();
    const version = this._logisticsReadVersion = (this._logisticsReadVersion || 0) + 1;
    this.setData({ logisticsState: 'checking', logisticsStatusLabel: '正在更新物流信息', logisticsHint: '', logisticsTraceLabel: '', logisticsError: '' });
    try {
      const result = await fetchOrderLogistics(orderNo);
      if (this._unloaded || version !== this._logisticsReadVersion || this.orderNo !== orderNo || !this.data.order?.canViewLogistics || this.data.order.shipment.trackingNo !== trackingNo || (this.data.order.shipment.trackingCompany || '') !== trackingCompany) return;
      // Discard the credential after this read; only public status copy enters data.
      this.setData(logisticsPresentation(result));
    } catch (error) {
      if (!this._unloaded && version === this._logisticsReadVersion && this.orderNo === orderNo && this.data.order?.canViewLogistics && this.data.order.shipment.trackingNo === trackingNo && (this.data.order.shipment.trackingCompany || '') === trackingCompany) this.setData({ logisticsState: 'error', logisticsStatusLabel: '查询暂时不可用', logisticsHint: logisticsErrorMessage(error), logisticsTraceLabel: '' });
    }
  },

  async viewLogistics() {
    if (!this.data.order?.canViewLogistics || this._logisticsBusy || this._unloaded || this.data.logisticsState === 'checking') return;
    if (isLogisticsSimulator()) {
      wx.showToast({ title: '请在手机预览中查看物流', icon: 'none' });
      return;
    }
    const orderNo = this.orderNo;
    const trackingNo = this.data.order.shipment.trackingNo;
    const trackingCompany = this.data.order.shipment.trackingCompany || '';
    const sessionToken = readAccessToken();
    this._logisticsBusy = true;
    this.setData({ logisticsLoading: true, logisticsError: '' });
    try {
      if (!sessionToken) throw Error('AUTH_REQUIRED');
      const logistics = await fetchOrderLogistics(orderNo);
      if (this._unloaded || this.orderNo !== orderNo || !this.data.order?.canViewLogistics || this.data.order.shipment.trackingNo !== trackingNo || (this.data.order.shipment.trackingCompany || '') !== trackingCompany) return;
      if (sessionToken !== readAccessToken()) throw Error('SESSION_CHANGED');
      this._logisticsPrefetchedAt = Date.now();
      this.setData(logisticsPresentation(logistics));
      if (!logistics.available) {
        this.setData({ logisticsError: '暂无可查询的物流轨迹，请稍后再试，或复制运单号查询。' });
        return;
      }
      const plugin = await loadLogisticsPlugin();
      if (this._unloaded || this.orderNo !== orderNo || !this.data.order?.canViewLogistics || this.data.order.shipment.trackingNo !== trackingNo || (this.data.order.shipment.trackingCompany || '') !== trackingCompany) return;
      if (sessionToken !== readAccessToken()) throw Error('SESSION_CHANGED');
      // Keep the credential local to this tap. It must not enter page data or storage.
      const result = plugin.openWaybillTracking({ waybillToken: logistics.waybillToken });
      if (result && typeof result.then === 'function') {
        let timeout;
        try {
          await Promise.race([
            result,
            new Promise((resolve, reject) => { timeout = setTimeout(() => reject(new Error('LOGISTICS_OPEN_TIMEOUT')), 12000); }),
          ]);
        } finally { clearTimeout(timeout); }
      }
    } catch (error) {
      if (!this._unloaded && this.orderNo === orderNo && this.data.order?.shipment?.trackingNo === trackingNo && (this.data.order.shipment.trackingCompany || '') === trackingCompany) this.setData({ logisticsError: logisticsErrorMessage(error), logisticsState: 'error', logisticsStatusLabel: '查询暂时不可用', logisticsTraceLabel: '' });
    } finally {
      this._logisticsBusy = false;
      if (!this._unloaded) this.setData({ logisticsLoading: false });
    }
  },
  goLogin() { wx.switchTab({ url: '/pages/account/index' }); },

  confirmReceipt() {
    if (!this.data.order?.canConfirmReceipt || this.data.confirmingReceipt) return;
    if (this.data.order.wechatTransactionId) {
      if (!wx.openBusinessView) { this.setData({ error: '请升级微信后确认收货。' }); return; }
      this.receiptPending = true;
      wx.openBusinessView({ businessType: 'weappOrderConfirm', extraData: { transaction_id: this.data.order.wechatTransactionId },
        fail: () => { this.receiptPending = false; this.setData({ error: '微信收货确认未完成，请稍后重试。' }); },
      });
      return;
    }
    wx.showModal({
      title: '确认收货',
      content: '请在实际收到商品后确认。确认后仍可按售后规则申请服务。',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ confirmingReceipt: true, error: '' });
        try {
          const order = await confirmOrderReceipt(this.orderNo);
          this.setData({ order, refundDisplay: order.refundSummary ? refundPresentation(order.refundSummary) : this.data.refundDisplay });
          this.refreshDispatchEstimate(order);
          wx.showToast({ title: '已确认收货', icon: 'success' });
        } catch (error) {
          const messages = {
            ORDER_NOT_SHIPPED: '订单尚未发货，不能确认收货。',
            UNPAID_ORDER_RECEIPT_FORBIDDEN: '未支付订单不能确认收货。',
          };
          this.setData({ error: messages[error?.message] || '确认收货失败，请刷新订单后重试。' });
        } finally {
          this.setData({ confirmingReceipt: false });
        }
      },
    });
  },

  async repurchase() {
    if (!this.data.order?.canRepurchase || this.data.repurchasing) return;
    this.setData({ repurchasing: true, error: '' });
    try {
      const result = await repurchaseOrder(this.orderNo);
      const suffix = result.skippedItems.length ? `，${result.skippedItems.length} 项当前不可购买` : '';
      wx.showToast({ title: `已加入 ${result.addedItemCount} 件${suffix}`, icon: 'none', duration: 2600 });
      setTimeout(() => wx.switchTab({ url: '/pages/cart/index' }), 500);
    } catch (error) {
      const messages = {
        COMMERCE_PAUSED: '商城交易暂时暂停。',
        COMMERCE_SHOWCASE_ONLY: '商品当前仅供展示。',
        INSUFFICIENT_INVENTORY: '相关规格库存不足。',
        SKU_NOT_FOUND: '相关规格已下架。',
      };
      this.setData({ error: messages[error?.message] || '再次购买失败，请稍后重试。' });
    } finally {
      this.setData({ repurchasing: false });
    }
  },
}, ["copyOrderNo","viewLogistics","copyTrackingNo","payOrder","cancelOrder","confirmReceipt","repurchase","requestAfterSales"]));

function refundPresentation(summary) {
  const empty = { visible: false, succeededLabel: '', succeededAmount: '', processingAmount: '' };
  if (!['PROCESSING', 'PARTIAL', 'REFUNDED'].includes(summary?.state)) return empty;
  const money = value => Number.isSafeInteger(value) && value > 0 ? `¥${(value / 100).toFixed(2).replace(/\.00$/, '')}` : '';
  const succeededAmount = summary.state === 'PROCESSING' ? '' : money(summary.succeededAmountCents);
  const processingAmount = money(summary.processingAmountCents);
  return { visible: Boolean(succeededAmount || processingAmount), succeededAmount, processingAmount,
    succeededLabel: succeededAmount ? (summary.state === 'REFUNDED' ? '已退款' : '部分退款') : '' };
}

function logisticsErrorMessage(error) {
  if (error?.statusCode === 401 || error?.message === 'AUTH_REQUIRED' || error?.message === 'SESSION_CHANGED') {
    return '登录已失效，请重新登录后查看物流。';
  }
  if (error?.statusCode === 403 || error?.statusCode === 404 || ['ORDER_NOT_FOUND', 'FORBIDDEN'].includes(error?.message)) {
    return '暂时无法查看此订单的物流，请刷新订单后重试。';
  }
  if (error?.message === 'LOGISTICS_UNSUPPORTED') {
    return '当前微信版本暂不支持物流查询，请升级微信，或复制运单号查询。';
  }
  return '物流查询暂时不可用，请稍后重试，或复制运单号查询。';
}

function paymentErrorMessage(code) {
  const messages = {
    CANCELLED_ORDER_CANNOT_PAY: '订单已取消，不能支付。',
    ORDER_ALREADY_PAID: '订单已经支付。',
    WECHAT_IDENTITY_NOT_FOUND: '当前账户缺少微信身份关联，请重新登录。',
    WECHAT_PAY_NOT_CONFIGURED: '微信支付尚未完成商户配置。',
    WECHAT_PAY_API_NO_AUTH: '商户微信支付权限暂不可用，请联系商家处理。无需重复下单。',
    WECHAT_PAY_API_APPID_MCHID_NOT_MATCH: '商户支付关联配置异常，请联系商家处理。无需重复下单。',
    WECHAT_PAY_PREPAY_IN_PROGRESS: '支付请求正在生成，请稍后重试。',
    WECHAT_PAY_CLOSE_CONFIRMATION_REQUIRED: '上一笔支付正在确认关闭，请稍后再试。',
    WECHAT_PAY_PREVIOUS_ATTEMPT_UNRESOLVED: '上一笔支付状态仍在确认，请稍后刷新订单。',
    PAYMENT_NOT_READY: '微信支付暂未开放。',
    PAYMENT_RESULT_UNCONFIRMED: '暂未确认支付结果。如已扣款，请勿重复支付，稍后刷新订单查看。',
  };
  return messages[code] || '微信支付暂时无法发起，请稍后重试。';
}

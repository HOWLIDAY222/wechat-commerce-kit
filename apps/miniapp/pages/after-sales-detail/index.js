import { withTapFeedback } from '../../utils/tap-feedback';
import {
  addAfterSalesMessage,
  fetchAfterSales,
  submitReturnShipment,
  uploadAfterSalesImage,
} from '../../services/after-sales';

Page(withTapFeedback({
  data: {
    error: '',
    item: null,
    refundDisplay: { visible: false, succeededLabel: '', succeededAmount: '', processingAmount: '' },
    loading: true,
    messageText: '',
    trackingCompany: '',
    trackingNo: '',
    submitting: false,
    uploading: false,
  },

  onLoad(options) {
    this._unloaded = false;
    this.afterSalesNo = options.afterSalesNo || '';
    this.loadItem();
  },

  onPullDownRefresh() {
    if (this.data.loading) { wx.stopPullDownRefresh(); return; }
    this.loadItem();
  },

  onShow() {
    if (this.afterSalesNo && !this.data.loading && !this.data.submitting && !this.data.uploading) this.loadItem();
  },

  onUnload() {
    this._unloaded = true;
    this._itemReadVersion = (this._itemReadVersion || 0) + 1;
  },

  async loadItem() {
    if (this._unloaded) return;
    if (!this.afterSalesNo) {
      this.setData({ loading: false, error: '缺少售后编号。' });
      return;
    }
    const version = this._itemReadVersion = (this._itemReadVersion || 0) + 1;
    const afterSalesNo = this.afterSalesNo;
    this.setData({ loading: true, error: '' });
    try {
      const item = await fetchAfterSales(afterSalesNo);
      if (this._unloaded || version !== this._itemReadVersion || this.afterSalesNo !== afterSalesNo) return;
      this.setData({ item, refundDisplay: refundPresentation(item.refundSummary) });
    } catch (error) {
      if (!this._unloaded && version === this._itemReadVersion && this.afterSalesNo === afterSalesNo) this.setData({ error: formatError(error, '售后进度同步失败，请稍后重试。') });
    } finally {
      if (!this._unloaded && version === this._itemReadVersion) this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },

  onMessageInput(event) {
    this.setData({ messageText: event.detail.value });
  },

  onTrackingCompanyInput(event) {
    this.setData({ trackingCompany: event.detail.value });
  },

  onTrackingNoInput(event) {
    this.setData({ trackingNo: event.detail.value });
  },

  async sendMessage() {
    const message = this.data.messageText.trim();
    if (!message || this.data.submitting) return;
    this.setData({ submitting: true, error: '' });
    try {
      const item = await addAfterSalesMessage(this.afterSalesNo, message);
      this.setData({ item, refundDisplay: item.refundSummary ? refundPresentation(item.refundSummary) : this.data.refundDisplay, messageText: '' });
    } catch (error) {
      this.setData({ error: formatError(error, '留言发送失败，请稍后重试。') });
    } finally {
      this.setData({ submitting: false });
    }
  },

  async chooseEvidence() {
    const slots = this.data.item?.imageSlotsLeft || 0;
    if (!slots || !this.data.item?.canUploadEvidence || this.data.uploading) return;
    this.setData({ uploading: true, error: '' });
    try {
      const result = await wx.chooseMedia({ count: Math.min(slots, 6), mediaType: ['image'], sourceType: ['album', 'camera'] });
      const files = Array.isArray(result.tempFiles) ? result.tempFiles : [];
      if (!files.length) return;
      let item = this.data.item;
      for (const file of files) {
        if (Number(file.size) > 5 * 1024 * 1024) throw new Error('IMAGE_TOO_LARGE');
        item = await uploadAfterSalesImage(this.afterSalesNo, file.tempFilePath);
        this.setData({ item, refundDisplay: item.refundSummary ? refundPresentation(item.refundSummary) : this.data.refundDisplay });
      }
      wx.showToast({ title: '凭证已上传', icon: 'success' });
    } catch (error) {
      if (!String(error?.message || error?.errMsg || '').includes('cancel')) {
        // An upload may have committed even when its response was lost.
        try { const item = await fetchAfterSales(this.afterSalesNo); this.setData({ item, refundDisplay: refundPresentation(item.refundSummary) }); } catch { /* Preserve last confirmed item. */ }
        this.setData({ error: formatError(error, '凭证上传失败，请检查图片后重试。') });
      }
    } finally {
      this.setData({ uploading: false });
    }
  },

  previewImage(event) {
    const current = event.currentTarget.dataset.src;
    const urls = this.data.item?.evidenceImages || [];
    if (current && urls.length) wx.previewImage({ current, urls });
  },

  submitReturn() {
    const trackingCompany = this.data.trackingCompany.trim();
    const trackingNo = this.data.trackingNo.trim();
    if (!trackingCompany || !trackingNo || this.data.submitting) {
      this.setData({ error: '请填写物流公司和物流单号。' });
      return;
    }
    wx.showModal({
      title: '确认提交退货物流？',
      content: `${trackingCompany} ${trackingNo}\n提交后不可自行修改，请核对无误。`,
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ submitting: true, error: '' });
        try {
          const item = await submitReturnShipment(this.afterSalesNo, { trackingCompany, trackingNo });
          this.setData({ item, refundDisplay: item.refundSummary ? refundPresentation(item.refundSummary) : this.data.refundDisplay, trackingCompany: '', trackingNo: '' });
          wx.showToast({ title: '物流已提交', icon: 'success' });
        } catch (error) {
          this.setData({ error: formatError(error, '退货物流提交失败，请核对后重试。') });
        } finally {
          this.setData({ submitting: false });
        }
      },
    });
  },
}, ["submitReturn","previewImage","chooseEvidence","sendMessage"]));

function refundPresentation(summary) {
  const empty = { visible: false, succeededLabel: '', succeededAmount: '', processingAmount: '' };
  if (!['PROCESSING', 'PARTIAL', 'REFUNDED'].includes(summary?.state)) return empty;
  const money = value => Number.isSafeInteger(value) && value > 0 ? `¥${(value / 100).toFixed(2).replace(/\.00$/, '')}` : '';
  const succeededAmount = summary.state === 'PROCESSING' ? '' : money(summary.succeededAmountCents);
  const processingAmount = money(summary.processingAmountCents);
  return { visible: Boolean(succeededAmount || processingAmount), succeededAmount, processingAmount,
    succeededLabel: succeededAmount ? (summary.state === 'REFUNDED' ? '已退款' : '部分退款') : '' };
}

function formatError(error, fallback) {
  const map = {
    IMAGE_TOO_LARGE: '单张图片不能超过 5 MB，已上传的图片会保留。',
    AUTH_REQUIRED: '登录已过期，请到“我的”重新登录。',
    AFTER_SALES_NOT_FOUND: '售后记录不存在。',
    AFTER_SALES_IMAGE_LIMIT_EXCEEDED: '最多只能上传 6 张凭证。',
    AFTER_SALES_IMAGE_UPLOAD_CLOSED: '当前售后状态不再接受新凭证。',
    INVALID_RETURN_SHIPMENT: '物流公司或物流单号格式不正确。',
    AFTER_SALES_ACTION_NOT_ALLOWED: '当前售后状态不能提交退货物流。',
  };
  return map[error?.message] || fallback;
}

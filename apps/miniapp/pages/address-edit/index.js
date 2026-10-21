import { withTapFeedback } from '../../utils/tap-feedback';
import { createAddress, fetchAddresses, updateAddress } from '../../services/addresses';
import { hasSession } from '../../stores/session';

const emptyForm = {
  name: '',
  phone: '',
  province: '',
  city: '',
  district: '',
  detail: '',
  postalCode: '',
  isDefault: false,
};

Page(withTapFeedback({
  data: {
    error: '',
    editing: false,
    form: { ...emptyForm },
    loading: false,
    loadFailed: false,
    region: [],
    regionLabel: '',
  },

  onLoad(options) {
    if (!hasSession()) { wx.switchTab({ url: '/pages/account/index' }); return; }
    this.addressId = options.id || '';
    this.setData({ editing: Boolean(this.addressId) });
    wx.setNavigationBarTitle({ title: this.addressId ? '编辑收货地址' : '新增收货地址' });
    if (this.addressId) this.loadAddress();
  },

  async loadAddress() {
    this.setData({ loading: true, error: '', loadFailed: false });
    try {
      const address = (await fetchAddresses()).find((item) => item.id === this.addressId);
      if (!address) throw new Error('ADDRESS_NOT_FOUND');
      this.setData({
        form: { ...emptyForm, ...address },
        region: [address.province, address.city, address.district || ''],
        regionLabel: [address.province, address.city, address.district].filter(Boolean).join(' / '),
      });
    } catch (_error) {
      this.setData({ error: '地址资料加载失败，请返回后重试。', loadFailed: true });
    } finally {
      this.setData({ loading: false });
    }
  },

  updateField(event) {
    const field = event.currentTarget.dataset.field;
    if (field) this.setData({ [`form.${field}`]: event.detail.value });
  },

  chooseRegion(event) {
    const [province, city, district] = event.detail.value;
    this.setData({
      region: event.detail.value,
      regionLabel: event.detail.value.filter(Boolean).join(' / '),
      'form.province': province,
      'form.city': city,
      'form.district': district,
    });
  },

  toggleDefault(event) {
    this.setData({ 'form.isDefault': event.detail.value });
  },

  async save() {
    if (this.data.loading || this.data.loadFailed) return;
    if (!hasSession()) { wx.switchTab({ url: '/pages/account/index' }); return; }
    const form = sanitizeForm(this.data.form);
    const error = validateForm(form);
    if (error) {
      this.setData({ error });
      return;
    }

    this.setData({ loading: true, error: '' });
    try {
      if (this.addressId) await updateAddress(this.addressId, form);
      else await createAddress(form);
      wx.showToast({ title: '地址已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 450);
    } catch (requestError) {
      const message = requestError?.message === 'INVALID_ADDRESS'
        ? '请检查收货地址信息。'
        : '地址保存失败，请稍后重试。';
      this.setData({ error: message });
    } finally {
      this.setData({ loading: false });
    }
  },
}, ["save"]));

function sanitizeForm(form) {
  return {
    name: form.name.trim(),
    phone: form.phone.trim(),
    province: form.province,
    city: form.city,
    district: form.district || '',
    detail: form.detail.trim(),
    postalCode: String(form.postalCode || '').trim(),
    isDefault: Boolean(form.isDefault),
  };
}

function validateForm(form) {
  if (!form.name) return '请填写收货人姓名。';
  if (!/^1[3-9]\d{9}$/.test(form.phone)) return '请填写有效的中国大陆手机号。';
  if (!form.province || !form.city) return '请选择省市区。';
  if (form.detail.length < 5) return '请填写完整的详细地址。';
  return '';
}

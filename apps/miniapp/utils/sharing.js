const BRAND = 'MerchantKit';

export function isTimelinePreview() {
  try {
    const options = typeof wx.getEnterOptionsSync === 'function'
      ? wx.getEnterOptionsSync() : wx.getLaunchOptionsSync?.();
    return Number(options?.scene) === 1154;
  } catch { return false; }
}

export function enablePublicSharing() {
  if (isTimelinePreview() || typeof wx.showShareMenu !== 'function') return;
  wx.showShareMenu({
    menus: ['shareAppMessage', 'shareTimeline'],
    fail() { wx.showShareMenu({ menus: ['shareAppMessage'], fail() {} }); },
  });
}

export function requireFullMiniProgram(preview) {
  if (!preview) return true;
  wx.showToast({ title: '请点底部“前往小程序”继续', icon: 'none', duration: 2500 });
  return false;
}

export function originalShareImage(source) {
  if (typeof source !== 'string') return '';
  const match = source.match(/^(https:\/\/[^/]+)\/_next\/image\?[^#]*?\burl=([^&]+)/);
  if (!match) return source;
  try {
    const original = decodeURIComponent(match[2]);
    return original.startsWith('/') && !original.startsWith('//')
      ? match[1] + original : /^https:\/\//.test(original) ? original : '';
  } catch { return ''; }
}

export function directShareImage(source) {
  const original = originalShareImage(source);
  return /\.(?:jpe?g|png)(?:[?#]|$)/i.test(original) ? original : '';
}

export function publicShareContent({ product, slug, style, cover, coverSource, page = 'home' } = {}) {
  const source = product?.image || '';
  const imageUrl = cover && coverSource === source ? cover : directShareImage(source);
  const safeSlug = typeof slug === 'string' && slug.length <= 160 ? slug : '';
  const selectedStyle = product?.quantityPricing?.styles?.find(value => value.key === style);
  const query = page === 'product' && safeSlug
    ? 'slug=' + encodeURIComponent(safeSlug) + (selectedStyle ? '&style=' + encodeURIComponent(selectedStyle.key) : '')
    : '';
  const name = product?.displayName || product?.name;
  const title = page === 'product'
    ? BRAND + ' · ' + (name || '商品') + (selectedStyle ? ' · ' + selectedStyle.label : '')
    : page === 'catalog' ? BRAND + ' · 全部商品' : BRAND + (name ? ' · ' + name : '');
  const route = page === 'product' && safeSlug ? '/pages/product-detail/index'
    : page === 'catalog' ? '/pages/products/index' : '/pages/home/home';
  const image = imageUrl ? { imageUrl } : {};
  return {
    message: { title, path: route + (query ? '?' + query : ''), ...image },
    // An explicit empty query prevents inheriting private parameters from the current page.
    timeline: { title, query, ...image },
  };
}

export const shareCoverEvents = {
  onShareCoverReady(event) {
    this.setData({ shareCover: event.detail.path, shareCoverSource: event.detail.source });
  },
};

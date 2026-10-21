import { rememberPendingTabLink } from '../stores/navigation';

const tabPages = Object.freeze({
  home: '/pages/home/home',
  shop: '/pages/products/index',
});

const nativePages = Object.freeze({
  about: '/pages/content/index?pageKey=about',
  contact: '/pages/contact/index',
});

const safePageKeyPattern = /^[a-z0-9-]{1,64}$/;
let navigation = null;

// Coalesce taps until the native transition completes; failed routes remain retryable.
export function navigateToPage(url) {
  if (navigation) return false;
  const transition = {};
  navigation = transition;
  const complete = () => { if (navigation === transition) navigation = null; };
  const fail = () => {
    complete();
    wx.showToast?.({ title: '页面暂时无法打开，请重试', icon: 'none' });
  };
  try { wx.navigateTo({ url, fail, complete }); }
  catch { fail(); return false; }
  return true;
}

export function parseShopQuery(query = '') {
  const values = {};
  for (const part of String(query).replace(/^\?/, '').slice(0,256).split('&')) {
    const [key, ...rest] = part.split('=');
    if (!['slug','section','focus','q'].includes(key)) continue;
    try { values[key] = decodeURIComponent(rest.join('=').replace(/\+/g, ' ')); } catch { /* Ignore malformed optional query values. */ }
  }
  return values;
}

export function navigateToProduct(slug, section = '') {
  if (typeof slug !== 'string' || !/^[a-z0-9-]{1,150}$/.test(slug)) return false;
  const suffix = ['details','purchase'].includes(section) ? `&section=${section}` : '';
  navigateToPage(`/pages/product-detail/index?slug=${encodeURIComponent(slug)}${suffix}`);
  return true;
}

export function navigateToManagedPage(input) {
  const link = typeof input === 'string' ? { pageKey: input } : (input || {});
  const key = typeof link.pageKey === 'string' ? link.pageKey.trim() : '';
  if (!safePageKeyPattern.test(key)) return false;

  if (key === 'shop') {
    const options = parseShopQuery(link.query);
    if (options.slug && navigateToProduct(options.slug, options.section)) return true;
  }

  if (tabPages[key]) {
    rememberPendingTabLink({ pageKey: key, query: link.query });
    wx.switchTab({ url: tabPages[key] });
    return true;
  }
  if (nativePages[key]) {
    navigateToPage(nativePages[key]);
    return true;
  }

  navigateToPage(`/pages/content/index?pageKey=${encodeURIComponent(key)}`);
  return true;
}

export function normalizeManagedPageKey(value, fallback = 'privacy-policy') {
  const key = typeof value === 'string' ? value.trim() : '';
  return safePageKeyPattern.test(key) ? key : fallback;
}

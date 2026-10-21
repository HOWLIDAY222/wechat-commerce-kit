import { assertPrivacyAccepted, hasPrivacyChoice, isPrivacyAccepted, savePrivacyChoice } from '../stores/privacy-consent';

const privacyRoute = 'pages/privacy/index';
const publicRoutes = new Set(['pages/home/home', 'pages/products/index', 'pages/product-detail/index', 'pages/story/index', 'pages/content/index', 'pages/contact/index']);
const tabRoutes = new Set(['pages/home/home', 'pages/products/index', 'pages/cart/index', 'pages/account/index']);
const knownRoutes = new Set([...publicRoutes, 'pages/cart/index', 'pages/account/index', 'pages/favorites/index', 'pages/addresses/index', 'pages/address-edit/index', 'pages/checkout/index', 'pages/orders/index', 'pages/order-detail/index', 'pages/after-sales/index', 'pages/after-sales-detail/index', 'pages/after-sales-create/index', 'pages/member/index', 'pages/fit-profile/index', 'pages/gifts/index', 'pages/gift-receive/index', 'pages/gift-redeem/index', 'pages/member-profile/index', 'pages/subscriptions/index', 'pages/member-earn/index', 'pages/member-invite/index', 'pages/member-lottery/index', 'pages/member-student/index', 'pages/member-surveys/index', 'pages/member-community/index']);
let returnTarget = null, deferredCapture = null, nativeInstalled = false, nativeOwner = null;
let serial = 0, visible = false, reading = false, nativeMode = false, activeHost = null, requestTarget = null;
const hosts = new Set(), choiceListeners = new Set(), nativeResolvers = new Set();
let tabLease = null;

export function safePrivacyTarget(path, query = {}) {
  const route = typeof path === 'string' ? path.replace(/^\//, '') : '';
  if (!knownRoutes.has(route)) return null;
  const result = {}, allow = route === 'pages/member-invite/index' ? { referralCode: /^[A-Za-z0-9_-]{6,80}$/ }
    : route === 'pages/product-detail/index' ? { slug: /^[a-z0-9-]{1,150}$/, section: /^(?:purchase|details)$/ }
      : route === 'pages/content/index' ? { pageKey: /^[a-z0-9-]{1,64}$/ }
        : route === 'pages/member-surveys/index' ? { id: /^(?:PREFERENCES|STYLE_SURVEY|UNDERWEAR_SURVEY)$/ }
          : route === 'pages/member-community/index' ? { tab: /^(?:follow|share|history|interaction|repost)$/ }
            : route === 'pages/member/index' ? { section: /^(?:wallet|claim|points|newcomer)$/, from: /^checkout$/ }
              : route === 'pages/checkout/index' ? { mode: /^direct$/ }
                : ['pages/gift-receive/index', 'pages/gift-redeem/index'].includes(route) ? { id: /^[A-Za-z0-9_-]{1,100}$/, token: /^[A-Za-z0-9_-]{43}$/ }
                  : ['pages/order-detail/index', 'pages/after-sales-create/index'].includes(route) ? { orderNo: /^[A-Za-z0-9_-]{1,100}$/ }
                    : route === 'pages/after-sales-detail/index' ? { afterSalesNo: /^[A-Za-z0-9_-]{1,100}$/ } : {};
  for (const [key, pattern] of Object.entries(allow)) if (typeof query?.[key] === 'string' && pattern.test(query[key])) result[key] = query[key];
  return { route, query: result };
}
function currentPage() { try { const pages = getCurrentPages(); return pages[pages.length - 1] || null; } catch { return null; } }
function currentTarget() { const page = currentPage(); return safePrivacyTarget(page?.route, page?.options || {}); }
function policyDocument(page) { return page?.route === privacyRoute || page?.route === 'pages/content/index' && ['privacy-policy', 'miniprogram-privacy'].includes(page.options?.pageKey || page.data?.pageKey); }
export function rememberPrivacyTarget(path, query) {
  const target = safePrivacyTarget(path, query); if (!target) return false;
  if (!returnTarget?.query.referralCode || target.query.referralCode) {
    if (deferredCapture && deferredCapture.code !== target.query.referralCode) deferredCapture = null;
    returnTarget = target;
  }
  return true;
}
export function deferPrivacyCapture(code, capture) {
  if (typeof capture !== 'function' || !/^[A-Za-z0-9_-]{6,80}$/.test(code || '') || returnTarget?.query.referralCode !== code) return false;
  deferredCapture = { code, capture }; return true;
}
export function observePrivacyDecision(listener) { choiceListeners.add(listener); return () => choiceListeners.delete(listener); }
function notifyChoice() { for (const listener of [...choiceListeners]) { try { listener(); } catch {} } }
function shareKeepsTabBarHidden(page) { try { const data = page?.selectComponent?.('#page-share-entry')?.data; return !!(data?.open || data?.timelineGuide); } catch { return false; } }
function updateTabBar(host) {
  const page = host?.page;
  let timeline = !!page?.data?.isTimelinePreview; try { timeline ||= wx.getEnterOptionsSync?.().scene === 1154; } catch {}
  if (tabLease && (!host || tabLease.page !== page || timeline)) { const previous = tabLease; tabLease = null; if (!shareKeepsTabBarHidden(previous.page)) wx.showTabBar?.({ animation: false, fail() {} }); }
  if (host && tabRoutes.has(page?.route) && !timeline) {
    if (!tabLease && !shareKeepsTabBarHidden(page) && typeof wx.hideTabBar === 'function') { const lease = { page }; tabLease = lease; wx.hideTabBar({ animation: false, fail() { if (tabLease === lease) tabLease = null; } }); }
  }
}
function render() {
  const page = currentPage();
  activeHost = [...hosts].reverse().find(host => host.shown && host.page === page) || null;
  const show = visible && !reading && !policyDocument(page);
  updateTabBar(show ? activeHost : null);
  for (const host of hosts) host.render({ visible: !!(show && host === activeHost), nativeRequired: nativeMode && needsNativePrivacy(), serial });
}
export function registerPrivacyHost(page, renderHost) {
  const host = { page, shown: true, render: renderHost }; hosts.add(host);
  showPrivacyHost(host, page); return host;
}
export function showPrivacyHost(host, page) {
  if (!hosts.has(host)) return;
  host.page = page || host.page; host.shown = true;
  const top = currentPage();
  if (nativeMode && nativeOwner && top !== nativeOwner && !policyDocument(top)) cancelNativePrivacy();
  if (!policyDocument(top)) {
    if (reading) reading = false;
    if (!isPrivacyAccepted() && !hasPrivacyChoice() && !visible) { visible = true; nativeMode = false; serial++; }
  }
  render();
}
export function hidePrivacyHost(host) { if (hosts.has(host)) { host.shown = false; render(); } }
export function removePrivacyHost(host) {
  hosts.delete(host);
  if (nativeOwner && host?.page === nativeOwner) cancelNativePrivacy();
  render();
}
export function privacyPageShown() { reading = true; render(); }
export function needsNativePrivacy() { return nativeResolvers.size > 0; }
export function cancelNativePrivacy() {
  const pending = [...nativeResolvers]; nativeResolvers.clear(); nativeOwner = null;
  if (nativeMode) { visible = false; nativeMode = false; serial++; render(); }
  for (const resolve of pending) { try { resolve({ event: 'disagree' }); } catch {} }
}
export function openPrivacyPage({ initial = false, native = false, path, query } = {}) {
  const target = safePrivacyTarget(path, query) || currentTarget(); if (target) rememberPrivacyTarget(target.route, target.query);
  if (!native && isPrivacyAccepted()) return false;
  const changedTarget = !!path && JSON.stringify(target) !== JSON.stringify(requestTarget);
  requestTarget = target;
  if (native) nativeOwner = currentPage();
  if (!visible || nativeMode !== native || changedTarget) serial++;
  visible = true; nativeMode = native; reading = false; render(); return true;
}
export function showInitialPrivacy(options = {}) {
  const target = safePrivacyTarget(options.path || 'pages/home/home', options.query);
  if (isPrivacyAccepted() || options.path === privacyRoute || target?.route === 'pages/content/index' && ['privacy-policy', 'miniprogram-privacy'].includes(target.query.pageKey)) return false;
  if (hasPrivacyChoice() && (!target || publicRoutes.has(target.route))) return false;
  return openPrivacyPage({ initial: true, path: target?.route, query: target?.query });
}
export function isCurrentPrivacySheet(expectedSerial, host) {
  const page = currentPage();
  return visible && !reading && expectedSerial === serial && !!host && host === activeHost && host.page === page && (!nativeMode || nativeOwner === page);
}
export function openPrivacyDocument(pageKey, expectedSerial, host) {
  if (!isCurrentPrivacySheet(expectedSerial, host) || !['privacy-policy', 'miniprogram-privacy'].includes(pageKey)) return false;
  reading = true; render();
  wx.navigateTo?.({ url: '/pages/content/index?pageKey=' + pageKey, fail() { reading = false; render(); } }); return true;
}
export function decidePrivacySheet(accepted, expectedSerial, nativeAuthorized = false, host) {
  if (!isCurrentPrivacySheet(expectedSerial, host)) return false;
  const native = nativeMode && needsNativePrivacy();
  if (native && accepted && !nativeAuthorized) return false;
  if (!native) savePrivacyChoice(accepted ? 'accepted' : 'browse');
  completePrivacyPage(accepted, { native, expectedSerial }); return true;
}
export function completePrivacyPage(accepted, { native = false, expectedSerial } = {}) {
  if (expectedSerial !== undefined && (!visible || expectedSerial !== serial)) return false;
  const page = currentPage(), sheetHost = activeHost;
  visible = false; reading = false; nativeMode = false; serial++;
  if (native) {
    const pending = [...nativeResolvers]; nativeResolvers.clear(); nativeOwner = null; render();
    for (const resolve of pending) { try { resolve({ event: accepted ? 'agree' : 'disagree', ...(accepted ? { buttonId: 'privacy-native-agree' } : {}) }); } catch {} }
    if (page?.route === privacyRoute) wx.navigateBack?.({ fail() { wx.switchTab?.({ url: '/pages/home/home' }); } });
    return true;
  }
  render(); notifyChoice();
  if (accepted) {
    const capture = deferredCapture?.code === returnTarget?.query.referralCode ? deferredCapture?.capture : null;
    deferredCapture = null; returnTarget = null;
    if (capture) { try { capture(); } catch {} }
    // Refresh the existing page once; login, membership and checkout writes stay
    // in their original user actions. Never replay onLoad or a native gesture.
    if (sheetHost?.page === page && !policyDocument(page)) { try { const task = page.onShow?.(); task?.catch?.(() => {}); } catch {} }
    else if (page?.route === privacyRoute) wx.navigateBack?.({ fail() { wx.switchTab?.({ url: '/pages/home/home' }); } });
  }
  return true;
}
export function installNativePrivacy() {
  if (nativeInstalled || typeof wx.onNeedPrivacyAuthorization !== 'function') return;
  nativeInstalled = true;
  wx.onNeedPrivacyAuthorization(resolve => { if (typeof resolve !== 'function') return; if (!isPrivacyAccepted()) { resolve({ event: 'disagree' }); openPrivacyPage(); return; } nativeResolvers.add(resolve); openPrivacyPage({ native: true }); });
}
export function requireNativePrivacy() {
  return new Promise((resolve, reject) => {
    try { assertPrivacyAccepted(); } catch (error) { reject(error); return; }
    if (typeof wx.requirePrivacyAuthorize !== 'function') { resolve(); return; }
    wx.requirePrivacyAuthorize({ success: resolve, fail() { reject(Error('WECHAT_PRIVACY_REQUIRED')); } });
  });
}

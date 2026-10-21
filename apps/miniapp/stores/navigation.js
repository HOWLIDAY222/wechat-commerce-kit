let pendingTabLink = null;
let loginReturn = '';

export function rememberCheckoutLoginReturn(direct=false) {
  loginReturn = direct?'/pages/checkout/index?mode=direct':'/pages/checkout/index';
}
export function rememberFitLoginReturn() { loginReturn = '/pages/fit-profile/index'; }
export function rememberGiftLoginReturn(route) {
  if(/^\/pages\/gifts\/index$/.test(route)||/^\/pages\/gift-redeem\/index\?id=[A-Za-z0-9_-]{1,100}$/.test(route)||/^\/pages\/gift-receive\/index\?id=[A-Za-z0-9_-]{1,100}&token=[A-Za-z0-9_-]{43}$/.test(route))loginReturn=route;
}
export function rememberServiceLoginReturn(destination) { if(destination==='orders'||destination==='after-sales')loginReturn=destination==='orders'?'/pages/orders/index':'/pages/after-sales/index'; }

export function rememberMemberLoginReturn(route) {
  if (typeof route !== 'string') return;
  const existingMember = /^\/pages\/member\/index(?:\?section=(?:wallet|claim|points|newcomer)(?:&from=checkout)?)?$/.test(route);
  const memberOperation = /^\/pages\/member-(?:lottery|student)\/index$/.test(route)
    || /^\/pages\/member-earn\/index(?:\?contact=(?:ENTERPRISE|OFFICIAL_ACCOUNT))?$/.test(route)
    || /^\/pages\/member-invite\/index(?:\?referralCode=[A-Za-z0-9_-]{6,80})?$/.test(route)
    || /^\/pages\/member-surveys\/index(?:\?id=(?:PREFERENCES|STYLE_SURVEY|UNDERWEAR_SURVEY))?$/.test(route)
    || /^\/pages\/member-community\/index(?:\?(?:shareToken=[A-Za-z0-9_-]{8,200}|tab=(?:follow|share|history|interaction|repost)))?$/.test(route)
    || route === '/pages/subscriptions/index'
    || route === '/pages/package-service/index'
    || route === '/pages/size-guide/index'
    || route === '/pages/care-guide/index';
  if (existingMember || memberOperation) loginReturn = route;
}

export function consumeMemberLoginReturn() {
  const route = loginReturn;
  loginReturn = '';
  return route;
}

export function rememberPendingTabLink(link) {
  pendingTabLink = {
    pageKey: link.pageKey,
    query: typeof link.query === 'string' ? link.query.slice(0, 256) : '',
  };
}

export function consumePendingTabLink(pageKey) {
  if (!pendingTabLink || pendingTabLink.pageKey !== pageKey) return null;
  const link = pendingTabLink;
  pendingTabLink = null;
  return link;
}

// Copyright 2026 青岛屿漠商贸有限公司. SPDX-License-Identifier: Apache-2.0
import { PRODUCTS, STORAGE_KEY, productById, createDemoState, quoteCart, reduceDemoState, restoreDemoState } from './demo-state.mjs';

const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
let language = 'zh';
let state = createDemoState();
try { language = localStorage.getItem('merchantkit.showcase.language') === 'en' ? 'en' : 'zh'; state = restoreDemoState(localStorage.getItem(STORAGE_KEY)); } catch { /* The same demo also works without storage. */ }
let view = 'shop';
let category = 'all';
let query = '';
let merchantFilter = 'all';
let checkoutOptions = { delivery: 'courier', useCoupon: true };
let toastTimer;
const t = (zh, en) => language === 'en' ? en : zh;
const escape = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll(String.fromCharCode(34), '&quot;').replaceAll("'", '&#39;');
const money = cents => new Intl.NumberFormat(language === 'en' ? 'en-CN' : 'zh-CN', { style: 'currency', currency: 'CNY', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const nameOf = product => language === 'en' ? product.nameEn : product.name;
const date = value => new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const totalItems = () => state.cart.reduce((sum, line) => sum + line.quantity, 0);
const paths = {
  shop: 'M3 10h18M5 10v11h14V10M2 10l3-7h14l3 7M9 21v-7h6v7',
  bag: 'M5 7h14l1 14H4L5 7ZM9 8V6a3 3 0 0 1 6 0v2',
  orders: 'M7 3h10l3 3v15H4V3h3Zm1 6h8M8 13h8M8 17h5',
  member: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21v-2a8 8 0 0 1 16 0v2',
  stock: 'm3 7 9-5 9 5-9 5-9-5Zm0 0v10l9 5 9-5V7M12 12v10',
  chevron: 'm9 5 7 7-7 7', close: 'm6 6 12 12M6 18 18 6',
  arrow: 'M4 12h16m-6-6 6 6-6 6', check: 'm5 12 4 4L19 6',
  plus: 'M12 5v14M5 12h14', minus: 'M5 12h14', search: 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  reset: 'M3 4v6h6M4 10a8 8 0 1 1 0 7', help: 'M9 9a3 3 0 1 1 5 2c-2 1-2 2-2 3M12 18h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
};
const icon = name => `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='${paths[name] || paths.orders}'/></svg>`;
const button = (label, action, values = '', kind = 'primary') => `<button class='button ${kind}' type='button' data-action='${action}' ${values}>${label}</button>`;
const statusName = status => ({ paid: t('待处理', 'To fulfil'), shipped: t('配送中', 'On its way'), ready: t('待自提', 'Ready for pickup'), completed: t('已完成', 'Completed'), refund_requested: t('申请退款', 'Refund requested'), refunded: t('已退款 · 订单结束', 'Refunded · Closed') })[status];
const tag = status => `<span class='status status-${status}'>${statusName(status)}</span>`;
const errors = {
  NOT_ENOUGH_STOCK: ['可用库存不足，请调整数量。', 'Not enough stock. Please update the quantity.'], EMPTY_CART: ['先添加一件商品。', 'Add an item first.'],
  INVALID_QUANTITY: ['请选择有效数量。', 'Choose a valid quantity.'], INVALID_TRANSITION: ['订单状态已变化，请重新查看。', 'The order has changed. Please check its current state.'],
  WRONG_PICKUP_CODE: ['取货码不正确，请核对。', 'The pickup code does not match.'], INVALID_STOCK: ['库存应为0至999的整数。', 'Stock must be a whole number from 0 to 999.'],
  INVALID_NAME: ['昵称需为1至40个字符。', 'Use a name between 1 and 40 characters.'], INVALID_PREFERENCES: ['请完成三个选项。', 'Please complete all three choices.'],
  DEMO_LIMIT: ['本次演示订单已满，请重新开始演示。', 'This demo is full. Start a fresh demo to continue.'], INVALID_PICKUP_CODE: ['取货码生成失败，请重试。', 'Could not create a pickup code. Please retry.'],
};

function toast(message) {
  const element = document.querySelector('#toast'); element.textContent = message; element.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('visible'), 3500);
}
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch { toast(t('浏览器未允许保存，本次演示仍可继续。', 'Storage is unavailable. The current demo still works.')); }
}
function apply(action, message) {
  try { state = reduceDemoState(state, action); persist(); render(); if (message) toast(message); return true; }
  catch (error) {
    const pair = errors[error.message];
    const message = pair ? t(...pair) : t('操作未完成，请重试。', 'Could not complete this action. Please retry.');
    if (modal.open) {
      let errorLabel = modal.querySelector('[role=alert]');
      if (!errorLabel) {
        errorLabel = document.createElement('p');
        errorLabel.className = 'inline-error';
        errorLabel.setAttribute('role', 'alert');
        (modal.querySelector('form') || modal).prepend(errorLabel);
      }
      errorLabel.textContent = message;
    }
    toast(message);
    return false;
  }
}
function navigate(next, updateUrl = true) {
  const allowed = ['shop', 'cart', 'orders', 'member', 'merchant-orders', 'inventory', 'members'];
  view = allowed.includes(next) ? next : 'shop';
  if (updateUrl) history.pushState(null, '', `#${view}`);
  render(); window.scrollTo({ top: 0, behavior: 'instant' }); document.querySelector('h1')?.focus({ preventScroll: true });
}
function openDialog(content) { modal.innerHTML = `<button class='dialog-close icon-button' data-action='close' type='button' aria-label='${t('关闭', 'Close')}'>${icon('close')}</button>${content}`; if (!modal.open) modal.showModal(); }
function closeDialog() { modal.close(); }
function navItem(id, glyph, label, badge = '') {
  return `<button type='button' class='nav-link ${view === id ? 'active' : ''}' data-action='navigate' data-view='${id}' ${view === id ? "aria-current='page'" : ''}>${icon(glyph)}<span>${label}</span>${badge ? `<span class='nav-count'>${badge}</span>` : ''}</button>`;
}

function render() {
  const activeFocus = document.activeElement?.getAttribute('data-focus-key');
  const merchant = ['merchant-orders', 'inventory', 'members'].includes(view);
  document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
  const nav = merchant
    ? navItem('merchant-orders', 'orders', t('订单处理', 'Orders')) + navItem('inventory', 'stock', t('商品库存', 'Inventory')) + navItem('members', 'member', t('会员概览', 'Member overview'))
    : navItem('shop', 'shop', t('选购商品', 'Browse')) + navItem('cart', 'bag', t('购物袋', 'Bag'), totalItems() || '') + navItem('orders', 'orders', t('我的订单', 'My orders')) + navItem('member', 'member', t('会员中心', 'Membership'));
  const contents = { shop: shopView, cart: cartView, orders: ordersView, member: memberView, 'merchant-orders': merchantView, inventory: inventoryView, members: membersView };
  app.innerHTML = `<div class='app-shell'>
    <aside class='sidebar'><a class='brand' href='#shop' aria-label='MerchantKit demo'><img src='./assets/mark.svg' width='38' height='38' alt=''><span>MerchantKit<small>${t('互动演示', 'Interactive demo')}</small></span></a>
      <p class='nav-heading'>${merchant ? t('商家工作台', 'Merchant workspace') : t('体验商店', 'Demo store')}</p><nav class='main-nav' aria-label='${t('主要导航', 'Main navigation')}'>${nav}</nav>
      <div class='sidebar-bottom'>${button(`${icon('help')}<span>${t('演示怎么玩', 'Demo guide')}</span>`, 'help', '', 'plain')}
      ${button(`${icon('reset')}<span>${t('重新开始演示', 'Start fresh')}</span>`, 'reset-open', '', 'plain')}<a href='https://github.com/HOWLIDAY222/wechat-commerce-kit' target='_blank' rel='noopener noreferrer'>${t('查看开源项目', 'View source on GitHub')}${icon('arrow')}</a></div>
    </aside>
    <div class='workspace'><header class='topbar'><span class='workspace-name'>${merchant ? t('商家工作台', 'Merchant desk') : t('日常选物', 'Everyday essentials')}</span><div class='topbar-actions'>
      <div class='perspective' aria-label='${t('切换演示视角', 'Demo perspective')}'>${button(t('顾客端', 'Customer'), 'navigate', "data-view='shop'", merchant ? 'switch' : 'switch selected')}${button(t('商家端', 'Merchant'), 'navigate', "data-view='merchant-orders'", merchant ? 'switch selected' : 'switch')}</div>
      ${button(language === 'en' ? '中文' : 'EN', 'language', `aria-label='${t('Switch to English', '切换到中文')}'`, 'language')}</div></header>
      <main id='content'><div class='demo-notice'><span class='notice-dot'></span>${t('交互演示：使用虚构商品，订单不会扣款。', 'Interactive demo · Fictional products. No real charges.')}</div>${contents[view]()}</main>
    </div><nav class='mobile-nav' aria-label='${t('移动端导航', 'Mobile navigation')}'>${nav}</nav></div>`;
  if (activeFocus) document.querySelector(`[data-focus-key='${CSS.escape(activeFocus)}']`)?.focus({ preventScroll: true });
}
function pageHeading(title, description, extra = '') {
  return `<div class='page-heading'><div><h1 tabindex='-1'>${title}</h1><p>${description}</p></div>${extra}</div>`;
}
function shopView() {
  const filtered = PRODUCTS.filter(product => (category === 'all' || product.category === category) && `${product.name} ${product.nameEn} ${product.categoryZh} ${product.categoryEn}`.toLowerCase().includes(query.toLowerCase()));
  return `${pageHeading(t('给日常，留一点好物。', 'Good things. Everyday.'), t('从选购开始，体验一笔订单的完整旅程。', 'Two essentials. One complete commerce journey.'))}
    <div class='catalog-toolbar'><div class='category-tabs' role='group' aria-label='${t('商品分类', 'Product categories')}'>${[['all', t('全部商品', 'All essentials')], ['carry', t('随身出行', 'On the go')], ['desk', t('桌面日常', 'At your desk')]].map(([id, label]) => button(label, 'category', `data-value='${id}' aria-pressed='${category === id}'`, category === id ? 'tab selected' : 'tab')).join('')}</div>
    <form id='search-form' class='search-field' role='search'>${icon('search')}<input name='query' type='search' aria-label='${t('搜索示例商品', 'Search demo products')}' placeholder='${t('搜索好物', 'Find an essential')}' value='${escape(query)}'><button type='submit'>${t('搜索', 'Search')}</button></form></div>
    <div class='product-grid'>${filtered.length ? filtered.map((product, index) => `<article class='product-card'><button class='product-photo' data-action='product' data-id='${product.id}' aria-label='${t('查看', 'View')} ${escape(nameOf(product))}'><img src='${product.image}' width='1254' height='1254' alt='${escape(nameOf(product))}' loading='${index === 0 ? 'eager' : 'lazy'}'></button><div class='product-meta'><div><p class='product-category'>${t(product.categoryZh, product.categoryEn)}</p><h2><button class='text-button' data-action='product' data-id='${product.id}'>${escape(nameOf(product))}</button></h2></div><strong>${money(product.priceCents)}</strong></div><p class='product-description'>${t(product.description, product.descriptionEn)}</p><div class='product-actions'><span>${t('可售', 'Available')} ${state.stock[product.id]}</span>${button(`${icon('plus')}${t('加入购物袋', 'Add to bag')}`, 'add', `data-id='${product.id}' data-focus-key='add-${product.id}' ${state.stock[product.id] <= 0 ? 'disabled' : ''}`, 'primary')}</div></article>`).join('') : emptyState('search', t('没有找到这件好物', 'No essentials found'), t('试试“帆布”或“笔记本”，也可以清空搜索。', 'Try tote or notebook, or clear your search.'), button(t('显示全部商品', 'Show all products'), 'clear-search'))}</div>
    <section class='journey-strip'><div>${icon('shop')}<span>${t('1. 选购与下单', '1. Browse & order')}</span></div><div>${icon('orders')}<span>${t('2. 切换商家处理', '2. Fulfil as merchant')}</span></div><div>${icon('member')}<span>${t('3. 查看订单与积分', '3. Track & earn')}</span></div>${button(t('查看演示指南', 'See the demo guide'), 'help', '', 'text')}</section>`;
}
function emptyState(glyph, title, description, action = '') {
  return `<section class='empty-state'><span class='empty-icon'>${icon(glyph)}</span><h2>${title}</h2><p>${description}</p>${action}</section>`;
}
function cartView() {
  const quote = quoteCart(state);
  return `${pageHeading(t('你的购物袋', 'Your shopping bag'), t('确认好物与数量，再完成模拟下单。', 'Check your essentials, then try the checkout.'))}${!quote.quantity ? emptyState('bag', t('购物袋还是空的', 'A little room for something good.'), t('挑选一件日用品，开始这次体验。', 'Choose an essential to start the demo.'), button(t('去选购', 'Browse essentials'), 'navigate', "data-view='shop'")) : `<div class='checkout-layout'><section class='surface bag-items'>${quote.lines.map(line => `<article class='bag-row'><img src='${line.product.image}' width='112' height='112' alt='${escape(nameOf(line.product))}'><div class='bag-item-info'><h2>${escape(nameOf(line.product))}</h2><p>${t(line.product.detail, line.product.detailEn)}</p><strong>${money(line.product.priceCents)}</strong><div class='quantity'><button data-action='quantity' data-id='${line.productId}' data-value='${line.quantity - 1}' aria-label='${t('减少', 'Decrease')} ${escape(nameOf(line.product))}'>${icon('minus')}</button><output aria-label='${t('数量', 'Quantity')}'>${line.quantity}</output><button data-action='quantity' data-id='${line.productId}' data-value='${line.quantity + 1}' aria-label='${t('增加', 'Increase')} ${escape(nameOf(line.product))}' ${line.quantity >= Math.min(20, line.available) ? 'disabled' : ''}>${icon('plus')}</button></div></div><div class='bag-row-total'><strong>${money(line.totalCents)}</strong>${button(t('移除', 'Remove'), 'quantity', `data-id='${line.productId}' data-value='0'`, 'text')}</div></article>`).join('')}</section><aside class='surface order-summary'><h2>${t('订单小计', 'Order summary')}</h2><dl><div><dt>${t('商品', 'Items')} · ${quote.quantity}</dt><dd>${money(quote.subtotalCents)}</dd></div><div><dt>${t('演示配送', 'Demo delivery')}</dt><dd>${t('免运费', 'Free')}</dd></div><div class='summary-total'><dt>${t('小计', 'Subtotal')}</dt><dd>${money(quote.subtotalCents)}</dd></div></dl>${quote.stockIssue ? `<p class='inline-error'>${t('库存已调整，请先减少数量。', 'Stock has changed. Reduce the quantity to continue.')}</p>` : ''}${button(`${t('去结算', 'Checkout')}${icon('arrow')}`, 'checkout-open', quote.stockIssue ? 'disabled' : '', 'primary full')}<p class='summary-footnote'>${state.couponUsedBy ? t('体验券已使用。', 'The demo coupon has been used.') : t('满100减10体验券，可在下一步使用。', 'A CNY 10 demo coupon applies to orders of CNY 100+.')}</p></aside></div>`}`;
}
function itemImages(order) {
  return order.items.map(item => { const product = productById(item.productId); return `<div class='order-item'><img src='${product.image}' width='64' height='64' alt=''><div><strong>${escape(nameOf(product))}</strong><p>${t(product.detail, product.detailEn)} · ×${item.quantity}</p></div><span>${money(item.unitPriceCents * item.quantity)}</span></div>`; }).join('');
}
function ordersView() {
  const orders = state.orders.filter(order => order.account === 'visitor');
  return `${pageHeading(t('我的订单', 'My orders'), t('顾客与商家视角共用同一份演示记录。', 'Customer and merchant views share the same demo records.'), button(t('切换商家处理', 'Open merchant desk'), 'navigate', "data-view='merchant-orders'", 'secondary'))}
    ${orders.length ? `<div class='order-list'>${orders.map(order => `<article class='surface order-card'><header><div><strong>${order.id}</strong><span>${date(order.createdAt)}</span></div>${tag(order.status)}</header><div class='order-items'>${itemImages(order)}</div>${order.delivery === 'pickup' ? `<div class='pickup-panel'><div><strong>${t('门店自提', 'Store pickup')}</strong><p>${t('演示自提点 · 示例路1号', 'Demo pickup point · 1 Sample Road')}</p></div>${['ready', 'completed'].includes(order.status) ? `<div class='pickup-code'><span>${t('取货码', 'Pickup code')}</span><strong data-testid='pickup-code'>${order.pickupCode}</strong></div>` : `<span>${t('备妥后显示取货码', 'Code appears when ready')}</span>`}</div>` : order.status === 'shipped' ? `<p class='delivery-note'>${t('演示物流单号', 'Demo tracking number')} · DEMO-EXPRESS-${order.id.slice(5)}</p>` : ''}<footer><div>${order.discountCents ? `<span>${t('体验券已抵扣', 'Demo coupon')} ${money(order.discountCents)}</span>` : ''}<strong>${t('合计', 'Total')} ${money(order.totalCents)}</strong></div><div class='order-actions'>${order.status === 'paid' ? button(t('申请退款', 'Request refund'), 'refund-request-open', `data-order='${order.id}'`, 'secondary') : ''}${order.status === 'shipped' ? button(t('确认收货', 'Confirm delivery'), 'confirm-delivery', `data-order='${order.id}'`) : ''}${order.status === 'completed' ? `<span class='completion-note'>${icon('check')}+${order.pointsAwarded} ${t('积分已到账', 'points earned')}</span>` : ''}${order.status === 'refunded' ? `<span class='completion-note'>${t('模拟退款完成', 'Simulated refund completed')}</span>` : ''}</div></footer></article>`).join('')}</div>` : emptyState('orders', t('第一笔订单，从这里开始', 'Your first order starts here.'), t('下单后可切换商家视角，处理这笔订单。', 'After checkout, switch to the merchant view to fulfil it.'), button(t('挑选商品', 'Browse essentials'), 'navigate', "data-view='shop'"))}`;
}
function memberView() {
  return `${pageHeading(t('你好，', 'Hello, ') + escape(state.member.name), t('体验积分、优惠券和偏好资料。', 'Try points, a welcome coupon, and member preferences.'))}<div class='member-layout'><section class='points-card'><span>${t('我的积分', 'Your points')}</span><strong>${state.member.points.toLocaleString()}</strong><p>${t('完成订单、完善资料，都能看到变化。', 'See your balance change as you complete the demo.')}</p><div><span>${t('体验会员', 'Demo membership')}</span>${icon('member')}</div></section><section class='coupon-card'><span>${t('新人体验券', 'Welcome coupon')}</span><div class='coupon-amount'>¥10</div><strong>${t('满100减10', 'CNY 10 off CNY 100')}</strong><p>${state.couponUsedBy ? t('已用于订单 ', 'Used on ') + state.couponUsedBy : t('下一次结算可选用', 'Available at checkout')}</p>${button(t('去看看好物', 'Explore the essentials'), 'navigate', "data-view='shop'", 'secondary')}</section></div>
    <section class='surface member-tasks'><h2>${t('让体验更完整', 'Make it yours')}</h2><div class='task-row'><span class='task-icon'>${icon('member')}</span><div><h3>${t('完善演示资料', 'Complete a demo profile')}</h3><p>${state.member.profileCompleted ? t('已领取40积分', '40 points already earned') : t('设置一个演示昵称', 'Choose a fictional display name')}</p></div><strong>+40</strong>${button(state.member.profileCompleted ? t('编辑', 'Edit') : t('去设置', 'Set up'), 'profile-open', '', 'secondary')}</div><div class='task-row'><span class='task-icon'>${icon('shop')}</span><div><h3>${t('选择购物偏好', 'Set your preferences')}</h3><p>${state.member.preferencesCompleted ? t('已领取60积分', '60 points already earned') : t('用途、风格与预算', 'Use, style, and budget')}</p></div><strong>+60</strong>${button(state.member.preferencesCompleted ? t('编辑', 'Edit') : t('去选择', 'Choose'), 'preferences-open', '', 'secondary')}</div></section>`;
}
function merchantActions(order) {
  const attr = `data-order='${order.id}'`;
  if (order.status === 'paid') return order.delivery === 'pickup' ? button(t('通知可取货', 'Mark ready'), 'prepare', attr) : button(t('模拟发货', 'Simulate shipment'), 'ship-open', attr);
  if (order.status === 'ready') return button(t('核销取货码', 'Verify pickup'), 'pickup-open', attr);
  if (order.status === 'refund_requested') return button(t('审核退款', 'Review refund'), 'refund-approve-open', attr);
  return `<span class='muted'>${order.status === 'shipped' ? t('等待顾客收货', 'Awaiting delivery') : t('已结束', 'Closed')}</span>`;
}
function merchantView() {
  const waiting = state.orders.filter(order => ['paid', 'ready', 'shipped'].includes(order.status)).length;
  const refunds = state.orders.filter(order => order.status === 'refund_requested').length;
  const revenue = state.orders.filter(order => order.status !== 'refunded').reduce((sum, order) => sum + order.totalCents, 0);
  const orders = state.orders.filter(order => merchantFilter === 'all' || order.status === merchantFilter);
  return `${pageHeading(t('把每一笔订单，处理妥当。', 'A little care. Every order.'), t('这里的操作会立即反映到顾客端。', 'Your actions appear immediately in the customer view.'))}<section class='metrics'><div><span>${t('待履约', 'To fulfil')}</span><strong>${waiting}</strong></div><div><span>${t('待退款审核', 'Refund requests')}</span><strong>${refunds}</strong></div><div><span>${t('模拟成交金额', 'Demo order value')}</span><strong>${money(revenue)}</strong></div></section>
    <section class='surface merchant-orders'><div class='section-toolbar'><h2>${t('订单列表', 'Order list')}</h2><label><span class='sr-only'>${t('筛选订单', 'Filter orders')}</span><select id='merchant-filter'>${[['all', t('全部订单', 'All orders')], ['paid', t('待处理', 'To fulfil')], ['ready', t('待自提', 'Ready for pickup')], ['refund_requested', t('申请退款', 'Refund requested')], ['completed', t('已完成', 'Completed')], ['refunded', t('已退款', 'Refunded')]].map(([key, label]) => `<option value='${key}' ${merchantFilter === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><div class='table-scroll'><table><thead><tr><th>${t('订单 / 顾客', 'Order / customer')}</th><th>${t('商品', 'Items')}</th><th>${t('金额', 'Total')}</th><th>${t('状态', 'Status')}</th><th>${t('操作', 'Action')}</th></tr></thead><tbody>${orders.map(order => `<tr><td><strong>${order.id}</strong><small>${order.account === 'sample' ? t('预置示例订单', 'Seeded sample order') : escape(state.member.name)} · ${order.delivery === 'pickup' ? t('自提', 'Pickup') : t('快递', 'Delivery')}</small></td><td><div class='table-product'><img src='${productById(order.items[0].productId).image}' width='48' height='48' alt=''><span>${escape(nameOf(productById(order.items[0].productId)))}<small>×${order.items[0].quantity}${order.items.length > 1 ? t(' · 共2款', ' · 2 products') : ''}</small></span></div></td><td class='nowrap'>${money(order.totalCents)}</td><td>${tag(order.status)}</td><td>${merchantActions(order)}</td></tr>`).join('')}</tbody></table></div>${!orders.length ? `<p class='table-empty'>${t('没有这个状态的订单。', 'No orders in this state.')}</p>` : ''}</section><section class='activity'><h2>${t('最近操作', 'Recent activity')}</h2>${state.activity.slice(0, 4).map(item => `<div><span class='activity-dot'></span><p>${activityLabel(item)}<small>${date(item.at)}</small></p>${item.orderId ? `<span>${item.orderId}</span>` : ''}</div>`).join('')}</section>`;
}
function activityLabel(item) {
  return ({ sample: t('已准备一笔示例订单', 'A sample order is ready'), paid: t('顾客完成模拟付款', 'Customer completed simulated payment'), shipped: t('商家已模拟发货', 'Merchant simulated a shipment'), ready: t('订单已备妥，可自提', 'Order marked ready for pickup'), completed: t('订单完成，积分到账', 'Order completed; points awarded'), refund_requested: t('顾客申请取消并退款', 'Customer requested a refund'), refunded: t('模拟退款完成，库存已返还', 'Simulated refund completed; stock restored'), profile: t('完善资料，获得40积分', 'Profile saved; 40 points earned'), preferences: t('保存偏好，获得60积分', 'Preferences saved; 60 points earned'), stock: t('商家调整了演示库存', 'Merchant updated demo stock') })[item.type];
}
function inventoryView() {
  return `${pageHeading(t('商品与库存', 'Products & inventory'), t('调整可售库存，再到顾客端核对。', 'Update available stock, then check the customer view.'))}<div class='inventory-list'>${PRODUCTS.map(product => `<article class='surface inventory-row'><img src='${product.image}' width='136' height='136' alt='${escape(nameOf(product))}'><div><p class='product-category'>${product.id.toUpperCase()}</p><h2>${escape(nameOf(product))}</h2><p>${t(product.detail, product.detailEn)}</p><strong>${money(product.priceCents)}</strong></div><form data-form='stock' data-id='${product.id}'><label for='stock-${product.id}'>${t('可售库存', 'Available stock')}</label><div><input id='stock-${product.id}' name='quantity' type='number' min='0' max='999' step='1' value='${state.stock[product.id]}' required>${button(t('保存库存', 'Save stock'), 'submit-stock', '', 'secondary')}</div></form></article>`).join('')}</div>`;
}
function membersView() {
  return `${pageHeading(t('会员概览', 'Member overview'), t('当前体验会员的资料和积分，与顾客端同步。', 'The current demo member, shared with the customer view.'))}<section class='surface member-overview'><div class='avatar'>${escape(state.member.name.slice(0, 1).toUpperCase())}</div><div><h2>${escape(state.member.name)}</h2><p>${t('当前体验会员', 'Current demo member')}</p></div><div class='member-balance'><strong>${state.member.points}</strong><span>${t('积分', 'points')}</span></div></section><section class='surface member-details'><h2>${t('资料与权益', 'Profile & benefits')}</h2><dl><div><dt>${t('演示资料', 'Demo profile')}</dt><dd>${state.member.profileCompleted ? t('已完善', 'Completed') : t('未设置', 'Not set')}</dd></div><div><dt>${t('购物偏好', 'Preferences')}</dt><dd>${state.member.preferencesCompleted ? t('已保存', 'Saved') : t('未设置', 'Not set')}</dd></div><div><dt>${t('体验优惠券', 'Demo coupon')}</dt><dd>${state.couponUsedBy ? t('已使用', 'Used') : t('可用 · 满100减10', 'Available · CNY 10 off 100')}</dd></div><div><dt>${t('演示订单', 'Demo orders')}</dt><dd>${state.orders.filter(order => order.account === 'visitor').length}</dd></div></dl></section>`;
}

function checkoutDialog() {
  const quote = quoteCart(state, checkoutOptions.useCoupon);
  openDialog(`<h2 id='dialog-title'>${t('完成这笔体验订单', 'Complete your demo order')}</h2><p class='dialog-intro'>${t('下方是虚构收件信息，无需填写真实资料。', 'Fictional delivery details. No personal information needed.')}</p><form data-form='checkout'><div class='demo-address'><strong>Alex · 13900000002</strong><p>${t('示例市 · 体验路1号（虚构地址）', '1 Sample Road, Demo City (fictional)')}</p></div><fieldset class='delivery-options'><legend>${t('交付方式', 'Delivery method')}</legend>${[['courier', t('快递配送', 'Delivery')], ['pickup', t('门店自提', 'Store pickup')]].map(([id, label]) => `<label><input type='radio' name='delivery' value='${id}' ${checkoutOptions.delivery === id ? 'checked' : ''}><span>${label}</span><small>${t('免运费', 'Free')}</small></label>`).join('')}</fieldset><label class='coupon-choice'><input name='coupon' type='checkbox' ${checkoutOptions.useCoupon && quote.couponEligible ? 'checked' : ''} ${quote.couponEligible ? '' : 'disabled'}><span>${t('使用满100减10体验券', 'Use CNY 10 off CNY 100 coupon')}</span></label>${!quote.couponEligible ? `<p class='muted coupon-reason'>${state.couponUsedBy ? t('体验券已使用', 'The demo coupon has been used') : t('商品小计满100元可使用', 'Available when the subtotal reaches CNY 100')}</p>` : ''}<dl class='checkout-breakdown'><div><dt>${t('商品小计', 'Subtotal')}</dt><dd>${money(quote.subtotalCents)}</dd></div><div><dt>${t('优惠券', 'Coupon')}</dt><dd id='checkout-discount'>−${money(quote.discountCents)}</dd></div><div class='summary-total'><dt>${t('模拟付款', 'Simulated payment')}</dt><dd id='checkout-total'>${money(quote.totalCents)}</dd></div></dl><button class='button primary full' type='submit'>${t('确认模拟付款', 'Confirm simulated payment')}${icon('arrow')}</button></form>`);
}
function generatePickupCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const code = Array.from(bytes, value => alphabet[value % alphabet.length]).join('');
    if (!state.orders.some(order => order.pickupCode === code)) return code;
  }
  throw Error('INVALID_PICKUP_CODE');
}
function confirmDialog(title, description, action, orderId, label) {
  openDialog(`<h2 id='dialog-title'>${title}</h2><p class='dialog-intro'>${description}</p><div class='dialog-actions'>${button(t('返回', 'Back'), 'close', '', 'secondary')}${button(label, action, `data-order='${orderId}'`)}</div>`);
}
function profileDialog() {
  openDialog(`<h2 id='dialog-title'>${t('设置演示昵称', 'Your demo profile')}</h2><p class='dialog-intro'>${t('首次保存获得40积分，之后修改不会重复赠分。', 'Earn 40 points on first save. Later edits do not award more.')}</p><form data-form='profile'><label class='field'>${t('演示昵称', 'Fictional display name')}<input name='name' value='${escape(state.member.name)}' minlength='1' maxlength='40' required autocomplete='off'></label><button class='button primary full' type='submit'>${t('保存资料', 'Save profile')}</button></form>`);
}
function preferencesDialog() {
  const prefs = state.member.preferences || { use: '', style: '', budget: '' };
  const select = (key, label, options) => `<label class='field'>${label}<select name='${key}' required><option value=''>${t('请选择', 'Choose one')}</option>${options.map(([id, zh, en]) => `<option value='${id}' ${prefs[key] === id ? 'selected' : ''}>${t(zh, en)}</option>`).join('')}</select></label>`;
  openDialog(`<h2 id='dialog-title'>${t('选一选，你的偏好', 'A few things you like')}</h2><p class='dialog-intro'>${t('首次保存获得60积分。', 'Earn 60 points on your first save.')}</p><form data-form='preferences'>${select('use', t('主要用途', 'Mostly for'), [['daily', '日常生活', 'Everyday'], ['travel', '外出旅行', 'Travel'], ['work', '工作学习', 'Work & study']])}${select('style', t('偏好的风格', 'Preferred style'), [['simple', '简洁轻量', 'Simple & light'], ['classic', '经典实用', 'Classic & practical'], ['colorful', '有一点色彩', 'A little colour']])}${select('budget', t('日常选购物品的预算', 'Usual budget'), [['under100', '100元以内', 'Under CNY 100'], ['100to300', '100至300元', 'CNY 100–300'], ['over300', '300元以上', 'Above CNY 300']])}<button class='button primary full' type='submit'>${t('保存偏好', 'Save preferences')}</button></form>`);
}

document.addEventListener('click', event => {
  const target = event.target.closest('button[data-action]');
  if (!target || target.disabled) return;
  const id = target.dataset.id, orderId = target.dataset.order;
  switch (target.dataset.action) {
    case 'navigate': navigate(target.dataset.view); break;
    case 'language': language = language === 'en' ? 'zh' : 'en'; try { localStorage.setItem('merchantkit.showcase.language', language); } catch { /* optional */ } render(); break;
    case 'category': category = target.dataset.value; render(); break;
    case 'clear-search': category = 'all'; query = ''; render(); break;
    case 'add': if (apply({ type: 'cart_add', productId: id }, t('已加入购物袋', 'Added to your bag')) && modal.open) closeDialog(); break;
    case 'quantity': apply({ type: 'cart_set', productId: id, quantity: Number(target.dataset.value) }); break;
    case 'close': closeDialog(); break;
    case 'product': { const product = productById(id); if (!product) break; openDialog(`<div class='product-dialog'><img src='${product.image}' width='1254' height='1254' alt='${escape(nameOf(product))}'><p class='product-category'>${t(product.categoryZh, product.categoryEn)}</p><h2 id='dialog-title'>${escape(nameOf(product))}</h2><p>${t(product.description, product.descriptionEn)}</p><p class='muted'>${t(product.detail, product.detailEn)}</p><div class='product-dialog-footer'><strong>${money(product.priceCents)}</strong>${button(t('加入购物袋', 'Add to bag'), 'add', `data-id='${id}' ${state.stock[id] <= 0 ? 'disabled' : ''}`)}</div></div>`); break; }
    case 'checkout-open': checkoutOptions = { delivery: 'courier', useCoupon: true }; checkoutDialog(); break;
    case 'prepare': apply({ type: 'prepare_pickup', orderId }, t('已标记可取货，顾客端显示取货码。', 'Ready for pickup. The customer can now see the code.')); break;
    case 'confirm-delivery': apply({ type: 'confirm_delivery', orderId }, t('订单完成，积分已到账。', 'Order complete. Points earned.')); break;
    case 'ship-open': confirmDialog(t('模拟发货', 'Simulate shipment'), t('这会把演示订单更新为配送中，不会创建真实运单。', 'This moves the demo order to delivery. No real shipment is created.'), 'ship-confirm', orderId, t('确认模拟发货', 'Confirm shipment')); break;
    case 'ship-confirm': if (apply({ type: 'ship_order', orderId }, t('已模拟发货', 'Simulated shipment created'))) closeDialog(); break;
    case 'pickup-open': openDialog(`<h2 id='dialog-title'>${t('核销取货码', 'Verify pickup')}</h2><p class='dialog-intro'>${orderId} · ${t('输入顾客端显示的8位取货码。', 'Enter the 8-character code from the customer view.')}</p><form data-form='pickup' data-order='${orderId}'><label class='field'>${t('取货码', 'Pickup code')}<input name='code' minlength='8' maxlength='8' pattern='[A-Za-z2-9]{8}' autocomplete='off' required></label><button type='submit' class='button primary full'>${t('确认核销', 'Verify & complete')}</button></form>`); break;
    case 'refund-request-open': confirmDialog(t('申请取消并退款', 'Request a refund'), t('订单未发货，可申请全额模拟退款。', 'The order has not shipped. Request a full simulated refund.'), 'refund-request-confirm', orderId, t('提交退款申请', 'Submit request')); break;
    case 'refund-request-confirm': if (apply({ type: 'request_refund', orderId }, t('退款申请已提交到商家端。', 'The request is now visible to the merchant.'))) closeDialog(); break;
    case 'refund-approve-open': { const order = state.orders.find(item => item.id === orderId); if (!order) break; confirmDialog(t('审核模拟退款', 'Review simulated refund'), `${orderId} · ${money(order.totalCents)}. ${t('确认后结束订单，并返还演示库存。', 'Completes the refund, closes the order, and restores demo stock.')}`, 'refund-approve-confirm', orderId, t('确认模拟退款', 'Confirm simulated refund')); break; }
    case 'refund-approve-confirm': if (apply({ type: 'approve_refund', orderId }, t('模拟退款完成，订单已结束。', 'Simulated refund complete. Order closed.'))) closeDialog(); break;
    case 'profile-open': profileDialog(); break;
    case 'preferences-open': preferencesDialog(); break;
    case 'submit-stock': target.closest('form').requestSubmit(); break;
    case 'help': openDialog(`<h2 id='dialog-title'>${t('用几分钟，走完一笔订单', 'One order. A few minutes.')}</h2><ol class='guide-steps'><li><strong>${t('选好物，模拟下单', 'Browse and check out')}</strong><p>${t('把两件商品加入购物袋，可试用满100减10体验券。', 'Add both products to try the CNY 10 demo coupon.')}</p></li><li><strong>${t('切换商家，处理订单', 'Switch to the merchant view')}</strong><p>${t('可模拟发货、标记自提备妥，或审核顾客的退款申请。', 'Simulate delivery, prepare pickup, or review a refund request.')}</p></li><li><strong>${t('回到顾客端，查看变化', 'Return to the customer view')}</strong><p>${t('查看取货码、确认收货，并在会员中心核对积分。', 'Check a pickup code, confirm delivery, and see your points.')}</p></li></ol><p class='guide-boundary'>${t('演示记录仅保存在当前浏览器，不连接真实商户、微信或支付服务。', 'Demo records stay in this browser. No real merchant, WeChat, or payment service is connected.')}</p><div class='dialog-actions'>${button(t('开始体验', 'Explore the demo'), 'close')}${button(t('重新开始演示', 'Start fresh'), 'reset-open', '', 'secondary')}</div>`); break;
    case 'reset-open': openDialog(`<h2 id='dialog-title'>${t('重新开始这次演示？', 'Start a fresh demo?')}</h2><p class='dialog-intro'>${t('当前浏览器的演示订单、购物袋和积分会恢复为初始示例。', 'Resets only this browser’s fictional orders, bag, and points.')}</p><div class='dialog-actions'>${button(t('保留记录', 'Keep records'), 'close', '', 'secondary')}${button(t('重新开始', 'Start fresh'), 'reset-confirm')}</div>`); break;
    case 'reset-confirm': state = createDemoState(); persist(); closeDialog(); navigate('shop'); toast(t('已恢复初始演示。', 'Fresh demo ready.')); break;
  }
});
document.addEventListener('submit', event => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  if (form.id !== 'search-form' && !form.dataset.form) return;
  event.preventDefault();
  const data = new FormData(form);
  if (form.id === 'search-form') { query = String(data.get('query') || '').trim().slice(0, 80); render(); return; }
  if (form.dataset.form === 'checkout') {
    let code;
    try { code = data.get('delivery') === 'pickup' ? generatePickupCode() : null; } catch { toast(t('请重试生成取货码。', 'Please retry generating a pickup code.')); return; }
    if (apply({ type: 'checkout', delivery: data.get('delivery'), useCoupon: data.has('coupon'), pickupCode: code })) { closeDialog(); navigate('orders'); toast(t('模拟付款成功，订单已创建。', 'Simulated payment successful. Order created.')); }
  }
  if (form.dataset.form === 'pickup' && apply({ type: 'collect_pickup', orderId: form.dataset.order, code: data.get('code') }, t('核销完成，订单已结束。', 'Pickup verified. Order complete.'))) closeDialog();
  if (form.dataset.form === 'stock') apply({ type: 'stock_set', productId: form.dataset.id, quantity: Number(data.get('quantity')) }, t('演示库存已更新。', 'Demo inventory updated.'));
  if (form.dataset.form === 'profile' && apply({ type: 'profile_save', name: data.get('name') }, t('资料已保存，积分已同步。', 'Profile saved. Points are up to date.'))) closeDialog();
  if (form.dataset.form === 'preferences' && apply({ type: 'preferences_save', preferences: { use: data.get('use'), style: data.get('style'), budget: data.get('budget') } }, t('偏好已保存，积分已同步。', 'Preferences saved. Points are up to date.'))) closeDialog();
});
document.addEventListener('change', event => {
  const element = event.target;
  if (element.id === 'merchant-filter') { merchantFilter = element.value; render(); }
  if (element.closest('[data-form=checkout]')) {
    const form = element.closest('form'), data = new FormData(form), quote = quoteCart(state, data.has('coupon'));
    checkoutOptions = { delivery: data.get('delivery'), useCoupon: data.has('coupon') };
    document.querySelector('#checkout-total').textContent = money(quote.totalCents);
    document.querySelector('#checkout-discount').textContent = `−${money(quote.discountCents)}`;
  }
});
window.addEventListener('popstate', () => navigate(location.hash.slice(1), false));
window.addEventListener('hashchange', () => { if (location.hash !== '#content') navigate(location.hash.slice(1), false); });
window.addEventListener('storage', event => { if (event.key === STORAGE_KEY) { state = restoreDemoState(event.newValue); render(); } });
navigate(location.hash.slice(1), false);

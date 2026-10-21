import { formatMoney } from '../utils/money';
import { selectedStyle, totalForQuantity, unitForStyle } from '../utils/pricing';

export function productPriceView(product, selection, wallet = [], walletStatus = 'guest', now = Date.now()) {
  const quantity = selection.quantity;
  const unit = unitForStyle(product, selection.selectedStyle, selection.variant?.priceCents);
  const subtotal = unit * quantity;
  const bundleTotal = totalForQuantity(product, quantity, unit, selection.selectedStyle);
  const bundleDiscount = Math.max(0, subtotal - bundleTotal);
  let discount = bundleDiscount;
  let coupon = null;
  const eligible = walletStatus === 'ready' ? wallet.filter(item => {
    const starts = new Date(item.startsAt).getTime(), ends = new Date(item.endsAt).getTime();
    return item.status === 'AVAILABLE' && Number.isFinite(starts) && Number.isFinite(ends) && starts <= now && ends > now
      && Number.isSafeInteger(item.amountCents) && item.amountCents > 0
      && Number.isSafeInteger(item.minimumCents) && item.minimumCents >= 0 && subtotal >= item.minimumCents
      && Array.isArray(item.productIds) && (!item.productIds.length || item.productIds.includes(product.id));
  }).sort((a, b) => Number(Boolean(b.newcomerOnly))-Number(Boolean(a.newcomerOnly)) || new Date(a.endsAt).getTime() - new Date(b.endsAt).getTime() || String(a.id).localeCompare(String(b.id))) : [];
  for (const candidate of eligible) {
    const amount = Math.min(candidate.amountCents, Math.max(0, subtotal - 1));
    // Match checkout: use one coupon only when it beats the combination price.
    if (amount > discount) { coupon = candidate; discount = amount; }
  }
  const kind = coupon ? 'coupon' : bundleDiscount ? 'bundle' : 'single';
  const payable = subtotal - discount;
  const savingLabel = discount ? '已省 ' + formatMoney(discount) : '';
  const strategyLabel = coupon ? '使用已领优惠券' : bundleDiscount ? '组合优惠已计入' : '按所选数量计价';
  return {
    kind, hasSaving: discount > 0, strategyLabel,
    subtotalCents: subtotal, discountCents: discount, payableCents: payable,
    subtotalLabel: formatMoney(subtotal), discountLabel: formatMoney(discount), payableLabel: formatMoney(payable),
    discountTitle: coupon ? '优惠券' : bundleDiscount ? '组合优惠' : '本次优惠',
    summaryDetail: quantity + ' 条 · ' + (savingLabel || '查看计算明细'), savingLabel,
    couponTitle: coupon?.title || '', couponId: coupon?.id || '',
    strategyNote: coupon ? '已按这张券计算，组合优惠本次不叠加。'
      : bundleDiscount ? (eligible.length ? '已采用组合优惠，优惠券保留供下次使用。' : '组合优惠已自动计入。') : '按单条售价计算当前数量。',
    walletMessage: walletStatus === 'loading' ? '正在核对已领优惠券…' : walletStatus === 'error' ? '优惠券暂未同步，可重试或在结算页核对。'
      : walletStatus === 'guest' ? '登录后可核对已领优惠券。' : eligible.length ? '已核对当前选购可用的已领优惠券。' : '当前选购暂无可用优惠券。',
    bundles: kind === 'bundle' ? bundleRows(product, selection.selectedStyle, quantity, unit) : [],
  };
}

function bundleRows(product, styleKey, quantity, unit) {
  if (!product.quantityPricing?.repeatBundles) return [{ label: quantity + ' 条装', amountLabel: formatMoney(totalForQuantity(product, quantity, unit, styleKey)) }];
  const style = selectedStyle(product, styleKey);
  const choices = [{ quantity: 1, totalPriceCents: unit }, ...(style?.tiers ?? product.quantityPricing.tiers ?? [])]
    .filter(item => Number.isInteger(item.quantity) && item.quantity > 0 && Number.isSafeInteger(item.totalPriceCents) && item.totalPriceCents > 0)
    .sort((a, b) => b.quantity - a.quantity);
  const costs = new Map();
  const cost = count => {
    if (!costs.has(count)) costs.set(count, totalForQuantity(product, count, unit, styleKey));
    return costs.get(count);
  };
  const groups = new Map();
  for (let remaining = quantity; remaining > 0;) {
    const choice = choices.find(item => item.quantity <= remaining && cost(remaining - item.quantity) + item.totalPriceCents === cost(remaining));
    if (!choice) return [];
    const row = groups.get(choice.quantity) || { quantity: choice.quantity, count: 0, total: 0 };
    row.count++; row.total += choice.totalPriceCents; groups.set(choice.quantity, row);
    remaining -= choice.quantity;
  }
  return [...groups.values()].map(item => ({ label: item.quantity + ' 条装 × ' + item.count, amountLabel: formatMoney(item.total) }));
}

const definitions = [
  ['new_product', 'brand'], ['restock', 'brand'], ['campaign', 'brand'],
  ['order_shipped', 'order'], ['after_sales', 'order'],
];
const groups = { new_product: 'brand', restock: 'brand', campaign: 'brand', order_shipped: 'order', after_sales: 'order' };
const templatePattern = /^[A-Za-z0-9_-]{10,160}$/;
const channelNames = { new_product: '上新', restock: '补货', campaign: '活动', order_shipped: '发货', after_sales: '售后' };
const channelDescriptions = { new_product: '品牌发布新品与系列消息时提醒', restock: '品牌发布商品补货消息时提醒', campaign: '品牌发布活动消息时提醒', order_shipped: '接收与你订单相关的发货提醒', after_sales: '了解售后申请的新进展' };
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const revision = value => Number.isSafeInteger(value) && value >= 0;

export function readSubscriptionResponse(value) {
  if (!object(value) || value.ok !== true || !revision(value.settingsRevision) || !revision(value.preferenceRevision)
    || typeof value.authenticated !== 'boolean' || typeof value.canSubscribe !== 'boolean'
    || value.canSubscribe && !value.authenticated || !Array.isArray(value.channels) || value.channels.length !== definitions.length) throw Error('SUBSCRIPTION_RESPONSE_INVALID');
  const seen = new Set(), templates = new Set();
  const channels = value.channels.map(row => {
    if (!object(row) || !Object.prototype.hasOwnProperty.call(groups, row.key) || seen.has(row.key) || row.group !== groups[row.key]
      || typeof row.title !== 'string' || !row.title.trim() || row.title.length > 100
      || typeof row.description !== 'string' || row.description.length > 300
      || typeof row.available !== 'boolean' || typeof row.enabled !== 'boolean' || !revision(row.remaining)
      || row.templateId !== null && (typeof row.templateId !== 'string' || !templatePattern.test(row.templateId))
      || row.available !== !!row.templateId || row.templateId && templates.has(row.templateId)
      || !value.authenticated && (row.enabled || row.remaining > 0)) throw Error('SUBSCRIPTION_RESPONSE_INVALID');
    seen.add(row.key); if (row.templateId) templates.add(row.templateId);
    return { key: row.key, group: row.group, title: row.title, description: row.description, available: row.available, enabled: row.enabled, remaining: row.remaining, templateId: row.templateId };
  });
  return { ok: true, settingsRevision: value.settingsRevision, preferenceRevision: value.preferenceRevision, authenticated: value.authenticated, canSubscribe: value.canSubscribe, channels };
}

export function subscriptionPresentation(value, selection = {}) {
  if (!value) return { channels: [], brandChannels: [], orderChannels: [], channelGroups: [], managementChannels: [], availableCount: 0, receivingCount: 0, needsPermissionCount: 0, brandSelectedCount: 0, orderSelectedCount: 0, summaryLabel: '', valueIntro: '', brandReady: false, orderReady: false, canSubscribe: false, loggedIn: false, preferenceRevision: 0 };
  const overview = readSubscriptionResponse(value);
  const channels = overview.channels.map(row => ({ ...row,
    description: channelDescriptions[row.key] || row.description,
    selected: selection[row.key] === undefined ? row.available : selection[row.key] === true,
    receiving: row.available && row.enabled && row.remaining > 0,
    shortTitle: channelNames[row.key] || row.title,
    canManageSwitch: row.available && row.remaining > 0,
    canDisablePreference: row.enabled && (!row.available || row.remaining === 0),
    stateLabel: !row.available ? '暂未开放' : row.enabled && row.remaining > 0 ? '已开启' : '未开启',
  }));
  const availableCount = channels.filter(row => row.available).length;
  const receivingCount = channels.filter(row => row.receiving).length;
  const needsPermissionCount = channels.filter(row => row.available && row.enabled && row.remaining === 0).length;
  const brandChannels = channels.filter(row => row.group === 'brand'), orderChannels = channels.filter(row => row.group === 'order');
  const channelGroups = [['brand', '品牌动态', brandChannels], ['order', '订单与服务', orderChannels]].map(([key, title, rows]) => {
    const availableCount = rows.filter(row => row.available).length, selectedCount = rows.filter(row => row.available && row.selected).length;
    return { key, title, rows, availableCount, selectedCount, ready: selectedCount > 0,
      buttonLabel: !availableCount ? '暂未开放' : `开启${key === 'brand' ? '品牌' : '订单'}提醒（${selectedCount}项）` };
  });
  const valueNames = { new_product: '新品上架', restock: '商品补货', campaign: '品牌活动' };
  const brandValues = brandChannels.filter(row => row.available).map(row => valueNames[row.key] || row.title);
  const orderValues = orderChannels.filter(row => row.available).map(row => row.title);
  const valueIntro = brandValues.length ? `${brandValues.join('、')}，选择你想知道的消息。` : orderValues.length ? `${orderValues.join('、')}，按需选择提醒。` : '当前暂无开放的提醒，可以稍后回来查看。';
  return { channels, brandChannels, orderChannels, channelGroups, availableCount, receivingCount, needsPermissionCount,
    brandSelectedCount: channelGroups[0].selectedCount, orderSelectedCount: channelGroups[1].selectedCount,
    managementChannels: channels.filter(row => row.enabled || row.available && row.remaining > 0), valueIntro,
    summaryLabel: overview.authenticated ? `${availableCount}类可选 · 已开启${receivingCount}类` : `当前开放${availableCount}类提醒`,
    brandReady: channels.some(row => row.group === 'brand' && row.available && row.selected), orderReady: channels.some(row => row.group === 'order' && row.available && row.selected),
    canSubscribe: overview.canSubscribe, loggedIn: overview.authenticated, preferenceRevision: overview.preferenceRevision };
}

export function subscriptionReceiptFeedback(receipt, value) {
  const valid = readSubscriptionReceipt(receipt), overview = readSubscriptionResponse(value);
  if (!valid) throw Error('SUBSCRIPTION_INPUT_INVALID');
  const titles = rows => rows.map(row => channelNames[row.channel] || overview.channels.find(channel => channel.key === row.channel)?.title).filter(Boolean).join('、');
  const receiving = valid.results.filter(row => { const channel = overview.channels.find(item => item.key === row.channel); return channel?.available && channel.enabled && channel.remaining > 0; });
  const inactive = valid.results.filter(row => !receiving.includes(row));
  const parts = [];
  if (receiving.length) parts.push(`已开启：${titles(receiving)}。`);
  if (inactive.length) parts.push(`未开启：${titles(inactive)}。`);
  return parts.join('\n');
}

export function readSubscriptionReceipt(value) {
  if (!object(value) || typeof value.requestId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(value.requestId)
    || !revision(value.expectedRevision) || !Array.isArray(value.results) || value.results.length < 1 || value.results.length > 3) return null;
  const seen = new Set(), templates = new Set(), results = [];
  for (const row of value.results) {
    if (!object(row) || !Object.prototype.hasOwnProperty.call(groups, row.channel) || seen.has(row.channel) || templates.has(row.templateId)
      || typeof row.templateId !== 'string' || !templatePattern.test(row.templateId) || !['accept', 'reject', 'ban'].includes(row.status)) return null;
    seen.add(row.channel); templates.add(row.templateId);
    results.push({ channel: row.channel, templateId: row.templateId, status: row.status });
  }
  return { requestId: value.requestId, expectedRevision: value.expectedRevision, results };
}

export function nativeReceipt(channels, nativeResult, requestId, expectedRevision) {
  const results = channels.flatMap(row => ['accept', 'reject', 'ban'].includes(nativeResult?.[row.templateId]) ? [{ channel: row.key, templateId: row.templateId, status: nativeResult[row.templateId] }] : []);
  return results.length ? readSubscriptionReceipt({ requestId, expectedRevision, results }) : null;
}

export function subscriptionError(error) {
  const code = error?.message || '';
  const messages = {
    AUTH_REQUIRED: '请先登录，再设置订阅提醒。', SESSION_CHANGED: '账户已变化，请重新进入订阅页面。',
    SUBSCRIPTION_ACCOUNT_LINK_REQUIRED: '请先完成账户关联，再设置订阅提醒。',
    SUBSCRIPTION_WECHAT_UNSUPPORTED: '当前微信版本暂不支持此功能，请更新微信后重试。',
    SUBSCRIPTION_REVISION_CONFLICT: '提醒设置已经更新，请刷新后重新确认。',
    SUBSCRIPTION_REQUEST_CONFLICT: '这次授权记录需要重新核对，请刷新后重试。',
    SUBSCRIPTION_TEMPLATE_CHANGED: '提醒模板已更新，请刷新后重新授权。',
    SUBSCRIPTION_RATE_LIMITED: '今天的授权操作较多，请稍后再试。',
    SUBSCRIPTION_RESPONSE_INVALID: '提醒设置暂时无法读取，请重新加载。',
    SUBSCRIPTION_SELECTION_INVALID: '请选择当前可用的提醒后再授权。',
  };
  if (messages[code]) return messages[code];
  if (/cancel|deny|reject/i.test(error?.errMsg || code)) return '这次未开启提醒，你可以随时回来设置。';
  return '提醒设置暂时无法更新，请稍后重试。';
}

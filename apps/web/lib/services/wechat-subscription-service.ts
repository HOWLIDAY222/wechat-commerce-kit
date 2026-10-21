import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import { appConfig } from "@/lib/config";
import { defaultSubscriptionSettings, isSubscriptionChannel, parseSubscriptionReceipt, parseSubscriptionSettings, safeSubscriptionPage,
  subscriptionChannels, subscriptionTemplateData, type SubscriptionChannelKey, type SubscriptionEvent, type SubscriptionRule, type SubscriptionSettings } from "@/lib/commerce/wechat-subscriptions";
import { getWeChatSubscriptionTemplates, sendWeChatSubscription } from "@/lib/providers/wechat-subscriptions";

type Reader = Pick<typeof prisma, "$queryRaw" | "$executeRaw">;
type Preferences = { enabledChannels: SubscriptionChannelKey[]; revision: number };
// Legacy commerce dates are UTC values in timestamp columns. This journal uses
// timestamptz; explicit UTC projections and ISO casts avoid the driver's local
// timezone conversion from changing eligibility or a displayed event time.
const SETTINGS = "main";
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
async function ready() {
  if (appConfig.COMMERCE_STORAGE !== "prisma") throw Error("SUBSCRIPTION_DATABASE_REQUIRED");
  const result = await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(*)::integer AS count FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('wechat_subscription_settings','wechat_subscription_preferences','wechat_subscription_receipts','wechat_subscription_grants','wechat_subscription_campaigns','wechat_subscription_deliveries')`;
  if (result[0]?.count !== 6) throw Error("SUBSCRIPTION_SCHEMA_REQUIRED");
}
async function actor(userId: string, owner = false) {
  const user = await prisma.user.findFirst({ where: { id: userId, status: "ACTIVE", role: { in: owner ? ["OWNER"] : ["ADMIN", "OWNER"] } }, select: { id: true } });
  if (!user) throw Error(owner ? "OWNER_REQUIRED" : "ADMIN_REQUIRED");
}
async function subscriptionUser(userId: string) {
  const user = await prisma.user.findFirst({ where: { id: userId, status: "ACTIVE" }, select: { id: true, phone: true, wechatIdentities: { where: { appId: appConfig.WECHAT_MINIPROGRAM_APP_ID }, select: { openId: true } } } });
  if (!user) throw Error("AUTH_REQUIRED");
  const openId = user.wechatIdentities[0]?.openId.trim() || "";
  return { canSubscribe: /^1[3-9]\d{9}$/.test(user.phone || "") && user.wechatIdentities.length === 1 && !!openId, openId };
}
export async function getSubscriptionSettings(reader: Reader = prisma): Promise<SubscriptionSettings> {
  if (reader === prisma) await ready();
  const rows = await reader.$queryRaw<Array<{ value: unknown; revision: number; updatedAt: Date }>>`SELECT value,revision,updated_at AT TIME ZONE 'UTC' AS "updatedAt" FROM wechat_subscription_settings WHERE id=${SETTINGS}`;
  if (!rows[0]) return defaultSubscriptionSettings();
  const parsed = parseSubscriptionSettings({ ...(rows[0].value as object), revision: rows[0].revision, updatedAt: rows[0].updatedAt.toISOString() });
  if (!parsed) throw Error("SUBSCRIPTION_CONFIG_INVALID"); return parsed;
}
async function preferences(userId: string, reader: Reader = prisma, lock = false): Promise<Preferences> {
  const rows = lock ? await reader.$queryRaw<Array<{ enabledChannels: SubscriptionChannelKey[]; revision: number }>>`SELECT enabled_channels AS "enabledChannels",revision FROM wechat_subscription_preferences WHERE user_id=${userId} FOR UPDATE`
    : await reader.$queryRaw<Array<{ enabledChannels: SubscriptionChannelKey[]; revision: number }>>`SELECT enabled_channels AS "enabledChannels",revision FROM wechat_subscription_preferences WHERE user_id=${userId}`;
  return rows[0] || { enabledChannels: [], revision: 0 };
}
export async function subscriptionOverview(userId?: string) {
  const settings = await getSubscriptionSettings();
  let prefs: Preferences = { enabledChannels: [], revision: 0 }, canSubscribe = false;
  let grants: Array<{ channel: string; templateId: string; count: number }> = [];
  if (userId) {
    canSubscribe = (await subscriptionUser(userId)).canSubscribe;
    [prefs, grants] = await Promise.all([preferences(userId), prisma.$queryRaw<typeof grants>`SELECT channel,template_id AS "templateId",count(*)::integer AS count FROM wechat_subscription_grants WHERE user_id=${userId} AND consumed_at IS NULL GROUP BY channel,template_id`]);
  }
  return { settingsRevision: settings.revision, preferenceRevision: prefs.revision, canSubscribe, authenticated: !!userId,
    channels: subscriptionChannels.map(info => { const rule = settings.channels.find(row => row.key === info.key)!;
      return { ...info, available: rule.enabled && !!rule.templateId, templateId: rule.enabled ? rule.templateId : null,
        enabled: prefs.enabledChannels.includes(info.key), remaining: grants.find(row => row.channel === info.key && row.templateId === rule.templateId)?.count || 0 };
    }) };
}
export async function updateSubscriptionPreferences(userId: string, enabledChannels: unknown, expectedRevision: unknown) {
  await ready(); if (!Array.isArray(enabledChannels) || enabledChannels.length > 5 || !enabledChannels.every(isSubscriptionChannel) || new Set(enabledChannels).size !== enabledChannels.length || !Number.isInteger(expectedRevision) || Number(expectedRevision) < 0) throw Error("SUBSCRIPTION_INPUT_INVALID");
  const account = await subscriptionUser(userId);
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO wechat_subscription_preferences(user_id) VALUES(${userId}) ON CONFLICT DO NOTHING`;
    const current = await preferences(userId, tx, true);
    if (current.revision !== expectedRevision) throw Error("SUBSCRIPTION_REVISION_CONFLICT");
    if (!account.canSubscribe && enabledChannels.some(channel => !current.enabledChannels.includes(channel))) throw Error("SUBSCRIPTION_ACCOUNT_LINK_REQUIRED");
    // Turning a switch on cannot create a WeChat grant. It only controls which
    // already-authorized notifications this application may attempt to send.
    await tx.$executeRaw`UPDATE wechat_subscription_preferences SET enabled_channels=${JSON.stringify(enabledChannels)}::jsonb,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=${userId}`;
  });
  return subscriptionOverview(userId);
}
export async function recordSubscriptionReceipt(userId: string, body: unknown) {
  await ready(); const input = parseSubscriptionReceipt(body); if (!input) throw Error("SUBSCRIPTION_INPUT_INVALID");
  if (!(await subscriptionUser(userId)).canSubscribe) throw Error("SUBSCRIPTION_ACCOUNT_LINK_REQUIRED");
  const settings = await getSubscriptionSettings();
  for (const row of input.results) { const rule = settings.channels.find(rule => rule.key === row.channel); if (!rule?.enabled || rule.templateId !== row.templateId) throw Error("SUBSCRIPTION_TEMPLATE_CHANGED"); }
  const hash = digest(input.results);
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO wechat_subscription_preferences(user_id) VALUES(${userId}) ON CONFLICT DO NOTHING`;
    const prefs = await preferences(userId, tx, true);
    const prior = await tx.$queryRaw<Array<{ payloadHash: string }>>`SELECT payload_hash AS "payloadHash" FROM wechat_subscription_receipts WHERE user_id=${userId} AND request_id=${input.requestId}`;
    if (prior[0]) { if (prior[0].payloadHash !== hash) throw Error("SUBSCRIPTION_REQUEST_CONFLICT"); return; }
    if (prefs.revision !== input.expectedRevision) throw Error("SUBSCRIPTION_REVISION_CONFLICT");
    const count = await tx.$queryRaw<Array<{ count: number }>>`SELECT count(*)::integer AS count FROM wechat_subscription_receipts WHERE user_id=${userId} AND created_at > CURRENT_TIMESTAMP-INTERVAL '24 hours'`;
    if ((count[0]?.count || 0) >= 100) throw Error("SUBSCRIPTION_RATE_LIMITED");
    await tx.$executeRaw`INSERT INTO wechat_subscription_receipts(user_id,request_id,payload_hash,results) VALUES(${userId},${input.requestId},${hash},${JSON.stringify(input.results)}::jsonb)`;
    const channels = new Set(prefs.enabledChannels);
    for (const row of input.results) if (row.status === "accept") {
      channels.add(row.channel);
      await tx.$executeRaw`INSERT INTO wechat_subscription_grants(id,user_id,channel,template_id,request_id) VALUES(${randomUUID()},${userId},${row.channel},${row.templateId},${input.requestId})`;
    }
    await tx.$executeRaw`UPDATE wechat_subscription_preferences SET enabled_channels=${JSON.stringify([...channels])}::jsonb,revision=revision+1,updated_at=CURRENT_TIMESTAMP WHERE user_id=${userId}`;
  });
  // Client receipts describe the native dialog result; they are not proof of
  // delivery permission. WeChat performs the authoritative check on every send.
  return subscriptionOverview(userId);
}
export async function adminSubscriptionOverview(actorId: string, refresh = false) {
  await actor(actorId); const settings = await getSubscriptionSettings();
  let templates: Awaited<ReturnType<typeof getWeChatSubscriptionTemplates>> = [], catalogError: string | null = null;
  try { templates = await getWeChatSubscriptionTemplates(refresh); } catch { catalogError = "微信模板暂时无法读取，请稍后刷新。"; }
  const campaigns = await prisma.$queryRaw<Array<{ id: string; channel: string; title: string; summary: string; page: string; status: string; createdAt: Date }>>`SELECT id,channel,title,summary,page,status,created_at AT TIME ZONE 'UTC' AS "createdAt" FROM wechat_subscription_campaigns ORDER BY created_at DESC LIMIT 30`;
  const deliveries = await prisma.$queryRaw<Array<{ state: string; count: number }>>`SELECT state,count(*)::integer AS count FROM wechat_subscription_deliveries GROUP BY state`;
  const users = await prisma.$queryRaw<Array<{ channel: string; users: number; credits: number }>>`SELECT g.channel,count(DISTINCT g.user_id)::integer AS users,count(*)::integer AS credits FROM wechat_subscription_grants g JOIN wechat_subscription_preferences p ON p.user_id=g.user_id WHERE g.consumed_at IS NULL AND p.enabled_channels ? g.channel GROUP BY g.channel`;
  return { settings, definitions: subscriptionChannels, templates, catalogError, campaigns, deliveries, audience: users };
}
export async function saveSubscriptionSettings(actorId: string, body: unknown) {
  await actor(actorId, true); await ready(); const parsed = parseSubscriptionSettings(body); if (!parsed) throw Error("SUBSCRIPTION_INPUT_INVALID");
  const catalog = await getWeChatSubscriptionTemplates(true);
  for (const rule of parsed.channels) if (rule.templateId) {
    const template = catalog.find(row => row.templateId === rule.templateId); if (!template) throw Error("SUBSCRIPTION_TEMPLATE_NOT_OWNED");
    if (rule.enabled && (rule.fields.length !== template.fields.length || template.fields.some(field => !rule.fields.some(row => row.key === field.key)))) throw Error("SUBSCRIPTION_TEMPLATE_FIELDS_INVALID");
    rule.templateTitle = template.title;
  }
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO wechat_subscription_settings(id,value,revision,updated_by) VALUES(${SETTINGS},${JSON.stringify(defaultSubscriptionSettings())}::jsonb,0,${actorId}) ON CONFLICT DO NOTHING`;
    const rows = await tx.$queryRaw<Array<{ revision: number }>>`SELECT revision FROM wechat_subscription_settings WHERE id=${SETTINGS} FOR UPDATE`;
    if (rows[0]?.revision !== parsed.revision) throw Error("SUBSCRIPTION_REVISION_CONFLICT");
    const before = await getSubscriptionSettings(tx); const now = new Date().toISOString();
    const channels = parsed.channels.map(rule => ({ ...rule, activatedAt: rule.enabled ? before.channels.find(old => old.key === rule.key && old.enabled && old.templateId === rule.templateId)?.activatedAt || now : null }));
    for (const rule of channels) if (!rule.enabled || before.channels.find(old => old.key === rule.key)?.templateId !== rule.templateId) {
      await tx.$executeRaw`UPDATE wechat_subscription_campaigns SET status='CANCELLED',updated_at=CURRENT_TIMESTAMP WHERE channel=${rule.key} AND status='QUEUED'`;
    }
    await tx.$executeRaw`UPDATE wechat_subscription_settings SET value=${JSON.stringify({ channels })}::jsonb,revision=revision+1,updated_by=${actorId},updated_at=CURRENT_TIMESTAMP WHERE id=${SETTINGS}`;
    await tx.auditLog.create({ data: { actorId, actorType: "admin", action: "wechat.subscriptions.settings", targetType: "wechat_subscription_settings", targetId: SETTINGS, detail: { beforeRevision: before.revision, channels: channels.map(rule => ({ key: rule.key, enabled: rule.enabled, templateId: rule.templateId })) } } });
    return getSubscriptionSettings(tx);
  });
}
export async function createSubscriptionCampaign(actorId: string, body: unknown) {
  await actor(actorId); await ready();
  const input = body as Record<string, unknown>;
  if (!input || !["new_product", "restock", "campaign"].includes(String(input.channel)) || typeof input.title !== "string" || !input.title.trim() || input.title.length > 100 || typeof input.summary !== "string" || !input.summary.trim() || input.summary.length > 200 || !safeSubscriptionPage(input.page)) throw Error("SUBSCRIPTION_INPUT_INVALID");
  const id = randomUUID();
  await prisma.$executeRaw`INSERT INTO wechat_subscription_campaigns(id,channel,title,summary,page,created_by) VALUES(${id},${input.channel as string},${input.title.trim()},${input.summary.trim()},${input.page},${actorId})`;
  return { id, status: "DRAFT" };
}
export async function queueSubscriptionCampaign(actorId: string, id: string, confirmation: unknown) {
  await actor(actorId, true); await ready(); if (confirmation !== id) throw Error("SUBSCRIPTION_CONFIRMATION_REQUIRED");
  await prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ channel: SubscriptionChannelKey; status: string; title: string; summary: string; page: string }>>`SELECT channel,status,title,summary,page FROM wechat_subscription_campaigns WHERE id=${id} FOR UPDATE`;
    if (!rows[0]) throw Error("SUBSCRIPTION_CAMPAIGN_NOT_FOUND"); if (rows[0].status !== "DRAFT") throw Error("SUBSCRIPTION_CAMPAIGN_NOT_DRAFT");
    const settings = await getSubscriptionSettings(tx); const rule = settings.channels.find(rule => rule.key === rows[0].channel);
    if (!rule?.enabled || !rule.templateId) throw Error("SUBSCRIPTION_CHANNEL_DISABLED");
    subscriptionTemplateData(rule, { key: id, channel: rows[0].channel, title: rows[0].title, summary: rows[0].summary, eventTime: new Date().toISOString(), page: rows[0].page });
    await tx.$executeRaw`UPDATE wechat_subscription_campaigns SET status='QUEUED',queued_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=${id}`;
    await tx.auditLog.create({ data: { actorId, actorType: "admin", action: "wechat.subscriptions.campaign.queued", targetType: "wechat_subscription_campaign", targetId: id, detail: { channel: rows[0].channel } } });
  });
  return { id, status: "QUEUED" };
}
export async function deliverSubscriptionEvent(event: SubscriptionEvent, limit = 10) {
  await ready(); const settings = await getSubscriptionSettings(); const rule = settings.channels.find(rule => rule.key === event.channel);
  if (!rule?.enabled || !rule.templateId || !safeSubscriptionPage(event.page)) return { sent: 0, skipped: 1, unknown: 0, rejected: 0 };
  const data = subscriptionTemplateData(rule, event);
  const audience = await prisma.$queryRaw<Array<{ userId: string }>>`SELECT DISTINCT g.user_id AS "userId" FROM wechat_subscription_grants g JOIN wechat_subscription_preferences p ON p.user_id=g.user_id JOIN users u ON u.id=g.user_id
    WHERE g.channel=${event.channel} AND g.template_id=${rule.templateId} AND g.consumed_at IS NULL AND p.enabled_channels ? ${event.channel} AND u.status='ACTIVE'
      AND u.phone ~ '^1[3-9][0-9]{9}$'
      AND (SELECT count(*)=1 AND bool_and(length(trim(w.open_id))>0) FROM wechat_identities w WHERE w.user_id=g.user_id AND w.app_id=${appConfig.WECHAT_MINIPROGRAM_APP_ID})
      AND (${event.userId || null}::text IS NULL OR g.user_id=${event.userId || null}) AND g.created_at <= ${event.eventTime}::timestamptz
      AND NOT EXISTS(SELECT 1 FROM wechat_subscription_deliveries d WHERE d.user_id=g.user_id AND d.channel=${event.channel} AND d.event_key=${event.key}) ORDER BY g.user_id LIMIT ${Math.min(10, Math.max(0, Math.trunc(limit)))}`;
  const report = { sent: 0, skipped: 0, unknown: 0, rejected: 0 };
  for (const person of audience) {
    const account = await subscriptionUser(person.userId); if (!account.canSubscribe) { report.skipped++; continue; }
    const deliveryId = randomUUID();
    const claimed = await prisma.$transaction(async tx => {
      const prefs = await preferences(person.userId, tx, true); if (!prefs.enabledChannels.includes(event.channel)) return false;
      const current = (await getSubscriptionSettings(tx)).channels.find(row => row.key === event.channel);
      if (!current?.enabled || current.templateId !== rule.templateId) return false;
      const grants = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM wechat_subscription_grants WHERE user_id=${person.userId} AND channel=${event.channel} AND template_id=${rule.templateId} AND consumed_at IS NULL AND created_at <= ${event.eventTime}::timestamptz ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!grants[0]) return false;
      const created = await tx.$executeRaw`INSERT INTO wechat_subscription_deliveries(id,user_id,channel,template_id,grant_id,event_key,state) VALUES(${deliveryId},${person.userId},${event.channel},${rule.templateId},${grants[0].id},${event.key},'SENDING') ON CONFLICT(user_id,channel,event_key) DO NOTHING`;
      if (!created) return false;
      await tx.$executeRaw`UPDATE wechat_subscription_grants SET consumed_at=CURRENT_TIMESTAMP WHERE id=${grants[0].id}`; return true;
    });
    if (!claimed) { report.skipped++; continue; }
    // Recheck application consent after the short claim transaction. An
    // in-flight provider request cannot be revoked after it has been accepted.
    if (!(await preferences(person.userId)).enabledChannels.includes(event.channel)) {
      await prisma.$executeRaw`UPDATE wechat_subscription_deliveries SET state='SKIPPED',error_code='UNSUBSCRIBED',finished_at=CURRENT_TIMESTAMP WHERE id=${deliveryId} AND state='SENDING'`; report.skipped++; continue;
    }
    try {
      await sendWeChatSubscription({ openId: account.openId, templateId: rule.templateId, page: event.page, data });
      await prisma.$executeRaw`UPDATE wechat_subscription_deliveries SET state='SENT',finished_at=CURRENT_TIMESTAMP WHERE id=${deliveryId} AND state='SENDING'`; report.sent++;
    } catch (error) {
      const code = error instanceof Error ? error.message.match(/WECHAT_SHIPPING_API_(\d+)$/)?.[1] : null;
      const state = code ? "REJECTED" : "UNKNOWN";
      await prisma.$executeRaw`UPDATE wechat_subscription_deliveries SET state=${state},error_code=${code ? `WECHAT_API_${code}` : "ACCEPTANCE_UNKNOWN"},finished_at=CURRENT_TIMESTAMP WHERE id=${deliveryId} AND state='SENDING'`;
      if (code === "43101") await prisma.$executeRaw`UPDATE wechat_subscription_grants SET consumed_at=CURRENT_TIMESTAMP WHERE user_id=${person.userId} AND template_id=${rule.templateId} AND consumed_at IS NULL`;
      if (code) report.rejected++; else report.unknown++;
    }
  }
  return report;
}
export async function runSubscriptionDeliveryBatch() {
  await ready();
  // Journal uncertainty rather than resending after a worker crash.
  await prisma.$executeRaw`UPDATE wechat_subscription_deliveries SET state='UNKNOWN',error_code='PROCESS_INTERRUPTED',finished_at=CURRENT_TIMESTAMP WHERE state='SENDING' AND attempt_started_at < CURRENT_TIMESTAMP-INTERVAL '10 minutes'`;
  const settings = await getSubscriptionSettings(); const report = { events: 0, sent: 0, skipped: 0, rejected: 0, unknown: 0 };
  let budget = 30;
  const add = async (event: SubscriptionEvent, eventBudget = 10) => {
    if (budget <= 0) return;
    const result = await deliverSubscriptionEvent(event, Math.min(10, budget, eventBudget)); report.events++;
    const used = result.sent + result.skipped + result.rejected + result.unknown;
    budget -= Math.max(1, used);
    for (const key of ["sent", "skipped", "rejected", "unknown"] as const) report[key] += result[key];
  };
  let campaignBudget = 10;
  const activeCampaignChannels = settings.channels.filter(rule => rule.enabled && rule.templateId).map(rule => rule.key);
  const campaigns = await prisma.$queryRaw<Array<{ id: string; channel: SubscriptionChannelKey; title: string; summary: string; page: string; queuedAt: Date }>>`SELECT id,channel,title,summary,page,queued_at AT TIME ZONE 'UTC' AS "queuedAt" FROM wechat_subscription_campaigns WHERE status='QUEUED' AND channel=ANY(${activeCampaignChannels}::text[]) ORDER BY queued_at LIMIT 5`;
  for (const row of campaigns) {
    if (campaignBudget <= 0) break;
    const beforeBudget = budget;
    await add({ key: `campaign:${row.id}`, channel: row.channel, title: row.title, summary: row.summary, eventTime: row.queuedAt.toISOString(), page: row.page }, campaignBudget);
    campaignBudget -= beforeBudget - budget;
    const rule = settings.channels.find(rule => rule.key === row.channel);
    if (rule?.enabled && rule.templateId) {
      const left = await prisma.$queryRaw<Array<{ count: number }>>`SELECT count(DISTINCT g.user_id)::integer AS count FROM wechat_subscription_grants g JOIN wechat_subscription_preferences p ON p.user_id=g.user_id JOIN users u ON u.id=g.user_id
        WHERE g.channel=${row.channel} AND g.template_id=${rule.templateId} AND g.consumed_at IS NULL AND p.enabled_channels ? ${row.channel} AND u.status='ACTIVE' AND g.created_at <= ${row.queuedAt.toISOString()}::timestamptz
          AND u.phone ~ '^1[3-9][0-9]{9}$'
          AND (SELECT count(*)=1 AND bool_and(length(trim(w.open_id))>0) FROM wechat_identities w WHERE w.user_id=g.user_id AND w.app_id=${appConfig.WECHAT_MINIPROGRAM_APP_ID})
          AND NOT EXISTS(SELECT 1 FROM wechat_subscription_deliveries d WHERE d.user_id=g.user_id AND d.channel=${row.channel} AND d.event_key=${`campaign:${row.id}`})`;
      if (!left[0]?.count) await prisma.$executeRaw`UPDATE wechat_subscription_campaigns SET status='COMPLETED',updated_at=CURRENT_TIMESTAMP WHERE id=${row.id} AND status='QUEUED'`;
    }
  }
  const shipping = settings.channels.find(row => row.key === "order_shipped");
  if (budget > 0 && shipping?.enabled && shipping.activatedAt) {
    const rows = await prisma.$queryRaw<Array<{ id: string; userId: string; orderNo: string; title: string; trackingNo: string; shippedAt: Date; amount: number }>>`SELECT s.id,o.user_id AS "userId",o.order_no AS "orderNo",COALESCE((SELECT product_name FROM order_items WHERE order_id=o.id ORDER BY id LIMIT 1),'订单商品') AS title,s.tracking_no AS "trackingNo",s.shipped_at AS "shippedAt",o.payable_amount_cents AS amount
      FROM shipments s JOIN orders o ON o.id=s.order_id WHERE s.status IN('SHIPPED','DELIVERED') AND (s.shipped_at AT TIME ZONE 'UTC') >= ${shipping.activatedAt}::timestamptz AND s.tracking_no IS NOT NULL AND o.payment_status='PAID'
        AND EXISTS(SELECT 1 FROM wechat_subscription_grants g JOIN wechat_subscription_preferences p ON p.user_id=g.user_id JOIN users u ON u.id=g.user_id WHERE g.user_id=o.user_id AND g.channel='order_shipped' AND g.template_id=${shipping.templateId} AND g.consumed_at IS NULL AND g.created_at <= (s.shipped_at AT TIME ZONE 'UTC') AND p.enabled_channels ? 'order_shipped' AND u.status='ACTIVE' AND u.phone ~ '^1[3-9][0-9]{9}$' AND (SELECT count(*)=1 AND bool_and(length(trim(w.open_id))>0) FROM wechat_identities w WHERE w.user_id=g.user_id AND w.app_id=${appConfig.WECHAT_MINIPROGRAM_APP_ID}))
        AND NOT EXISTS(SELECT 1 FROM wechat_subscription_deliveries d WHERE d.user_id=o.user_id AND d.channel='order_shipped' AND d.event_key='shipment:'||s.id) ORDER BY s.shipped_at LIMIT 10`;
    for (const row of rows) await add({ key: `shipment:${row.id}`, channel: "order_shipped", userId: row.userId, title: row.title, summary: "你的订单已发货", orderNo: row.orderNo, status: "已发货", trackingNo: row.trackingNo, amount: (row.amount / 100).toFixed(2), eventTime: row.shippedAt.toISOString(), page: `pages/order-detail/index?orderNo=${encodeURIComponent(row.orderNo)}` });
  }
  const afterSales = settings.channels.find(row => row.key === "after_sales");
  if (budget > 0 && afterSales?.enabled && afterSales.activatedAt) {
    const rows = await prisma.$queryRaw<Array<{ id: string; eventKey: string; afterSalesNo: string; userId: string; orderNo: string; status: string; updatedAt: Date }>>`SELECT a.id,'after-sales:'||a.id||':'||to_char(a.updated_at,'YYYYMMDDHH24MISS.MS') AS "eventKey",a.after_sales_no AS "afterSalesNo",a.user_id AS "userId",o.order_no AS "orderNo",a.status::text,a.updated_at AS "updatedAt" FROM after_sales_requests a JOIN orders o ON o.id=a.order_id
      WHERE (a.updated_at AT TIME ZONE 'UTC') >= ${afterSales.activatedAt}::timestamptz AND a.status NOT IN('SUBMITTED')
        AND EXISTS(SELECT 1 FROM wechat_subscription_grants g JOIN wechat_subscription_preferences p ON p.user_id=g.user_id JOIN users u ON u.id=g.user_id WHERE g.user_id=a.user_id AND g.channel='after_sales' AND g.template_id=${afterSales.templateId} AND g.consumed_at IS NULL AND g.created_at <= (a.updated_at AT TIME ZONE 'UTC') AND p.enabled_channels ? 'after_sales' AND u.status='ACTIVE' AND u.phone ~ '^1[3-9][0-9]{9}$' AND (SELECT count(*)=1 AND bool_and(length(trim(w.open_id))>0) FROM wechat_identities w WHERE w.user_id=g.user_id AND w.app_id=${appConfig.WECHAT_MINIPROGRAM_APP_ID}))
        AND NOT EXISTS(SELECT 1 FROM wechat_subscription_deliveries d WHERE d.user_id=a.user_id AND d.channel='after_sales' AND d.event_key='after-sales:'||a.id||':'||to_char(a.updated_at,'YYYYMMDDHH24MISS.MS'))
      ORDER BY a.updated_at DESC LIMIT 10`;
    for (const row of rows) await add({ key: row.eventKey, channel: "after_sales", userId: row.userId, title: "售后进度更新", summary: "你的售后申请有新进展", orderNo: row.orderNo, status: "有新进展", eventTime: row.updatedAt.toISOString(), page: `pages/after-sales-detail/index?afterSalesNo=${encodeURIComponent(row.afterSalesNo)}` });
  }
  return report;
}

export const subscriptionChannels = [
  { key: "new_product", title: "新品上新", group: "brand", description: "新品与系列上架时提醒你。" },
  { key: "restock", title: "商品补货", group: "brand", description: "补货信息发布时提醒你。" },
  { key: "campaign", title: "品牌活动", group: "brand", description: "已订阅的品牌活动开始时提醒你。" },
  { key: "order_shipped", title: "订单发货", group: "order", description: "你的订单发货后通知你。" },
  { key: "after_sales", title: "售后进度", group: "order", description: "你的售后申请有新进展时通知你。" },
] as const;
export type SubscriptionChannelKey = typeof subscriptionChannels[number]["key"];
export type SubscriptionMapping = "title" | "summary" | "eventTime" | "orderNo" | "status" | "trackingNo" | "amount";
export type SubscriptionField = { key: string; label: string; source: SubscriptionMapping; literal?: string };
export type SubscriptionRule = { key: SubscriptionChannelKey; enabled: boolean; templateId: string | null; templateTitle: string; fields: SubscriptionField[]; activatedAt: string | null };
export type SubscriptionSettings = { channels: SubscriptionRule[]; revision: number; updatedAt: string | null };
export type SubscriptionTemplate = { templateId: string; title: string; content: string; type: number; fields: Array<{ key: string; label: string }> };
export type SubscriptionEvent = { key: string; channel: SubscriptionChannelKey; userId?: string; title: string; summary: string; eventTime: string; orderNo?: string; status?: string; trackingNo?: string; amount?: string; page: string };
const channelKeys = new Set<string>(subscriptionChannels.map(row => row.key));
const sources = new Set(["title", "summary", "eventTime", "orderNo", "status", "trackingNo", "amount"]);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function defaultSubscriptionSettings(): SubscriptionSettings {
  return { channels: subscriptionChannels.map(row => ({ key: row.key, enabled: false, templateId: null, templateTitle: "", fields: [], activatedAt: null })), revision: 0, updatedAt: null };
}
export function isSubscriptionChannel(value: unknown): value is SubscriptionChannelKey { return typeof value === "string" && channelKeys.has(value); }
export function parseSubscriptionSettings(value: unknown): SubscriptionSettings | null {
  if (!record(value) || !Number.isInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.channels) || value.channels.length !== subscriptionChannels.length) return null;
  const seen = new Set<string>(); const templateIds = new Set<string>(); const channels: SubscriptionRule[] = [];
  for (const row of value.channels) {
    if (!record(row) || !isSubscriptionChannel(row.key) || seen.has(row.key) || typeof row.enabled !== "boolean" || !Array.isArray(row.fields) || row.fields.length > 10) return null;
    seen.add(row.key);
    const templateId = row.templateId === null || row.templateId === "" ? null : typeof row.templateId === "string" && /^[A-Za-z0-9_-]{10,160}$/.test(row.templateId) ? row.templateId : undefined;
    if (templateId === undefined || row.enabled && !templateId || templateId && templateIds.has(templateId)) return null;
    if (templateId) templateIds.add(templateId);
    const fields: SubscriptionField[] = []; const fieldKeys = new Set<string>();
    for (const f of row.fields) {
      if (!record(f) || typeof f.key !== "string" || !/^(?:thing|time|date|amount|number|character_string|phrase|phone_number|car_number|website)\d+$/.test(f.key) || fieldKeys.has(f.key) || typeof f.label !== "string" || f.label.length > 80 || !sources.has(String(f.source)) || f.literal !== undefined && (typeof f.literal !== "string" || f.literal.length > 100)) return null;
      fieldKeys.add(f.key); fields.push({ key: f.key, label: f.label, source: f.source as SubscriptionMapping, ...(typeof f.literal === "string" ? { literal: f.literal.trim() } : {}) });
    }
    if (row.enabled && !fields.length) return null;
    channels.push({ key: row.key, enabled: row.enabled, templateId, templateTitle: typeof row.templateTitle === "string" ? row.templateTitle.slice(0, 100) : "", fields, activatedAt: typeof row.activatedAt === "string" && Number.isFinite(Date.parse(row.activatedAt)) ? row.activatedAt : null });
  }
  return { channels, revision: Number(value.revision), updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : null };
}
export function parseTemplate(value: unknown): SubscriptionTemplate | null {
  if (!record(value) || typeof value.priTmplId !== "string" || typeof value.title !== "string" || typeof value.content !== "string") return null;
  const fields = value.content.split(/\r?\n/).flatMap(line => {
    const key = line.match(/\{\{\s*([a-z_]+\d+)\.DATA\s*\}\}/)?.[1];
    return key ? [{ key, label: line.split(/[:：]/)[0]?.trim().slice(0, 80) || key }] : [];
  });
  return fields.length ? { templateId: value.priTmplId, title: value.title, content: value.content, type: Number(value.type) || 0, fields } : null;
}
export function safeSubscriptionPage(value: unknown): value is string {
  return typeof value === "string" && value.length <= 240 && /^pages\/(?:home\/home|products\/index|product-detail\/index|member\/index|member-earn\/index|orders\/index|order-detail\/index|after-sales-detail\/index)(?:\?[A-Za-z0-9_.~%=&+-]+)?$/.test(value);
}
export function subscriptionTemplateData(rule: SubscriptionRule, event: SubscriptionEvent) {
  const data: Record<string, { value: string }> = {};
  for (const field of rule.fields) {
    const raw = field.literal || event[field.source] || "";
    let value = String(raw).replace(/[\r\n\t]/g, " ").trim();
    if (field.key.startsWith("time") || field.key.startsWith("date")) {
      const date = new Date(raw); if (!Number.isFinite(date.getTime())) throw Error("SUBSCRIPTION_FIELD_INVALID");
      value = new Date(date.getTime() + 8 * 3600000).toISOString().slice(0, field.key.startsWith("date") ? 10 : 16).replace("T", " ");
    }
    const maximum = field.key.startsWith("thing") ? 20 : field.key.startsWith("phrase") ? 5 : field.key.startsWith("character_string") ? 32 : 100;
    if (!value) throw Error("SUBSCRIPTION_FIELD_MISSING");
    if (field.key.startsWith("number") && !/^\d+(?:\.\d+)?$/.test(value)) throw Error("SUBSCRIPTION_FIELD_INVALID");
    if (field.key.startsWith("amount") && !/^[¥￥]?\d+(?:\.\d{1,2})?(?:元)?$/.test(value)) throw Error("SUBSCRIPTION_FIELD_INVALID");
    data[field.key] = { value: Array.from(value).slice(0, maximum).join("") };
  }
  return data;
}
export function parseSubscriptionReceipt(value: unknown) {
  if (!record(value) || typeof value.requestId !== "string" || !/^[A-Za-z0-9_-]{16,80}$/.test(value.requestId) || !Number.isInteger(value.expectedRevision) || Number(value.expectedRevision) < 0 || !Array.isArray(value.results) || value.results.length < 1 || value.results.length > 3) return null;
  const seen = new Set<string>(); const results: Array<{ channel: SubscriptionChannelKey; templateId: string; status: "accept" | "reject" | "ban" }> = [];
  for (const row of value.results) {
    if (!record(row) || !isSubscriptionChannel(row.channel) || seen.has(row.channel) || typeof row.templateId !== "string" || !/^[A-Za-z0-9_-]{10,160}$/.test(row.templateId) || !["accept", "reject", "ban"].includes(String(row.status))) return null;
    seen.add(row.channel); results.push({ channel: row.channel, templateId: row.templateId, status: row.status as "accept" | "reject" | "ban" });
  }
  return { requestId: value.requestId, expectedRevision: Number(value.expectedRevision), results };
}

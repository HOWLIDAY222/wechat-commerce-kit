import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultSubscriptionSettings, isSubscriptionChannel, parseSubscriptionReceipt, parseSubscriptionSettings, parseTemplate, safeSubscriptionPage, subscriptionTemplateData, type SubscriptionRule } from "@/lib/commerce/wechat-subscriptions";

const templateId = "qa_subscription_template_123";
const rule = (): SubscriptionRule => ({ key: "campaign", enabled: true, templateId, templateTitle: "品牌活动", activatedAt: null, fields: [{ key: "thing1", label: "活动名称", source: "title" }, { key: "time2", label: "活动时间", source: "eventTime" }] });
const event = { key: "qa-event", channel: "campaign" as const, title: "品牌活动", summary: "活动说明", eventTime: "2026-10-18T00:00:00Z", page: "pages/home/home" };
test("five channels default to disabled and cannot silently create a grant", () => {
  const settings = defaultSubscriptionSettings(); assert.equal(settings.channels.length, 5); assert(settings.channels.every(channel => !channel.enabled && channel.templateId === null && channel.activatedAt === null)); assert.equal(settings.revision, 0); assert(parseSubscriptionSettings(settings));
});
test("settings require every unique known channel and reject shared templates", () => {
  const settings = defaultSubscriptionSettings(); settings.channels[0] = { ...rule(), key: "new_product" }; settings.channels[1] = { ...rule(), key: "restock" }; assert.equal(parseSubscriptionSettings(settings), null);
  settings.channels[1].templateId = "qa_other_subscription_template"; assert(parseSubscriptionSettings(settings));
  settings.channels[1].key = "new_product"; assert.equal(parseSubscriptionSettings(settings), null); assert.equal(isSubscriptionChannel("newsletter"), false);
});
test("enabled channels need a template and at least one finite field mapping", () => {
  const settings = defaultSubscriptionSettings(); settings.channels[0].enabled = true; assert.equal(parseSubscriptionSettings(settings), null); settings.channels[0].templateId = templateId; assert.equal(parseSubscriptionSettings(settings), null);
  settings.channels[0].fields = [{ key: "thing1", label: "名称", source: "title" }]; assert(parseSubscriptionSettings(settings));
  settings.channels[0].fields[0].key = "__proto__"; assert.equal(parseSubscriptionSettings(settings), null);
});
test("catalog parser extracts actual provider placeholders and preserves catalog identity", () => {
  assert.deepEqual(parseTemplate({ priTmplId: templateId, title: "活动提醒", content: "活动名称：{{thing1.DATA}}\n活动时间:{{time2.DATA}}", type: 2 }), { templateId, title: "活动提醒", content: "活动名称：{{thing1.DATA}}\n活动时间:{{time2.DATA}}", type: 2, fields: [{ key: "thing1", label: "活动名称" }, { key: "time2", label: "活动时间" }] });
  assert.equal(parseTemplate({ priTmplId: templateId, title: "无字段", content: "none" }), null);
});
test("notification pages stay within known mini-program routes", () => {
  for (const page of ["pages/home/home", "pages/order-detail/index?orderNo=TC123", "pages/after-sales-detail/index?afterSalesNo=AS123"]) assert(safeSubscriptionPage(page));
  for (const page of ["https://evil.test", "//evil.test", "/pages/home/home", "pages/admin/index", "pages/home/home?x=<script>", "pages/home/home#anchor"]) assert.equal(safeSubscriptionPage(page), false);
});
test("template data uses Beijing time and Unicode code points for text limits", () => {
  const selected = rule(); selected.fields.push({ key: "phrase3", label: "状态", source: "status", literal: "活动已开始啦" });
  const result = subscriptionTemplateData(selected, { ...event, title: "😀".repeat(30) }); assert.equal(Array.from(result.thing1.value).length, 20); assert.equal(result.time2.value, "2026-10-18 08:00"); assert.equal(Array.from(result.phrase3.value).length, 5);
});
test("missing or invalid required fields fail before an attempted send", () => {
  const selected = rule(); assert.throws(() => subscriptionTemplateData(selected, { ...event, title: "" }), /SUBSCRIPTION_FIELD_MISSING/); assert.throws(() => subscriptionTemplateData(selected, { ...event, eventTime: "bad-date" }), /SUBSCRIPTION_FIELD_INVALID/);
  selected.fields = [{ key: "number1", label: "次数", source: "status" }]; assert.throws(() => subscriptionTemplateData(selected, { ...event, status: "无效数字" }), /SUBSCRIPTION_FIELD_INVALID/);
  selected.fields = [{ key: "amount1", label: "金额", source: "amount" }]; assert.throws(() => subscriptionTemplateData(selected, { ...event, amount: "-1元" }), /SUBSCRIPTION_FIELD_INVALID/); assert.equal(subscriptionTemplateData(selected, { ...event, amount: "49.00" }).amount1.value, "49.00");
});
test("client receipts have bounded native dialog results and a replay identifier", () => {
  const input = { requestId: "native_receipt_123456", expectedRevision: 0, results: [{ channel: "campaign", templateId, status: "accept" }] }; assert.deepEqual(parseSubscriptionReceipt(input), input);
  for (const patch of [{ requestId: "short" }, { expectedRevision: -1 }, { results: [] }, { results: [{ channel: "campaign", templateId, status: "success" }] }]) assert.equal(parseSubscriptionReceipt({ ...input, ...patch }), null);
});
test("a native dialog receipt cannot duplicate one channel or exceed three results", () => {
  const row = { channel: "campaign", templateId, status: "accept" };
  assert.equal(parseSubscriptionReceipt({ requestId: "native_receipt_123456", expectedRevision: 0, results: [row, row] }), null);
  assert.equal(parseSubscriptionReceipt({ requestId: "native_receipt_123456", expectedRevision: 0, results: ["campaign", "new_product", "restock", "order_shipped"].map(channel => ({ ...row, channel })) }), null);
});
test("reject and ban are recorded as native outcomes rather than invented accepts", () => {
  for (const status of ["reject", "ban"] as const) assert.equal(parseSubscriptionReceipt({ requestId: "native_receipt_123456", expectedRevision: 0, results: [{ channel: "campaign", templateId, status }] })?.results[0].status, status);
});

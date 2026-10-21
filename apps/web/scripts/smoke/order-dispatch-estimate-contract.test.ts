import assert from "node:assert/strict";
import { test } from "node:test";
import { beijingCalendarDate, dispatchEstimateDto, dispatchEstimateEditBlocker, hasSameHostDispatchEstimateOrigin,
  isDispatchDate, parseDispatchEstimateInput, type DispatchEstimateOrder } from "@/lib/commerce/order-dispatch-estimate";

function order(): DispatchEstimateOrder {
  return { kind: "STANDARD", status: "CONFIRMED", paymentStatus: "PAID", fulfillmentStatus: "PENDING", payableAmountCents: 4900, shipments: [], refunds: [] };
}
async function main() {
  await test("calendar parsing accepts real padded Gregorian dates and rejects rollover, zero and malformed values", () => {
    for (const value of ["2026-10-18", "2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31"]) assert.equal(isDispatchDate(value), true, value);
    for (const value of ["2026-02-29", "2100-02-29", "2026-02-30", "2026-04-31", "2026-00-01", "2026-13-01", "2026-01-00", "0000-01-01", "2026-1-01", "26-10-18", "2026-10-18T00:00:00Z", " 2026-10-18", "2026-10-18 ", null, 20261018]) assert.equal(isDispatchDate(value), false, String(value));
  });
  await test("request requires both nullable range endpoints, a bounded integer revision and no legacy or extra fields", () => {
    assert.deepEqual(parseDispatchEstimateInput({ startDate: null, endDate: null, expectedRevision: 0 }), { startDate: null, endDate: null, expectedRevision: 0 });
    assert.deepEqual(parseDispatchEstimateInput({ startDate: "2026-10-18", endDate: "2026-10-20", expectedRevision: 1 }), { startDate: "2026-10-18", endDate: "2026-10-20", expectedRevision: 1 });
    for (const input of [null, [], {}, { startDate: null, endDate: null }, { expectedRevision: 0 }, { date: "2026-10-18", expectedRevision: 0 },
      { startDate: "", endDate: "2026-10-20", expectedRevision: 0 }, { startDate: "2026-02-30", endDate: "2026-03-05", expectedRevision: 0 },
      { startDate: null, endDate: null, expectedRevision: -1 }, { startDate: null, endDate: null, expectedRevision: 0.5 }, { startDate: null, endDate: null, expectedRevision: "0" },
      { startDate: null, endDate: null, expectedRevision: 2147483647 }, { startDate: null, endDate: null, expectedRevision: 0, orderStatus: "SHIPPED" }]) assert.equal(parseDispatchEstimateInput(input), null);
  });
  await test("partial clear and reversed ranges are rejected while a one-day window is valid", () => {
    for (const input of [{ startDate: null, endDate: "2026-10-20", expectedRevision: 0 }, { startDate: "2026-10-18", endDate: null, expectedRevision: 0 }, { startDate: "2026-10-20", endDate: "2026-10-18", expectedRevision: 0 }]) assert.equal(parseDispatchEstimateInput(input), null);
    assert(parseDispatchEstimateInput({ startDate: "2026-10-18", endDate: "2026-10-18", expectedRevision: 0 }));
  });
  await test("today uses Beijing date across UTC midnight, year rollover and leap day boundaries", () => {
    assert.equal(beijingCalendarDate(new Date("2026-10-18T15:59:59.999Z")), "2026-10-18");
    assert.equal(beijingCalendarDate(new Date("2026-10-18T16:00:00.000Z")), "2026-10-19");
    assert.equal(beijingCalendarDate(new Date("2026-12-31T16:00:00Z")), "2027-01-01");
    assert.equal(beijingCalendarDate(new Date("2024-02-28T16:00:00Z")), "2024-02-29");
  });
  await test("unknown or cleared estimates stay UNSET without inventing a historical product promise", () => {
    assert.deepEqual(dispatchEstimateDto(null), { status: "UNSET", startDate: null, endDate: null, timeZone: "Asia/Shanghai", label: "预计发货日期待安排", updatedAt: null, revision: 0 });
    const cleared = dispatchEstimateDto({ startDate: null, endDate: null, revision: 3, updatedAt: new Date("2026-10-18T01:00:00Z") });
    assert.equal(cleared.status, "UNSET"); assert.equal(cleared.startDate, null); assert.equal(cleared.endDate, null); assert.equal(cleared.revision, 3); assert.equal(cleared.updatedAt, "2026-10-18T01:00:00.000Z");
  });
  await test("range covers the full Beijing end day and is overdue only after that day finishes", () => {
    const now = new Date("2026-10-18T15:59:59Z"), value = { startDate: "2026-10-15", endDate: "2026-10-18", revision: 1, updatedAt: now };
    assert.equal(dispatchEstimateDto(value, now).status, "SCHEDULED");
    assert.equal(dispatchEstimateDto({ ...value, endDate: "2026-10-19" }, now).status, "SCHEDULED");
    const overdue = dispatchEstimateDto(value, new Date("2026-10-18T16:00:00Z"));
    assert.equal(overdue.status, "OVERDUE"); assert.equal(overdue.startDate, "2026-10-15"); assert.equal(overdue.endDate, "2026-10-18");
  });
  await test("public label uses the requested complete Chinese start-end date format without padded month or day", () => {
    const result = dispatchEstimateDto({ startDate: "2026-01-02", endDate: "2026-02-03", revision: 1, updatedAt: new Date("2026-01-01T00:00:00Z") }, new Date("2026-01-01T00:00:00Z"));
    assert.equal(result.label, "预计发货日期 2026年1月2日-2026年2月3日");
  });
  await test("only confirmed paid physical pending/processing orders are editable, including a free physical gift redemption", () => {
    assert.equal(dispatchEstimateEditBlocker(order()), null);
    assert.equal(dispatchEstimateEditBlocker({ ...order(), fulfillmentStatus: "PROCESSING" }), null);
    assert.equal(dispatchEstimateEditBlocker({ ...order(), kind: "GIFT_REDEMPTION", payableAmountCents: 0 }), null);
    for (const changed of [{ kind: "GIFT_PURCHASE" }, { kind: "UNKNOWN_KIND" }, { status: "CREATED" }, { status: "CANCELLED" }, { status: "CLOSED" },
      { paymentStatus: "NOT_STARTED" }, { paymentStatus: "PENDING" }, { paymentStatus: "REFUNDED" }, { fulfillmentStatus: "SHIPPED" }, { fulfillmentStatus: "DELIVERED" }, { fulfillmentStatus: "RETURNED" }]) assert(dispatchEstimateEditBlocker({ ...order(), ...changed }));
  });
  await test("any actual carrier, tracking or delivery evidence blocks edits even if order fulfillment is stale", () => {
    const empty = { status: "PROCESSING", trackingNo: null, trackingCompany: null, shippedAt: null, deliveredAt: null };
    assert.equal(dispatchEstimateEditBlocker({ ...order(), shipments: [empty] }), null);
    for (const changed of [{ trackingNo: "QA123" }, { trackingCompany: "顺丰" }, { shippedAt: new Date() }, { deliveredAt: new Date() }, { status: "SHIPPED" }, { status: "DELIVERED" }, { status: "RETURNED" }]) assert.equal(dispatchEstimateEditBlocker({ ...order(), shipments: [{ ...empty, ...changed }] }), "DISPATCH_ESTIMATE_SHIPMENT_EXISTS");
  });
  await test("successful complete refunds block stale PAID orders while partial or failed refunds do not", () => {
    assert.equal(dispatchEstimateEditBlocker({ ...order(), refunds: [{ refundStatus: "SUCCEEDED", refundAmountCents: 4900 }] }), "DISPATCH_ESTIMATE_ORDER_REFUNDED");
    assert.equal(dispatchEstimateEditBlocker({ ...order(), refunds: [{ refundStatus: "SUCCEEDED", refundAmountCents: 2000 }, { refundStatus: "SUCCEEDED", refundAmountCents: 2900 }] }), "DISPATCH_ESTIMATE_ORDER_REFUNDED");
    assert.equal(dispatchEstimateEditBlocker({ ...order(), refunds: [{ refundStatus: "SUCCEEDED", refundAmountCents: 2000 }, { refundStatus: "FAILED", refundAmountCents: 4900 }] }), null);
  });
  await test("same-host browser origin works through HTTPS-to-HTTP proxy and missing origin follows existing admin policy", () => {
    const request = (origin?: string) => new Request("http://127.0.0.1/api", { headers: { host: "example.invalid", ...(origin ? { origin } : {}) } });
    assert.equal(hasSameHostDispatchEstimateOrigin(request("https://example.invalid")), true);
    assert.equal(hasSameHostDispatchEstimateOrigin(request("http://example.invalid")), true);
    assert.equal(hasSameHostDispatchEstimateOrigin(request()), true);
  });
  await test("cross-origin, opaque, credentialed, path/query origins and spoofed forwarded hosts are rejected", () => {
    for (const origin of ["https://evil.invalid", "null", "file:///C:/file", "not a url", "https://user:pass@example.invalid", "https://example.invalid/path", "https://example.invalid?x=1", "https://example.invalid:8443"]) assert.equal(hasSameHostDispatchEstimateOrigin(new Request("http://127.0.0.1/api", { headers: { host: "example.invalid", origin, "x-forwarded-host": "example.invalid" } })), false, origin);
    assert.equal(hasSameHostDispatchEstimateOrigin(new Request("http://127.0.0.1/api", { headers: { host: "evil.invalid", origin: "https://example.invalid", "x-forwarded-host": "example.invalid" } })), false);
  });
}
main().catch(error => { console.error(error); process.exitCode = 1; });

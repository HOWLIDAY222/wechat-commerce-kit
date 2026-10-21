import assert from "node:assert/strict";
import { test } from "node:test";

test("subscription send acceptance uses the actual provider with a synthetic fetch boundary", async context => {
  const keys = ["WECHAT_MINIPROGRAM_APP_ID", "WECHAT_MINIPROGRAM_APP_SECRET", "WECHAT_API_BASE_URL"] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const origin = "http://127.0.0.1:18997";
  process.env.WECHAT_MINIPROGRAM_APP_ID = "qa-subscription-provider-app";
  process.env.WECHAT_MINIPROGRAM_APP_SECRET = "qa-subscription-provider-secret";
  process.env.WECHAT_API_BASE_URL = origin;
  let responseBody: unknown = { errcode: 0, errmsg: "ok" };
  let networkFailure = false, invalidJson = false, status = 200, tokenRequests = 0;
  const payloads: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    assert.equal(url.origin, origin, "No real provider or other host can be contacted");
    if (url.pathname === "/cgi-bin/stable_token") {
      tokenRequests++;
      return new Response(JSON.stringify({ access_token: "qa-provider-token", expires_in: 7200 }), { status: 200 });
    }
    assert.equal(url.pathname, "/cgi-bin/message/subscribe/send");
    assert.equal(init?.method, "POST");
    payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    if (networkFailure) throw Error("Synthetic acceptance uncertainty");
    return new Response(invalidJson ? "{" : JSON.stringify(responseBody), { status });
  };
  try {
    const { sendWeChatSubscription } = await import("@/lib/providers/wechat-subscriptions");
    const input = { openId: "qa-own-openid", templateId: "qa-owned-template-123", page: "pages/home/home", data: { thing13: { value: "订阅提醒测试" } } };
    await context.test("only explicit numeric zero is API acceptance and the target environment stays formal", async () => {
      const result = await sendWeChatSubscription(input);
      assert.equal(result.errcode, 0);
      assert.deepEqual(payloads.at(-1), { touser: input.openId, template_id: input.templateId, page: input.page, data: input.data, miniprogram_state: "formal", lang: "zh_CN" });
      responseBody = { errcode: 0 };
      assert.equal((await sendWeChatSubscription(input)).errcode, 0);
    });
    for (const [name, body] of [
      ["empty object", {}], ["missing code", { errmsg: "ok" }], ["null code", { errcode: null }],
      ["false code", { errcode: false }], ["empty string code", { errcode: "" }], ["string zero", { errcode: "0" }], ["array", []],
    ] as const) {
      await context.test(name + " remains UNKNOWN and is attempted only once", async () => {
        responseBody = body;
        const before = payloads.length;
        await assert.rejects(sendWeChatSubscription(input), /^Error: SUBSCRIPTION_ACCEPTANCE_UNKNOWN$/);
        assert.equal(payloads.length, before + 1);
      });
    }
    await context.test("an explicit nonzero provider rejection is preserved without retry", async () => {
      responseBody = { errcode: 43101, errmsg: "qa permission denied" };
      const before = payloads.length;
      await assert.rejects(sendWeChatSubscription(input), /^Error: WECHAT_SHIPPING_API_43101$/);
      assert.equal(payloads.length, before + 1);
    });
    await context.test("network uncertainty is never retried", async () => {
      networkFailure = true;
      const before = payloads.length;
      await assert.rejects(sendWeChatSubscription(input), /^Error: WECHAT_SHIPPING_NETWORK_UNAVAILABLE$/);
      assert.equal(payloads.length, before + 1);
      networkFailure = false;
    });
    await context.test("invalid JSON and HTTP failure cannot become API acceptance", async () => {
      invalidJson = true;
      await assert.rejects(sendWeChatSubscription(input), /^Error: WECHAT_SHIPPING_INVALID_RESPONSE$/);
      invalidJson = false; status = 502; responseBody = { errcode: 0 };
      await assert.rejects(sendWeChatSubscription(input), /^Error: WECHAT_SHIPPING_INVALID_RESPONSE$/);
      status = 200;
    });
    assert.equal(tokenRequests, 1, "The actual shared token cache is reused");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

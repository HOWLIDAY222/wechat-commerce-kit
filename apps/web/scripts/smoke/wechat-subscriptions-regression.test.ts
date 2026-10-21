import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { spawn } from "node:child_process";
import type { SubscriptionChannelKey, SubscriptionEvent, SubscriptionSettings } from "@/lib/commerce/wechat-subscriptions";

async function main() {
  const database = new URL(process.env.DATABASE_URL || ""), gateway = new URL(process.env.WECHAT_API_BASE_URL || "");
  assert.equal(database.pathname, "/vk_member_subscriptions_smoke_20261018", "Only the dedicated disposable member QA database is allowed");
  assert(["localhost", "127.0.0.1"].includes(database.hostname)); assert.equal(process.env.COMMERCE_STORAGE, "prisma"); assert.equal(gateway.href, "http://127.0.0.1:18998/");
  assert(process.env.WECHAT_MINIPROGRAM_APP_ID?.startsWith("qa-")); assert(process.env.WECHAT_MINIPROGRAM_APP_SECRET?.startsWith("qa-"));
  const originalFetch = globalThis.fetch; let forbiddenRequests = 0;
  globalThis.fetch = async (input, init) => { const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url); if (url.origin !== gateway.origin) { forbiddenRequests++; throw Error("Subscription QA forbids every nonlocal gateway"); } return originalFetch(input, init); };
  const appId = process.env.WECHAT_MINIPROGRAM_APP_ID!;
  const channels: SubscriptionChannelKey[] = ["new_product", "restock", "campaign", "order_shipped", "after_sales"];
  const templates = channels.map(channel => ({ priTmplId: "qa_subscription_" + channel + "_123456", title: "隔离模板 " + channel, content: "标题：{{thing1.DATA}}\n时间：{{time2.DATA}}", type: 2 }));
  let mode: "SENT" | "DENIED" | "UNKNOWN" | "EMPTY" | "NO_CODE" | "NULL_CODE" | "FALSE_CODE" | "STRING_ZERO" = "SENT", sends = 0; const sentPayloads: Array<Record<string, unknown>> = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, gateway), chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    response.setHeader("Content-Type", "application/json");
    if (url.pathname === "/cgi-bin/stable_token") { response.end(JSON.stringify({ access_token: "qa-subscription-token", expires_in: 7200 })); return; }
    if (url.pathname === "/wxaapi/newtmpl/gettemplate") { response.end(JSON.stringify({ errcode: 0, data: templates })); return; }
    if (url.pathname === "/cgi-bin/message/subscribe/send") { sends++; sentPayloads.push(JSON.parse(Buffer.concat(chunks).toString("utf8"))); if (mode === "UNKNOWN") { request.socket.destroy(); return; } const body = mode === "DENIED" ? { errcode: 43101, errmsg: "qa native permission denied" } : mode === "EMPTY" ? {} : mode === "NO_CODE" ? { errmsg: "ok" } : mode === "NULL_CODE" ? { errcode: null } : mode === "FALSE_CODE" ? { errcode: false } : mode === "STRING_ZERO" ? { errcode: "0" } : { errcode: 0, errmsg: "ok" }; response.end(JSON.stringify(body)); return; }
    response.writeHead(404); response.end(JSON.stringify({ error: "Unexpected local QA endpoint" }));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(18998, "127.0.0.1", resolve); });
  const { prisma } = await import("@/lib/db/prisma");
  const { Client } = await import("pg");
  const { defaultSubscriptionSettings } = await import("@/lib/commerce/wechat-subscriptions");
  const { getSubscriptionSettings, subscriptionOverview, updateSubscriptionPreferences: preferences, recordSubscriptionReceipt: receipt, saveSubscriptionSettings: configure, createSubscriptionCampaign: draft, queueSubscriptionCampaign: queue, deliverSubscriptionEvent: deliver, runSubscriptionDeliveryBatch: batch } = await import("@/lib/services/wechat-subscription-service");
  const { GET, PUT, POST } = await import("@/app/api/miniprogram/subscriptions/route");
  const { createSessionToken, hashToken } = await import("@/lib/auth/session");
  const ids: string[] = [], orderIds: string[] = [], suffix = randomUUID(); let hidden = false;
  const initial = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM wechat_subscription_settings`;
  let settings: SubscriptionSettings = defaultSubscriptionSettings();
  const template = (channel: SubscriptionChannelKey) => templates.find(template => template.priTmplId.includes("_" + channel + "_"))!.priTmplId;
  async function user(role: "CUSTOMER" | "ADMIN" | "OWNER" = "CUSTOMER", linked = true) {
    const result = await prisma.user.create({ data: { name: "subscription-qa-" + suffix, phone: linked ? "137" + String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0") : null, role,
      ...(linked ? { wechatIdentities: { create: { appId, openId: "qa-openid-" + randomUUID() } } } : {}) } }); ids.push(result.id); return result;
  }
  async function snapshot() { const result: Record<string,string|null> = {}; for (const table of ["users", "orders", "order_items", "payment_intents", "shipments", "refunds", "after_sales_requests", "products", "product_skus", "point_entries", "member_profiles", "privacy_consents"]) { assert(/^[a-z_]+$/.test(table)); const rows=await prisma.$queryRawUnsafe<Array<{hash:string|null}>>(`SELECT md5(string_agg(row_to_json(t)::text, ',' ORDER BY row_to_json(t)::text)) AS hash FROM ${table} t`); result[table]=rows[0].hash; } return result; }
  async function grants(userId: string, channel?: SubscriptionChannelKey) { return prisma.$queryRaw<Array<{ id: string; consumedAt: Date | null }>>`SELECT id,consumed_at AS "consumedAt" FROM wechat_subscription_grants WHERE user_id=${userId} AND (${channel ?? null}::text IS NULL OR channel=${channel ?? null})`; }
  async function deliveries(userId: string) { return prisma.$queryRaw<Array<{ eventKey: string; state: string; errorCode: string | null }>>`SELECT event_key AS "eventKey",state,error_code AS "errorCode" FROM wechat_subscription_deliveries WHERE user_id=${userId} ORDER BY created_at`; }
  async function accept(userId: string, channel: SubscriptionChannelKey, count = 1) { for(let i=0;i<count;i++){ const current=await subscriptionOverview(userId); await receipt(userId,{requestId:"qa_receipt_"+randomUUID(),expectedRevision:current.preferenceRevision,results:[{channel,templateId:template(channel),status:"accept"}]}); } }
  const event = (userId: string, key = randomUUID(), channel: SubscriptionChannelKey = "new_product"): SubscriptionEvent => ({ key: "qa-event-"+key,channel,userId,title:"隔离上新通知",summary:"不发送真实消息",eventTime:new Date().toISOString(),page:"pages/home/home" });
  async function token(userId:string){const value=createSessionToken();await prisma.session.create({data:{userId,tokenHash:hashToken(value),expiresAt:new Date(Date.now()+120_000)}});return value;}
  try {
    assert.equal(initial.length,0,"Subscription tests require fresh disposable settings; never overwrite an existing configuration");
    const owner=await user("OWNER"),admin=await user("ADMIN"),first=await user(),second=await user(),unlinked=await user("CUSTOMER",false);
    await test("fresh settings and public overview are read-only with no grants or notification attempts",async()=>{const before=await snapshot(),result=await subscriptionOverview();assert(result.channels.every(channel=>!channel.available&&!channel.enabled&&channel.remaining===0));assert.equal(sends,0);assert.equal((await getSubscriptionSettings()).revision,0);assert.deepEqual(await snapshot(),before);});
    await test("only owner saves settings and selected template and field ownership are verified against real catalog responses",async()=>{
      settings.channels=settings.channels.map(rule=>({...rule,enabled:true,templateId:template(rule.key),fields:[{key:"thing1",label:"标题",source:"title"},{key:"time2",label:"时间",source:"eventTime"}]}));
      await assert.rejects(configure(admin.id,settings),/OWNER_REQUIRED/);
      const invalid=structuredClone(settings);invalid.channels[0].templateId="qa_unowned_template_123456";await assert.rejects(configure(owner.id,invalid),/SUBSCRIPTION_TEMPLATE_NOT_OWNED/);
      invalid.channels[0].templateId=template("new_product");invalid.channels[0].fields=[{key:"thing1",label:"标题",source:"title"}];await assert.rejects(configure(owner.id,invalid),/SUBSCRIPTION_TEMPLATE_FIELDS_INVALID/);
      settings=await configure(owner.id,settings);assert.equal(settings.revision,1);await assert.rejects(configure(owner.id,{...settings,revision:0}),/SUBSCRIPTION_REVISION_CONFLICT/);
    });
    await test("switches cannot fabricate provider grants, and unlinked identities cannot subscribe",async()=>{const before=await snapshot();await preferences(second.id,["new_product"],0);assert.equal((await grants(second.id)).length,0);assert.equal((await deliver(event(second.id))).sent,0);await assert.rejects(preferences(unlinked.id,["new_product"],0),/SUBSCRIPTION_ACCOUNT_LINK_REQUIRED/);assert.deepEqual(await snapshot(),before);});
    await test("UTC projections and explicit ISO bindings preserve actual epochs in an Asia/Shanghai database session",async()=>{
      const current=await getSubscriptionSettings();const rows=await prisma.$queryRaw<Array<{epoch:string;clock:string;bound:string;zone:string}>>`SELECT (EXTRACT(epoch FROM updated_at)*1000)::text AS epoch,(EXTRACT(epoch FROM clock_timestamp())*1000)::text AS clock,(EXTRACT(epoch FROM ${new Date().toISOString()}::timestamptz)*1000)::text AS bound,current_setting('TimeZone') AS zone FROM wechat_subscription_settings WHERE id='main'`;
      assert.equal(Date.parse(current.updatedAt!),Math.trunc(Number(rows[0].epoch)));assert(Math.abs(Number(rows[0].clock)-Number(rows[0].bound))<5000);assert(["Asia/Shanghai","UTC","Etc/UTC"].includes(rows[0].zone));
    });
    await test("native accept is only a journaled claim: receipt retries are idempotent, altered replay is rejected and no send occurs",async()=>{
      const body={requestId:"qa_native_idempotence_12345",expectedRevision:0,results:[{channel:"new_product",templateId:template("new_product"),status:"accept"}]};await receipt(first.id,body);await receipt(first.id,body);assert.equal((await grants(first.id)).length,1);assert.equal((await subscriptionOverview(first.id)).preferenceRevision,1);assert.equal(sends,0);await assert.rejects(receipt(first.id,{...body,results:[{...body.results[0],status:"reject"}]}),/SUBSCRIPTION_REQUEST_CONFLICT/);
    });
    await test("concurrent native receipts share compare revision so only one new authorization credit is journaled",async()=>{const before=await snapshot();const results=await Promise.allSettled([receipt(first.id,{requestId:"qa_concurrent_a_12345",expectedRevision:1,results:[{channel:"new_product",templateId:template("new_product"),status:"accept"}]}),receipt(first.id,{requestId:"qa_concurrent_b_12345",expectedRevision:1,results:[{channel:"new_product",templateId:template("new_product"),status:"accept"}]})]);assert.equal(results.filter(result=>result.status==="fulfilled").length,1);assert.equal((await grants(first.id)).length,2);assert.deepEqual(await snapshot(),before);});
    await test("a new native credit cannot retroactively authorize an event that occurred before its real instant",async()=>{
      const isolated=await user();await accept(isolated.id,"new_product");const rows=await prisma.$queryRaw<Array<{epoch:string}>>`SELECT (EXTRACT(epoch FROM created_at)*1000)::text AS epoch FROM wechat_subscription_grants WHERE user_id=${isolated.id}`;
      const historical={...event(isolated.id),eventTime:new Date(Number(rows[0].epoch)-60_000).toISOString()},before=sends;await deliver(historical);assert.equal(sends,before);assert((await grants(isolated.id)).every(grant=>!grant.consumedAt));
    });
    await test("authoritative provider denial is REJECTED, exhausts uncertain native claims and is never replayed",async()=>{mode="DENIED";const item=event(first.id),before=sends;const result=await deliver(item);assert.equal(result.rejected,1);assert.equal(sends,before+1);assert.equal((await deliveries(first.id)).at(-1)?.state,"REJECTED");assert((await grants(first.id,"new_product")).every(grant=>grant.consumedAt));await deliver(item);assert.equal(sends,before+1);mode="SENT";});
    await test("successful delivery consumes one credit and concurrent duplicate events never send twice",async()=>{await accept(first.id,"new_product",2);const item=event(first.id),before=sends,core=await snapshot();await Promise.all([deliver(item),deliver(item)]);assert.equal(sends,before+1);assert.equal((await deliveries(first.id)).filter(row=>row.eventKey===item.key).length,1);assert.equal((await deliveries(first.id)).find(row=>row.eventKey===item.key)?.state,"SENT");assert.deepEqual(await snapshot(),core);const sent=sentPayloads.at(-1)!;assert.equal(sent.miniprogram_state,"formal");assert.equal(sent.template_id,template("new_product"));});
    await test("network acceptance uncertainty is quarantined UNKNOWN and new credits cannot resend the same event",async()=>{mode="UNKNOWN";await accept(first.id,"new_product");const item=event(first.id),before=sends;assert.equal((await deliver(item)).unknown,1);assert.equal((await deliveries(first.id)).find(row=>row.eventKey===item.key)?.state,"UNKNOWN");mode="SENT";await accept(first.id,"new_product");await deliver(item);assert.equal(sends,before+1);});
    await test("empty and malformed provider acceptance is journaled UNKNOWN without replaying or consuming another credit", async () => {
      for (const malformed of ["EMPTY", "NO_CODE", "NULL_CODE", "FALSE_CODE", "STRING_ZERO"] as const) {
        const isolated = await user(); await accept(isolated.id, "new_product");
        const item = event(isolated.id), before = sends, core = await snapshot(); mode = malformed;
        assert.deepEqual(await deliver(item), { sent: 0, skipped: 0, unknown: 1, rejected: 0 });
        assert.equal(sends, before + 1);
        const journal = (await deliveries(isolated.id)).find(row => row.eventKey === item.key);
        assert(journal); assert.equal(journal.state, "UNKNOWN"); assert.equal(journal.errorCode, "ACCEPTANCE_UNKNOWN");
        assert.equal((await grants(isolated.id)).filter(grant => grant.consumedAt).length, 1);
        assert.deepEqual(await snapshot(), core);
        mode = "SENT"; await accept(isolated.id, "new_product");
        const creditsBeforeReplay = await grants(isolated.id);
        await deliver(item);
        assert.equal(sends, before + 1);
        assert.equal((await deliveries(isolated.id)).filter(row => row.eventKey === item.key).length, 1);
        assert.deepEqual(await grants(isolated.id), creditsBeforeReplay);
      }
    });
    await test("an unsubscribe committed while a claim waits on consent row prevents any provider request",async()=>{
      await accept(second.id,"new_product");const blocker=new Client({connectionString:database.href}),observer=new Client({connectionString:database.href});await blocker.connect();await observer.connect();let committed=false;let pending:ReturnType<typeof deliver>|undefined;const before=sends;
      try{await blocker.query("BEGIN");await blocker.query("SELECT user_id FROM wechat_subscription_preferences WHERE user_id=$1 FOR UPDATE",[second.id]);const pid=(await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;await blocker.query("UPDATE wechat_subscription_preferences SET enabled_channels='[]'::jsonb,revision=revision+1 WHERE user_id=$1",[second.id]);pending=deliver(event(second.id));let blocked=false;for(let attempt=0;attempt<40;attempt++){await observer.query("SELECT pg_stat_clear_snapshot()");const rows=await observer.query("SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid)) AND query LIKE '%wechat_subscription_preferences%'",[pid]);if(rows.rows.length){blocked=true;break;}await delay(50);}assert(blocked,"The actual delivery consent SELECT must wait on the unsubscribe lock");await blocker.query("COMMIT");committed=true;assert.equal((await pending).sent,0);assert.equal(sends,before);}finally{if(!committed)await blocker.query("ROLLBACK");if(pending)await pending.catch(()=>null);await blocker.end();await observer.end();}
    });
    await test("brand campaigns remain draft until an owner confirms the exact ID, then finish through the journal",async()=>{
      await accept(second.id,"campaign");const campaign=await draft(admin.id,{channel:"campaign",title:"隔离活动草稿",summary:"仅本地消息网关",page:"pages/home/home"}),before=sends;assert.equal(campaign.status,"DRAFT");await batch();assert.equal(sends,before);
      await assert.rejects(queue(admin.id,campaign.id,campaign.id),/OWNER_REQUIRED/);await assert.rejects(queue(owner.id,campaign.id,"wrong-id"),/SUBSCRIPTION_CONFIRMATION_REQUIRED/);await queue(owner.id,campaign.id,campaign.id);await batch();assert.equal(sends,before+1);const rows=await prisma.$queryRaw<Array<{status:string}>>`SELECT status FROM wechat_subscription_campaigns WHERE id=${campaign.id}`;assert.equal(rows[0].status,"COMPLETED");
    });
    await test("historical order creation does not block a new genuine shipping event; worker only reads commerce rows",async()=>{
      await accept(first.id,"order_shipped");const order=await prisma.order.create({data:{orderNo:"subscription-old-order-"+suffix,userId:first.id,createdAt:new Date("2026-07-01T00:00:00Z"),kind:"STANDARD",status:"CONFIRMED",paymentStatus:"PAID",fulfillmentStatus:"SHIPPED",subtotalCents:4900,payableAmountCents:4900,customerName:"隔离物流测试",customerPhone:"13900000025",addressSnapshot:"隔离测试",shipments:{create:{status:"SHIPPED",trackingNo:"QA-LOCAL-WAYBILL",trackingCompany:"隔离快递",shippedAt:new Date()}}}});orderIds.push(order.id);
      const before=sends,core=await snapshot();await batch();assert.equal(sends,before+1);assert((await deliveries(first.id)).some(row=>row.eventKey.startsWith("shipment:")&&row.state==="SENT"));assert.deepEqual(await snapshot(),core);
    });
    await test("channel activation never backfills a historical shipment even with an earlier journaled grant",async()=>{
      const isolated=await user();await accept(isolated.id,"order_shipped");const activation=settings.channels.find(channel=>channel.key==="order_shipped")!.activatedAt!;
      await prisma.$executeRaw`UPDATE wechat_subscription_grants SET created_at=${new Date(Date.parse(activation)-172800000).toISOString()}::timestamptz WHERE user_id=${isolated.id}`;
      const fixture=async(orderNo:string,shippedAt:Date)=>{const order=await prisma.order.create({data:{orderNo,userId:isolated.id,createdAt:new Date("2026-07-01T00:00:00Z"),kind:"STANDARD",status:"CONFIRMED",paymentStatus:"PAID",fulfillmentStatus:"SHIPPED",subtotalCents:4900,payableAmountCents:4900,customerName:"隔离激活窗口测试",customerPhone:"13900000026",addressSnapshot:"仅隔离测试",shipments:{create:{status:"SHIPPED",trackingNo:"QA-ACTIVATION-WAYBILL",trackingCompany:"隔离快递",shippedAt}}},include:{shipments:true}});orderIds.push(order.id);return order;};
      const old=await fixture("subscription-before-activation-"+suffix,new Date(Date.parse(activation)-86400000)),fresh=await fixture("subscription-after-activation-"+suffix,new Date()),before=sends,core=await snapshot();await batch();assert.equal(sends,before+1);const journal=await deliveries(isolated.id);assert.equal(journal.some(row=>row.eventKey==="shipment:"+old.shipments[0].id),false);assert(journal.some(row=>row.eventKey==="shipment:"+fresh.shipments[0].id&&row.state==="SENT"));assert.deepEqual(await snapshot(),core);
    });
    await test("after-sales worker respects actual enums and drains more than thirty eligible updates without starvation",async()=>{
      await accept(second.id,"after_sales",32);const order=await prisma.order.create({data:{orderNo:"subscription-after-sales-order-"+suffix,userId:second.id,kind:"STANDARD",status:"CONFIRMED",paymentStatus:"PAID",fulfillmentStatus:"PENDING",subtotalCents:4900,payableAmountCents:4900,customerName:"隔离售后测试",customerPhone:"13900000027",addressSnapshot:"隔离测试"}});orderIds.push(order.id);
      await prisma.afterSalesRequest.create({data:{afterSalesNo:"subscription-submitted-"+suffix,userId:second.id,orderId:order.id,type:"REFUND_ONLY",reason:"隔离测试",description:"初始状态不应通知",status:"SUBMITTED"}});
      for(let i=0;i<31;i++)await prisma.afterSalesRequest.create({data:{afterSalesNo:`subscription-approved-${i}-`+suffix,userId:second.id,orderId:order.id,type:"REFUND_ONLY",reason:"隔离测试",description:"仅本地测试网关",status:"APPROVED"}});
      const before=sends,core=await snapshot();for(let round=0;round<4;round++){const previous=sends;await batch();assert(sends-previous<=10,"After-sales must respect the ten-row per-batch budget");}assert.equal(sends-before,31,"All 31 updates should drain; processed newer rows cannot starve older eligible events");assert.deepEqual(await snapshot(),core);
    });
    await test("native API keeps data uncached and rejects cookie cross-origin writes without rewriting profiles or orders",async()=>{const bearer=await token(first.id),headers={authorization:"Bearer "+bearer,host:"qa.invalid","content-type":"application/json"};const before=await snapshot();const result=await GET(new Request("http://qa.invalid",{headers}));assert.equal(result.status,200);assert.match(result.headers.get("cache-control")||"",/no-store/);const current=await subscriptionOverview(first.id);const evil=await PUT(new Request("http://qa.invalid",{method:"PUT",headers:{...headers,cookie:"qa=1",origin:"https://evil.invalid"},body:JSON.stringify({enabledChannels:[],expectedRevision:current.preferenceRevision})}));assert.equal(evil.status,403);const forged=await POST(new Request("http://qa.invalid",{method:"POST",headers,body:JSON.stringify({requestId:"qa_forged_template_12345",expectedRevision:current.preferenceRevision,results:[{channel:"new_product",templateId:"qa_unowned_template_123456",status:"accept"}]})}));assert.equal(forged.status,409);assert.deepEqual(await snapshot(),before);});
    await test("interrupted SENDING journal entries become UNKNOWN and are never automatically resent",async()=>{
      const isolated=await user();await accept(isolated.id,"new_product");const grant=(await grants(isolated.id))[0],item=event(isolated.id),deliveryId=randomUUID();await prisma.$executeRaw`INSERT INTO wechat_subscription_deliveries(id,user_id,channel,template_id,grant_id,event_key,state,attempt_started_at) VALUES(${deliveryId},${isolated.id},'new_product',${template("new_product")},${grant.id},${item.key},'SENDING',${new Date(Date.now()-11*60_000).toISOString()}::timestamptz)`;await prisma.$executeRaw`UPDATE wechat_subscription_grants SET consumed_at=CURRENT_TIMESTAMP WHERE id=${grant.id}`;const before=sends;await batch();assert.equal((await deliveries(isolated.id))[0].state,"UNKNOWN");await accept(isolated.id,"new_product");await deliver(item);assert.equal(sends,before);
    });
    await test("standalone worker check never sends and another live session lock makes run exit without reentry",async()=>{
      const child=(flag:string)=>new Promise<{code:number|null;output:string}>((resolve,reject)=>{const processChild=spawn(process.execPath,["node_modules/tsx/dist/cli.mjs","scripts/jobs/send-wechat-subscriptions.ts",flag],{cwd:process.cwd(),env:process.env,stdio:["ignore","pipe","pipe"]});let output="";const deadline=setTimeout(()=>{processChild.kill();reject(Error("QA worker exceeded its bounded check deadline"));},20000);processChild.stdout.on("data",chunk=>{output+=chunk.toString();});processChild.stderr.on("data",chunk=>{output+=chunk.toString();});processChild.on("error",reject);processChild.on("close",code=>{clearTimeout(deadline);resolve({code,output});});});
      const before=sends,check=await child("--check");assert.equal(check.code,0,check.output);assert.equal(JSON.parse(check.output.trim()).notificationsAttempted,0);
      const lock=new Client({connectionString:database.href});await lock.connect();try{await lock.query("SELECT pg_advisory_lock(879001,20261018)");const skipped=await child("--run");assert.equal(skipped.code,0,skipped.output);assert.equal(JSON.parse(skipped.output.trim()).reason,"ALREADY_RUNNING");}finally{await lock.query("SELECT pg_advisory_unlock(879001,20261018)");await lock.end();}assert.equal(sends,before);
    });
    await test("unlinked identities may withdraw existing consent but cannot add notification channels",async()=>{
      const isolated=await user();await preferences(isolated.id,["new_product"],0);await prisma.weChatIdentity.deleteMany({where:{userId:isolated.id}});const result=await preferences(isolated.id,[],1);assert.equal(result.canSubscribe,false);assert(result.channels.every(channel=>!channel.enabled));await assert.rejects(preferences(isolated.id,["new_product"],result.preferenceRevision),/SUBSCRIPTION_ACCOUNT_LINK_REQUIRED/);assert.equal((await grants(isolated.id)).length,0);
    });
    await test("a blank provider identity cannot enable consent, journal a native accept or enter a delivery audience",async()=>{
      const isolated=await user();await prisma.weChatIdentity.updateMany({where:{userId:isolated.id},data:{openId:"   "}});assert.equal((await subscriptionOverview(isolated.id)).canSubscribe,false);await assert.rejects(preferences(isolated.id,["new_product"],0),/SUBSCRIPTION_ACCOUNT_LINK_REQUIRED/);await assert.rejects(receipt(isolated.id,{requestId:"qa_blank_identity_12345",expectedRevision:0,results:[{channel:"new_product",templateId:template("new_product"),status:"accept"}]}),/SUBSCRIPTION_ACCOUNT_LINK_REQUIRED/);const before=sends;await deliver(event(isolated.id));assert.equal(sends,before);
    });
    await test("disabled or replaced templates cancel queued drafts and closed-channel backlog cannot starve active campaigns",async()=>{
      const queued:string[]=[];for(let i=0;i<5;i++){const item=await draft(owner.id,{channel:"new_product",title:"将关闭的通知"+i,summary:"本地队列关闭核验",page:"pages/home/home"});await queue(owner.id,item.id,item.id);queued.push(item.id);}
      settings=await configure(owner.id,{...settings,channels:settings.channels.map(rule=>rule.key==="new_product"?{...rule,enabled:false}:rule)});let rows=await prisma.$queryRaw<Array<{status:string}>>`SELECT status FROM wechat_subscription_campaigns WHERE id=ANY(${queued}::text[])`;assert(rows.every(row=>row.status==="CANCELLED"));
      // Simulate a legacy unreconciled queue using only new isolated journal
      // rows, so filtering must happen before the five-campaign page limit.
      await prisma.$executeRaw`UPDATE wechat_subscription_campaigns SET status='QUEUED' WHERE id=ANY(${queued}::text[])`;const isolated=await user();await accept(isolated.id,"restock");const live=await draft(owner.id,{channel:"restock",title:"仍启用的补货通知",summary:"不能被关闭频道旧队列阻塞",page:"pages/home/home"});await queue(owner.id,live.id,live.id);const before=sends;await batch();assert.equal(sends,before+1);rows=await prisma.$queryRaw<Array<{status:string}>>`SELECT status FROM wechat_subscription_campaigns WHERE id=${live.id}`;assert.equal(rows[0].status,"COMPLETED");
      settings=await configure(owner.id,{...settings,channels:settings.channels.map(rule=>rule.key==="new_product"?{...rule,enabled:true}:rule)});const replace=await draft(owner.id,{channel:"new_product",title:"模板变更前的排队通知",summary:"变更模板应取消旧队列",page:"pages/home/home"});await queue(owner.id,replace.id,replace.id);templates.push({priTmplId:"qa_replacement_new_product_123456",title:"替换后的本地模板",content:"标题：{{thing1.DATA}}\n时间：{{time2.DATA}}",type:2});settings=await configure(owner.id,{...settings,channels:settings.channels.map(rule=>rule.key==="new_product"?{...rule,templateId:"qa_replacement_new_product_123456"}:rule)});rows=await prisma.$queryRaw<Array<{status:string}>>`SELECT status FROM wechat_subscription_campaigns WHERE id=${replace.id}`;assert.equal(rows[0].status,"CANCELLED");
    });
    await test("missing subscription storage fails closed and the entire suite makes zero nonlocal gateway calls",async()=>{await prisma.$executeRawUnsafe("ALTER TABLE wechat_subscription_grants RENAME TO wechat_subscription_grants_qa_hidden");hidden=true;try{await assert.rejects(subscriptionOverview(first.id),/SUBSCRIPTION_SCHEMA_REQUIRED/);}finally{await prisma.$executeRawUnsafe("ALTER TABLE wechat_subscription_grants_qa_hidden RENAME TO wechat_subscription_grants");hidden=false;}assert.equal(forbiddenRequests,0);});
  } finally {
    if(hidden)await prisma.$executeRawUnsafe("ALTER TABLE wechat_subscription_grants_qa_hidden RENAME TO wechat_subscription_grants");
    for(const table of ["wechat_subscription_deliveries","wechat_subscription_grants","wechat_subscription_receipts","wechat_subscription_preferences"])await prisma.$executeRawUnsafe(`DELETE FROM ${table} WHERE user_id=ANY($1::text[])`,ids);
    await prisma.$executeRaw`DELETE FROM wechat_subscription_campaigns WHERE created_by=ANY(${ids}::text[])`;
    if(!initial.length)await prisma.$executeRaw`DELETE FROM wechat_subscription_settings`;
    await prisma.auditLog.deleteMany({where:{actorId:{in:ids}}});await prisma.session.deleteMany({where:{userId:{in:ids}}});await prisma.afterSalesRequest.deleteMany({where:{orderId:{in:orderIds}}});await prisma.shipment.deleteMany({where:{orderId:{in:orderIds}}});await prisma.order.deleteMany({where:{id:{in:orderIds}}});await prisma.weChatIdentity.deleteMany({where:{userId:{in:ids}}});await prisma.user.deleteMany({where:{id:{in:ids}}});
    globalThis.fetch=originalFetch;await prisma.$disconnect();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
}
main().catch(error=>{console.error(error instanceof Error?error.message:"Subscription regression failed");process.exitCode=1;});

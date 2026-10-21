import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";
import type { MemberOperationsConfig } from "@/lib/commerce/member-operations";

async function main() {
  const url = new URL(process.env.DATABASE_URL || "");
  assert.equal(url.pathname, "/vk_member_subscriptions_smoke_20261018", "Only the disposable member QA database is allowed");
  assert(["localhost", "127.0.0.1"].includes(url.hostname)); assert.equal(process.env.COMMERCE_STORAGE, "prisma");
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Error("Survey persistence QA must never call an external gateway"); };
  const { prisma } = await import("@/lib/db/prisma");
  const { defaultMemberOperationsConfig } = await import("@/lib/commerce/member-operations");
  const { defaultMemberSurveys } = await import("@/lib/commerce/member-surveys");
  const { getMemberOperations: overview, performMemberOperation: perform, getAdminMemberOperations: adminRead, saveMemberOperationsConfig: save } = await import("@/lib/services/member-operations-service");
  const { POST, GET } = await import("@/app/api/miniprogram/member-operations/route");
  const { createSessionToken, hashToken } = await import("@/lib/auth/session");
  assert.equal((await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`)[0].name, "vk_member_subscriptions_smoke_20261018");
  const original = await prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM member_operation_settings WHERE id = 'member-operations'`;
  assert.equal(original.length, 0, "This test requires fresh isolated settings and must not overwrite an existing program");
  const ids: string[] = [], suffix = randomUUID(); let revision = 0;
  const make = async (role: "CUSTOMER" | "OWNER" = "CUSTOMER") => {
    const value = await prisma.user.create({ data: { name: "survey-qa-" + suffix, phone: "138" + String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0"), role, ...(role === "CUSTOMER" ? { membership: { create: { pointsBalance: 1000 } } } : {}) } });
    ids.push(value.id); return value;
  };
  const balance = async (userId: string) => (await prisma.memberProfile.findUniqueOrThrow({ where: { userId } })).pointsBalance;
  const records = (userId: string) => prisma.$queryRaw<Array<{ id: string; kind: string; subjectId: string; payload: Record<string, unknown>; points: number }>>`SELECT id, kind, subject_id AS "subjectId", payload, points FROM member_operation_records WHERE user_id = ${userId} ORDER BY id`;
  async function write(actorId: string, config: MemberOperationsConfig) { revision = (await save(actorId, config, revision)).revision; }
  async function protectedRows() {
    const result: Record<string, string | null> = {};
    for (const table of ["orders", "order_items", "payment_intents", "shipments", "refunds", "products", "product_skus", "customer_profiles", "privacy_consents"]) {
      const values = await prisma.$queryRawUnsafe<Array<{ hash: string | null }>>(`SELECT md5(string_agg(row_to_json(t)::text, ',' ORDER BY row_to_json(t)::text)) AS hash FROM ${table} t`);
      result[table] = values[0].hash;
    }
    return result;
  }
  const legacyConfig = () => {
    const config = defaultMemberOperationsConfig();
    config.surveys = defaultMemberSurveys().map(survey => survey.id === "UNDERWEAR_SURVEY" ? survey : { ...survey, questions: survey.questions.slice(0, 2) });
    config.surveys[1].title = "风格问卷"; return config;
  };
  const answerAll = (survey: MemberOperationsConfig["surveys"][number]) => Object.fromEntries(survey.questions.map(question => [question.id,
    question.type === "MULTIPLE" ? question.options.slice(0, 2) : question.type === "TEXT" ? "隔离问卷回答，不发送给任何外部平台" : question.options[0]]));
  async function bearer(userId: string) { const value = createSessionToken(); await prisma.session.create({ data: { userId, tokenHash: hashToken(value), expiresAt: new Date(Date.now() + 120_000) } }); return value; }
  const request = (token: string, input?: unknown) => new Request("http://qa.invalid/api/miniprogram/member-operations", { method: input ? "POST" : "GET", headers: { authorization: "Bearer " + token, host: "qa.invalid", ...(input ? { "Content-Type": "application/json" } : {}) }, ...(input ? { body: JSON.stringify(input) } : {}) });
  try {
    const owner = await make("OWNER"), buyer = await make(), legacy = await make(), other = await make();
    const protectedBefore = await protectedRows();
    await test("read-time expansion exposes ten real server questions but never activates or rewrites stored legacy settings", async () => {
      await write(owner.id, legacyConfig());
      const before = await prisma.$queryRaw<Array<{ revision: number; config: MemberOperationsConfig }>>`SELECT revision, config FROM member_operation_settings WHERE id = 'member-operations'`;
      const result = await overview(buyer.id);
      assert.deepEqual(result.surveys.map(survey => survey.questions.length), [10, 10, 2]);
      assert(result.surveys.every(survey => !survey.enabled)); assert(result.tasks.every(task => !task.enabled));
      assert.deepEqual(await prisma.$queryRaw`SELECT revision, config FROM member_operation_settings WHERE id = 'member-operations'`, before);
      assert.equal((await records(buyer.id)).length, 0); assert.equal(await balance(buyer.id), 1000);
    });
    await test("custom merchant question definitions survive server reads unchanged", async () => {
      const custom = legacyConfig(); custom.surveys[0].questions[0].title = "商家自己的穿着感受问题"; custom.surveys[0].questions[0].options = ["自定义甲", "自定义乙"];
      await write(owner.id, custom);
      assert.deepEqual((await overview(buyer.id)).surveys[0].questions, custom.surveys[0].questions);
    });
    const enabled = defaultMemberOperationsConfig(); enabled.tasks.PREFERENCES.enabled = true; enabled.tasks.STYLE_SURVEY.enabled = true;
    for (const survey of enabled.surveys) if (survey.id !== "UNDERWEAR_SURVEY") survey.enabled = true;
    await write(owner.id, enabled);
    await test("historical two-answer completion and reward records remain valid without another award", async () => {
      const surveyId = "PREFERENCES", surveyRecordId = "mo_" + createHash("sha256").update(JSON.stringify(["SURVEY", legacy.id, surveyId])).digest("hex");
      const claimSubject = "PREFERENCES:LIFETIME:LIFETIME", claimRecordId = "mo_" + createHash("sha256").update(JSON.stringify(["CLAIM", legacy.id, claimSubject])).digest("hex");
      const payload = { surveyId, title: "穿着偏好", answers: { fit: "适中", focus: ["透气"] }, ruleRevision: 1 };
      const claimPayload = { taskKey: surveyId, sourceId: "LIFETIME", period: "LIFETIME", ruleRevision: 1 };
      // These are explicit historical fixtures inside the empty QA database only.
      await prisma.$executeRaw`INSERT INTO member_operation_records(id,kind,user_id,subject_id,state,payload,points) VALUES (${surveyRecordId},'SURVEY',${legacy.id},${surveyId},'APPROVED',${JSON.stringify(payload)}::jsonb,0),(${claimRecordId},'CLAIM',${legacy.id},${claimSubject},'REWARDED',${JSON.stringify(claimPayload)}::jsonb,100)`;
      await prisma.pointEntry.create({ data: { userId: legacy.id, eventKey: "member-operation:" + claimRecordId, delta: 100, balanceAfter: 1000, reason: "隔离历史奖励记录" } });
      const before = await records(legacy.id), ledger = await prisma.pointEntry.findMany({ where: { userId: legacy.id } });
      assert.equal((await overview(legacy.id)).surveys.find(survey => survey.id === surveyId)!.completed, true);
      const result = await perform(legacy.id, { action: "submit_survey", surveyId, answers: payload.answers });
      assert.equal("rewardPoints" in result ? result.rewardPoints : undefined, 0); assert.equal(await balance(legacy.id), 1000);
      assert.deepEqual(await records(legacy.id), before); assert.deepEqual(await prisma.pointEntry.findMany({ where: { userId: legacy.id } }), ledger);
    });
    await test("ten actual answers persist through the authenticated route with a question snapshot and one reward under concurrent retry", async () => {
      const token = await bearer(buyer.id), survey = enabled.surveys[0], answers = answerAll(survey);
      const input = { action: "submit_survey", surveyId: "PREFERENCES", answers };
      const responses = await Promise.all([POST(request(token, input)), POST(request(token, input))]);
      for (const response of responses) { assert.equal(response.status, 200); assert.match(response.headers.get("cache-control") || "", /no-store/); }
      const saved = await records(buyer.id), surveyRows = saved.filter(record => record.kind === "SURVEY"), claims = saved.filter(record => record.kind === "CLAIM");
      assert.equal(surveyRows.length, 1); assert.deepEqual(surveyRows[0].payload.answers, answers); assert.deepEqual(surveyRows[0].payload.questions, survey.questions);
      assert.equal(Object.keys(surveyRows[0].payload.answers as object).length, 10); assert.equal(surveyRows[0].payload.ruleRevision, revision);
      assert.equal(claims.length, 1); assert.equal(await balance(buyer.id), 1100); assert.equal(await balance(other.id), 1000);
      assert.equal(await prisma.pointEntry.count({ where: { userId: buyer.id } }), 1);
      const dto = await (await GET(request(token))).json(); assert.equal(dto.surveys.find((item: { id: string }) => item.id === "PREFERENCES").completed, true);
      const admin = await adminRead(owner.id); assert.deepEqual(admin.records.find(record => record.id === surveyRows[0].id)!.payload.answers, answers);
    });
    await test("style answers may omit optional budget and retain their original snapshot after merchant edits", async () => {
      const survey = enabled.surveys[1], answers = answerAll(survey); delete answers.budget;
      await perform(other.id, { action: "submit_survey", surveyId: "STYLE_SURVEY", answers });
      const before = (await records(other.id)).find(record => record.kind === "SURVEY")!;
      const changed = structuredClone(enabled); changed.surveys[1].questions[0].title = "之后修改的新标题"; await write(owner.id, changed);
      assert.deepEqual((await records(other.id)).find(record => record.kind === "SURVEY"), before); assert.equal(await balance(other.id), 1050);
    });
    await test("forged caller IDs, invalid options and unknown question IDs cannot save answers or reward the target", async () => {
      const token = await bearer(other.id), before = await records(other.id), initial = await balance(other.id);
      for (const input of [
        { action: "submit_survey", surveyId: "PREFERENCES", answers: { fit: "适中", focus: ["透气"] }, userId: buyer.id },
        { action: "submit_survey", surveyId: "PREFERENCES", answers: { fit: "伪造选项", focus: ["透气"] } },
        { action: "submit_survey", surveyId: "PREFERENCES", answers: { fit: "适中", focus: ["透气"], unknown: "未知题目" } },
      ]) assert.equal((await POST(request(token, input))).status, 400);
      assert.deepEqual(await records(other.id), before); assert.equal(await balance(other.id), initial);
    });
    await test("survey work never changes existing order, payment, inventory or private contact rows", async () => { assert.deepEqual(await protectedRows(), protectedBefore); });
  } finally {
    await prisma.$executeRaw`DELETE FROM member_operation_records WHERE user_id = ANY(${ids}::text[])`;
    await prisma.$executeRaw`DELETE FROM member_operation_settings WHERE id = 'member-operations'`;
    await prisma.auditLog.deleteMany({ where: { actorId: { in: ids } } });
    await prisma.pointEntry.deleteMany({ where: { userId: { in: ids } } }); await prisma.session.deleteMany({ where: { userId: { in: ids } } });
    await prisma.memberProfile.deleteMany({ where: { userId: { in: ids } } }); await prisma.user.deleteMany({ where: { id: { in: ids } } });
    globalThis.fetch = originalFetch; await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Survey persistence QA failed"); process.exitCode = 1; });

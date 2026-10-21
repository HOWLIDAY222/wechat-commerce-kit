import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { defaultMemberOperationsConfig, memberOperationInputSchema, memberOperationsAdminInputSchema, memberOperationsConfigSchema } from "../../lib/commerce/member-operations";
import { studentCertification, studentVerification, studentVerificationUnavailable, studentTestIdentitiesKey } from "../../lib/commerce/member-student";

const oldConfig = defaultMemberOperationsConfig();
oldConfig.tasks.STUDENT.enabled = true;
oldConfig.studentBenefits = { enabled: true, couponTemplateIds: ["student-first", "student-second"], firstSocialPoints: 1500 };
const serviceFile = "lib/services/member-operations-service.ts";

function functions(file: string, names: string[], scope: Record<string, unknown>) {
  const source = readFileSync(join(process.cwd(), file), "utf8");
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declarations = parsed.statements.filter(statement => ts.isFunctionDeclaration(statement) && names.includes(statement.name?.text ?? ""));
  assert.equal(declarations.length, names.length);
  const module = { exports: {} };
  runInNewContext(ts.transpileModule(declarations.map(statement => statement.getText(parsed)).join("\n") +
    "\nmodule.exports={" + names.join(",") + "};", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
  { ...scope, exports: module.exports, module }, { timeout: 1000 });
  return module.exports as Record<string, (...args: unknown[]) => unknown>;
}
const unavailable = () => { throw Error("Unexpected side effect before the student gate"); };
const field = (payload: Record<string, unknown>, key: string) => typeof payload[key] === "string" ? payload[key] : "";
const baseScope = { studentVerificationUnavailable, field, memberOperationInputSchema, memberOperationsAdminInputSchema, memberOperationsConfigSchema,
  ready: async () => undefined, admin: async () => undefined, lockUser: async () => undefined, userForOperation: async () => ({ joinedAt: new Date() }),
  setting: async () => ({ revision: 2, config: oldConfig }), disabled: () => Error("MEMBER_OPERATIONS_DISABLED"),
  prisma: { $transaction: async (work: (tx: object) => unknown) => work({}) } };

test("WeChat capability is ready while historical manual dates never authorize student benefits", () => {
  assert.deepEqual(studentVerification, { provider: "WECHAT", status: "READY", available: true });
  const legacy = { approvedAt: new Date(Date.now() - 1000).toISOString(), validUntil: new Date(Date.now() + 86400000).toISOString(), cycleId: "legacy-manual" };
  assert.equal(studentCertification(legacy, new Date()).valid, false, "Manual dates do not constitute WeChat verification");
  assert.equal(studentVerification.available, true, "Official verification is available independently of legacy data");
});

test("effective config preserves enabled WeChat tasks and benefits without changing stored configuration", () => {
  const before = structuredClone(oldConfig);
  const fn = functions(serviceFile, ["effectiveMemberOperationsConfig"], {}).effectiveMemberOperationsConfig;
  const output = fn(oldConfig) as typeof oldConfig;
  assert.equal(output.tasks.STUDENT.enabled, true); assert.equal(output.studentBenefits.enabled, true);
  assert.equal(output.studentBenefits.firstSocialPoints, 1500); assert.deepEqual(output.studentBenefits.couponTemplateIds, oldConfig.studentBenefits.couponTemplateIds);
  const { STUDENT: unused, ...otherTasks } = output.tasks;
  const { STUDENT: original, ...originalOtherTasks } = oldConfig.tasks;
  assert.deepEqual(otherTasks, originalOtherTasks); assert.deepEqual(oldConfig, before); assert.ok(unused && original);
});

test("student claims reject before any record, point or coupon access even when old settings are enabled", async () => {
  const fn = functions(serviceFile, ["claim"], { studentVerificationUnavailable }).claim;
  await assert.rejects(async () => fn(new Proxy({}, { get: unavailable }), "user", "STUDENT", "LIFETIME", { config: oldConfig }), /MEMBER_STUDENT_VERIFICATION_UNAVAILABLE/);
});

test("student screenshots reject before normalization, storage, membership queries or file access", async () => {
  const fn = functions("lib/services/member-social-proof-service.ts", ["uploadSocialProof"], {
    studentVerificationUnavailable, assertSocialProofStorage: unavailable, normalizeUploadedImage: unavailable, mkdir: unavailable, writeFile: unavailable,
  }).uploadSocialProof;
  await assert.rejects(async () => fn("user", "student-request", new Proxy({}, { get: unavailable }), "STUDENT"), /MEMBER_STUDENT_VERIFICATION_UNAVAILABLE/);
});

test("the actual customer action rejects old manual student forms before creating or binding an application", async () => {
  const fn = functions(serviceFile, ["performMemberOperation"], { ...baseScope, bySubject: unavailable, insertRecord: unavailable, bindSocialProofs: unavailable }).performMemberOperation;
  await assert.rejects(async () => fn("user", { action: "submit_application", taskKey: "STUDENT", detail: {
    school: "Old manual school", graduationYear: 2028, note: "Old client request", proofKeys: ["msu_" + "a".repeat(32)],
  } }), /MEMBER_STUDENT_VERIFICATION_UNAVAILABLE/);
});

test("both administrative approval and rejection of a historical student application fail without changing history or issuing rewards", async () => {
  const record = { id: "student-record", userId: "user", kind: "APPLICATION", state: "PENDING", revision: 1, payload: { taskKey: "STUDENT" } };
  const before = structuredClone(record);
  const fn = functions(serviceFile, ["reviewMemberOperation"], { ...baseScope, readRecord: async () => record,
    isSocialApplication: () => false, updateRecord: unavailable, claim: unavailable, bindSocialProofs: unavailable, writeAudit: unavailable }).reviewMemberOperation;
  for (const decision of ["APPROVED", "REJECTED"]) await assert.rejects(async () => fn("admin", {
    action: "review_application", id: record.id, decision, note: "Do not issue student rewards", expectedRevision: 1,
  }), /MEMBER_STUDENT_VERIFICATION_UNAVAILABLE/);
  assert.deepEqual(record, before);
});

test("enabled student rules still require genuine WeChat proof and exclude virtual test identities", () => {
  assert(memberOperationsConfigSchema.safeParse(oldConfig).success);
  const now = new Date(), verified = { verificationProvider: "WECHAT", proofVersion: "wechat-student-v1", bindStatus: 3, isStudent: true, testIdentity: false, identityHash: "a".repeat(64), cycleId: "wechat_cycle_test" };
  assert.equal(studentCertification(verified, now, now).valid, true);
  for (const patch of [{verificationProvider:"MANUAL"},{testIdentity:true},{bindStatus:2},{identityHash:""},{isStudent:false}]) assert.equal(studentCertification({...verified,...patch},now,now).valid,false);
});

test("social screenshot approval cannot manufacture a student bonus from legacy manual approval", async () => {
 const legacy={payload:{taskKey:"STUDENT",approvedAt:new Date().toISOString(),validUntil:new Date(Date.now()+86400000).toISOString()},updatedAt:new Date()};
 const fn=functions(serviceFile,["claimStudentSocialBonus"],{latestStudentRecord:async()=>legacy,studentCertification,field,changeMemberPoints:unavailable,insertRecord:unavailable}).claimStudentSocialBonus;
 assert.equal(await fn({}, {userId:"user",payload:{studentCycleId:"legacy"},createdAt:new Date()}, {config:oldConfig}, "admin"),0);
});

test("the lower-level event issuer blocks new student coupons before template inventory or audit mutations", async () => {
  const fn = functions("lib/services/membership-service.ts", ["issueEventMemberCoupon"], { createHash, studentVerificationUnavailable, studentCertification, studentTestIdentitiesKey }).issueEventMemberCoupon;
  const tx = { $queryRaw: async () => [], $executeRaw: async () => undefined, siteSetting: { findUnique: async () => ({ value: { identityHashes: [] } }) }, memberProfile: { findUnique: async () => ({ user: { role: "CUSTOMER", status: "ACTIVE" } }) },
    couponClaim: { findUnique: async () => null }, couponTemplate: new Proxy({}, { get: unavailable }), auditLog: new Proxy({}, { get: unavailable }) };
  await assert.rejects(async () => fn(tx, { userId: "user", templateId: "student", eventKey: "student:pending:new", source: "STUDENT", reason: "Must not issue" }), /MEMBER_STUDENT_VERIFICATION_UNAVAILABLE/);
});

test("identical historical student events can replay their existing claim without creating or revoking anything", async () => {
  const fn = functions("lib/services/membership-service.ts", ["issueEventMemberCoupon"], { createHash, studentVerificationUnavailable }).issueEventMemberCoupon;
  const expiresAt = new Date(Date.now() + 86400000);
  const id = "reward-" + createHash("sha256").update("student:historic:repeat").digest("hex");
  const tx = { $executeRaw: async () => undefined, memberProfile: { findUnique: async () => ({ user: { role: "CUSTOMER", status: "ACTIVE" } }) },
    couponClaim: { findUnique: async () => ({ id, userId: "user", templateId: "student", source: "STUDENT", expiresAt }) },
    couponTemplate: new Proxy({}, { get: unavailable }), auditLog: new Proxy({}, { get: unavailable }) };
  const result = await fn(tx, { userId: "user", templateId: "student", eventKey: "student:historic:repeat", source: "STUDENT", reason: "History only", expiresAt });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { id, alreadyClaimed: true });
});

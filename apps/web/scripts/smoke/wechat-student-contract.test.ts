import assert from "node:assert/strict";
import { test } from "node:test";
import { createWeChatStudentProvider } from "@/lib/providers/wechat-student";
import { studentCertification, studentVerificationInputSchema, studentConsentVersion } from "@/lib/commerce/member-student";

function provider(value: unknown, calls: Array<{ url: string; body: unknown }> = []) {
  const fetcher: typeof fetch = async (input, init) => { const url = String(input); calls.push({ url, body: JSON.parse(String(init?.body)) });
    return Response.json(url.includes("stable_token") ? { access_token: "test-token-do-not-print", expires_in: 7200 } : value); };
  return createWeChatStudentProvider({ appId: "wx-student-unit", appSecret: "unit-secret", apiBaseUrl: "https://example.invalid", fetcher });
}
for (const bind_status of [1,2,3] as const) for (const is_student of [true,false]) test(`binding ${bind_status}, student ${is_student} only grants bound true`, async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const result = await provider({ errcode: 0, bind_status, is_student }, calls)("user-granted-code", "session-derived-openid");
  assert.equal(result.isStudent, bind_status === 3 && is_student);
  assert.deepEqual(calls[1].body, { openid: "session-derived-openid", wx_studentcheck_code: "user-granted-code" });
  assert.equal(new URL(calls[1].url).pathname, "/intp/quickcheckstudentidentity");
});
for (const value of [null, {}, {errcode:0,bind_status:3,is_student:"true"}, {errcode:0,bind_status:4,is_student:true}, {bind_status:3,is_student:true}]) test(`malformed response ${JSON.stringify(value)} never proves student`, async () => {
  await assert.rejects(provider(value)("code", "openid"), /WECHAT_STUDENT_INVALID_RESPONSE/);
});
for (const [errcode, error] of [[40097,"CODE_INVALID"],[83400,"CODE_INVALID"],[83402,"CODE_INVALID"],[83401,"RATE_LIMITED"],[48001,"PERMISSION_REQUIRED"],[61007,"PERMISSION_REQUIRED"],[-1,"CHECK_FAILED"]]) test(`provider ${errcode} maps a safe error`, async () => {
  await assert.rejects(provider({errcode,errmsg:"secret-token-and-user-code"})("code","openid"), new RegExp("^Error: WECHAT_STUDENT_"+error+"$"));
});
test("shared token acquisition is cached across concurrent checks", async () => {
  const calls: Array<{url:string;body:unknown}>=[],check=provider({errcode:0,bind_status:3,is_student:true},calls);
  await Promise.all([check("code-one","openid-one"),check("code-two","openid-two")]);
  assert.equal(calls.filter(c=>c.url.includes("stable_token")).length,1);assert.equal(calls.length,3);
});
test("forged identity, awards, missing or unrelated consent are rejected", () => {
  const value={code:"user-code",requestId:"request-student-0001",consentVersion:studentConsentVersion};assert(studentVerificationInputSchema.safeParse(value).success);
  for(const extra of [{openid:"forged"},{is_student:true},{rewardPoints:9999},{testIdentity:false},{consentVersion:"old"},{consentVersion:undefined},{code:" "}])assert.equal(studentVerificationInputSchema.safeParse({...value,...extra}).success,false);
});
test("only server WeChat proofs can create an unexpired 180 day certification",()=>{
  const approved=new Date("2026-10-19T00:00:00Z"),expires=new Date(approved.getTime()+180*86400000);
  const proof={verificationProvider:"WECHAT",proofVersion:"wechat-student-v1",bindStatus:3,isStudent:true,testIdentity:false,identityHash:"a".repeat(64),cycleId:"cycle-student-1",approvedAt:approved.toISOString(),validUntil:expires.toISOString()};
  assert.equal(studentCertification(proof,approved,new Date(expires.getTime()-1)).valid,true);
  assert.equal(studentCertification(proof,approved,expires).valid,false);
  for(const patch of [{verificationProvider:"MANUAL"},{proofVersion:""},{testIdentity:true},{bindStatus:2},{validUntil:new Date(expires.getTime()+1).toISOString()},{approvedAt:"invalid"}])assert.equal(studentCertification({...proof,...patch},approved,approved).valid,false);
  assert.equal(studentCertification({approvedAt:approved.toISOString(),validUntil:expires.toISOString()},approved,approved).valid,false);
});

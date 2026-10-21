import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";

async function main() {
  const database=new URL(process.env.DATABASE_URL??"");assert.equal(database.pathname,"/vk_student_verification_smoke_20261019");assert(["localhost","127.0.0.1"].includes(database.hostname));assert.equal(process.env.COMMERCE_STORAGE,"prisma");
  const {prisma}=await import("@/lib/db/prisma");
  const {defaultMemberOperationsConfig}=await import("@/lib/commerce/member-operations");
  const {studentConsentVersion,studentTestIdentitiesKey}=await import("@/lib/commerce/member-student");
  const {verifyWeChatStudent,getMemberOperations,performMemberOperation,reviewMemberOperation,saveMemberOperationsConfig}=await import("@/lib/services/member-operations-service");
  const {issueEventMemberCoupon}=await import("@/lib/services/membership-service");
  const stale=await prisma.user.findMany({where:{name:{startsWith:"student-isolated-"}},select:{id:true}}),staleIds=stale.map(row=>row.id);
  if(staleIds.length){
    await prisma.$executeRaw`DELETE FROM member_operation_records WHERE user_id=ANY(${staleIds}::text[])`;
    await prisma.couponClaim.deleteMany({where:{userId:{in:staleIds}}});await prisma.pointEntry.deleteMany({where:{userId:{in:staleIds}}});
    await prisma.auditLog.deleteMany({where:{actorId:{in:staleIds}}});await prisma.memberProfile.deleteMany({where:{userId:{in:staleIds}}});
    await prisma.weChatIdentity.deleteMany({where:{userId:{in:staleIds}}});await prisma.user.deleteMany({where:{id:{in:staleIds}}});
    await prisma.couponTemplate.deleteMany({where:{title:{startsWith:"Student isolated QA "}}});
  }
  const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error("Live gateway forbidden in isolated QA")};
  const users:string[]=[],templates:string[]=[],suffix=randomUUID();let serial=0,checks=0;
  const appId=process.env.WECHAT_MINIPROGRAM_APP_ID!;assert(appId);
  const input=(tag:string)=>({code:"authorized-code-"+tag,requestId:"student-request-"+tag,consentVersion:studentConsentVersion});
  async function user(role:"CUSTOMER"|"ADMIN"="CUSTOMER"){
    const row=await prisma.user.create({data:{role,name:"student-isolated-"+suffix,phone:"139"+String(++serial).padStart(8,"0"),...(role==="CUSTOMER"?{membership:{create:{pointsBalance:1000}}}:{} )}});users.push(row.id);
    if(role==="CUSTOMER")await prisma.weChatIdentity.create({data:{userId:row.id,appId,openId:"openid-"+row.id}});return row.id;
  }
  const genuine=async(code:string,openId:string)=>{checks++;assert(code.startsWith("authorized-code-"));assert(openId.startsWith("openid-"));return{bindStatus:3 as const,isStudent:true};};
  async function social(userId:string,cycleId:string){const id="social-"+randomUUID();const payload={applicationType:"SOCIAL_POST",taskKey:"SOCIAL_POST",campaignKey:"SOCIAL_POST",platform:"XIAOHONGSHU",postUrl:"https://www.xiaohongshu.com/explore/"+randomUUID().replaceAll("-",""),studentCycleId:cycleId,proofKeys:[]};
    await prisma.$executeRaw`INSERT INTO member_operation_records(id,kind,user_id,subject_id,state,payload) VALUES(${id},'APPLICATION',${userId},${id},'PENDING',${JSON.stringify(payload)}::jsonb)`;return id;}
  async function cert(userId:string){return(await prisma.$queryRaw<Array<{id:string;payload:Record<string,unknown>}>>`SELECT id,payload FROM member_operation_records WHERE user_id=${userId} AND payload->>'taskKey'='STUDENT' AND payload->>'testIdentity'='false' ORDER BY created_at DESC LIMIT 1`)[0];}
  try{
    assert.equal((await prisma.$queryRaw<Array<{count:bigint}>>`SELECT count(*) AS count FROM member_operation_settings`)[0].count,BigInt(0));
    const admin=await user("ADMIN"),member=await user(),tester=await user();
    const testerHash=createHash("sha256").update(appId+":openid-"+tester).digest("hex");
    await prisma.siteSetting.create({data:{key:studentTestIdentitiesKey,value:{identityHashes:[testerHash]}}});
    for(const [amountCents,minimumCents]of [[10000,60000],[40000,220000]]){const row=await prisma.couponTemplate.create({data:{title:"Student isolated QA "+suffix,amountCents,minimumCents,deliveryMode:"REWARD",active:true,totalLimit:100,startsAt:new Date(Date.now()-86400000),endsAt:new Date(Date.now()+365*86400000)}});templates.push(row.id);}
    const config=defaultMemberOperationsConfig();config.tasks.STUDENT.enabled=true;config.studentBenefits={enabled:true,couponTemplateIds:templates,firstSocialPoints:1500};config.social.enabled=true;config.tasks.SOCIAL_FIRST_POST.enabled=true;config.tasks.SOCIAL_POST.enabled=true;
    await saveMemberOperationsConfig(admin,config,0);
    await test("WeChat proof grants 100 once and two coupons with a shared 180 day expiry",async()=>{
      const result=await verifyWeChatStudent(member,input("first"),genuine);assert.equal(result.status,"VERIFIED");assert.equal(result.rewardPoints,100);assert.equal(result.couponsIssued,2);
      assert.equal((await prisma.memberProfile.findUniqueOrThrow({where:{userId:member}})).pointsBalance,1100);
      const coupons=await prisma.couponClaim.findMany({where:{userId:member,source:"STUDENT"}});assert.equal(coupons.length,2);
      assert(coupons.every(c=>c.expiresAt?.toISOString()===result.validUntil));assert(Math.abs(new Date(result.validUntil!).getTime()-Date.now()-180*86400000)<5000);
      const dto=await getMemberOperations(member);assert.equal(dto.student.valid,true);assert.equal(dto.student.benefitsEnabled,true);
    });
    await test("parallel auth/close retries and fresh codes do not reissue any reward",async()=>{
      const before=checks;const results=await Promise.all(Array.from({length:3},(_,i)=>verifyWeChatStudent(member,input("repeat-"+i),genuine)));
      assert(results.every(r=>r.rewardPoints===0&&r.couponsIssued===0));assert.equal(checks,before);
      assert.equal(await prisma.couponClaim.count({where:{userId:member,source:"STUDENT"}}),2);
    });
    await test("registered virtual test identity can validate but receives no points, coupons or student social bonus",async()=>{
      const result=await verifyWeChatStudent(tester,input("tester"),genuine);assert.equal(result.status,"TEST_VERIFIED");assert.equal(result.rewardPoints,0);assert.equal(result.couponsIssued,0);
      assert.equal((await prisma.memberProfile.findUniqueOrThrow({where:{userId:tester}})).pointsBalance,1000);assert.equal(await prisma.couponClaim.count({where:{userId:tester}}),0);
      const dto=await getMemberOperations(tester);assert.equal(dto.student.valid,false);assert.equal(dto.student.testVerified,true);
    });
    await test("manual approvals and client-supplied student facts cannot authorize rewards",async()=>{
      await assert.rejects(verifyWeChatStudent(tester,{...input("forged"),openid:"forged",is_student:true},genuine),/INVALID_STUDENT_VERIFICATION/);
      await assert.rejects(performMemberOperation(member,{action:"submit_application",taskKey:"STUDENT",detail:{school:"Not collected",graduationYear:2028,note:"manual"}}),/MEMBER_STUDENT_VERIFICATION_UNAVAILABLE/);
      await assert.rejects(prisma.$transaction(tx=>issueEventMemberCoupon(tx,{userId:tester,templateId:templates[0],source:"STUDENT",eventKey:"student:forged-event",reason:"must reject",expiresAt:new Date(Date.now()+180*86400000)})),/MEMBER_STUDENT_VERIFICATION_UNAVAILABLE/);
    });
    await test("pending, unbound, nonstudent and mismatched-code results grant nothing",async()=>{
      for(const state of [{bindStatus:1 as const,isStudent:false},{bindStatus:2 as const,isStudent:true},{bindStatus:3 as const,isStudent:false}]){const customer=await user();const result=await verifyWeChatStudent(customer,input("negative-"+serial),async()=>state);assert.notEqual(result.status,"VERIFIED");assert.equal(result.rewardPoints,0);assert.equal(await prisma.couponClaim.count({where:{userId:customer}}),0);}
      const customer=await user();await assert.rejects(verifyWeChatStudent(customer,input("mismatch"),async()=>{throw Error("WECHAT_STUDENT_CODE_INVALID")}),/WECHAT_STUDENT_CODE_INVALID/);assert.equal(await prisma.pointEntry.count({where:{userId:customer}}),0);
    });
    await test("first post in this verified cycle gives 1500 total; the next gives the ordinary 20",async()=>{
      const certificate=await cert(member),id=await social(member,String(certificate.payload.cycleId));
      const first=await reviewMemberOperation(admin,{action:"review_application",id,decision:"APPROVED",note:"isolated review",expectedRevision:1});assert.equal(first.rewardPoints,1500);
      const next=await social(member,String(certificate.payload.cycleId));const following=await reviewMemberOperation(admin,{action:"review_application",id:next,decision:"APPROVED",note:"isolated review",expectedRevision:1});assert.equal(following.rewardPoints,20);
      const testPost=await social(tester,String((await getMemberOperations(tester)).student.certification?.cycleId));const regular=await reviewMemberOperation(admin,{action:"review_application",id:testPost,decision:"APPROVED",note:"isolated review",expectedRevision:1});assert.equal(regular.rewardPoints,5);
    });
    await test("180 day renewal creates one fresh coupon pair but never repeats the lifetime 100 points",async()=>{
      const old=await cert(member),approvedAt=new Date(Date.now()-181*86400000).toISOString(),validUntil=new Date(Date.now()-86400000).toISOString();
      await prisma.$executeRaw`UPDATE member_operation_records SET payload=payload||${JSON.stringify({approvedAt,validUntil})}::jsonb WHERE id=${old.id}`;
      const renewed=await verifyWeChatStudent(member,input("renewal"),genuine);assert.equal(renewed.status,"VERIFIED");assert.equal(renewed.rewardPoints,0);assert.equal(renewed.couponsIssued,2);assert.equal(await prisma.couponClaim.count({where:{userId:member,source:"STUDENT"}}),4);
      const current=await cert(member);assert.notEqual(current.payload.cycleId,old.payload.cycleId);
      const stale=await social(member,String(old.payload.cycleId));const staleReward=await reviewMemberOperation(admin,{action:"review_application",id:stale,decision:"APPROVED",note:"old cycle cannot gain new bonus",expectedRevision:1});assert.equal(staleReward.rewardPoints,20);
      const post=await social(member,String(current.payload.cycleId));const fresh=await reviewMemberOperation(admin,{action:"review_application",id:post,decision:"APPROVED",note:"new cycle review",expectedRevision:1});assert.equal(fresh.rewardPoints,1500);
    });
    await test("coupon stock failure rolls back the entire certification and its first points",async()=>{
      const customer=await user();await prisma.couponTemplate.update({where:{id:templates[1]},data:{active:false}});
      await assert.rejects(verifyWeChatStudent(customer,input("rollback"),genuine),/MEMBER_REWARD_COUPON_UNAVAILABLE/);assert.equal(await prisma.pointEntry.count({where:{userId:customer}}),0);assert.equal(await prisma.couponClaim.count({where:{userId:customer}}),0);assert.equal(await cert(customer),undefined);
    });
    assert.equal(await prisma.order.count(),0,"No synthetic orders are required");
  }finally{
    globalThis.fetch=originalFetch;
    await prisma.$executeRaw`DELETE FROM member_operation_records WHERE user_id=ANY(${users}::text[])`;
    await prisma.$executeRaw`DELETE FROM member_operation_settings WHERE id='member-operations'`;
    await prisma.couponClaim.deleteMany({where:{userId:{in:users}}});await prisma.pointEntry.deleteMany({where:{userId:{in:users}}});
    await prisma.auditLog.deleteMany({where:{OR:[{actorId:{in:users}},{targetId:{in:users}}, {action:{startsWith:"member."}}]}});
    await prisma.siteSetting.deleteMany({where:{key:studentTestIdentitiesKey}});await prisma.memberProfile.deleteMany({where:{userId:{in:users}}});await prisma.weChatIdentity.deleteMany({where:{userId:{in:users}}});await prisma.user.deleteMany({where:{id:{in:users}}});await prisma.couponTemplate.deleteMany({where:{id:{in:templates}}});await prisma.$disconnect();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1});

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import sharp from 'sharp';
async function main(){
 const database=new URL(process.env.DATABASE_URL||'');assert.equal(database.pathname,'/vk_member_rewards_v3_smoke_20261018');assert(['127.0.0.1','localhost'].includes(database.hostname));assert(process.env.UPLOAD_DIR?.includes('/community-fixtures/qa-uploads/'));
 globalThis.fetch=async()=>{throw Error('No external requests in isolated reward tests');};
 const {prisma}=await import('@/lib/db/prisma');const {defaultMemberOperationsConfig}=await import('@/lib/commerce/member-operations');
 const {performMemberOperation:perform,reviewMemberOperation:review,saveMemberOperationsConfig:configure}=await import('@/lib/services/member-operations-service');
 const {uploadSocialProof:upload}=await import('@/lib/services/member-social-proof-service');
 const ids:string[]=[],suffix=randomUUID().replaceAll('-','');let sequence=0;
 try{
  assert.equal(Number((await prisma.$queryRaw<Array<{count:bigint}>>`SELECT count(*) AS count FROM member_operation_settings`)[0].count),0);
  const admin=await prisma.user.create({data:{name:'unlimited-qa-'+suffix,role:'ADMIN'}});ids.push(admin.id);
  const member=await prisma.user.create({data:{name:'unlimited-qa-'+suffix,phone:'13900000019',role:'CUSTOMER',membership:{create:{pointsBalance:0}}}});ids.push(member.id);
  const config=defaultMemberOperationsConfig();config.social.enabled=true;config.tasks.SOCIAL_FIRST_POST.enabled=true;config.tasks.SOCIAL_POST.enabled=true;await configure(admin.id,config,0);
  async function proof(){const n=++sequence;const bytes=await sharp({create:{width:110,height:90,channels:3,background:{r:n%250,g:n*3%250,b:n*7%250}}}).png().toBuffer();return (await upload(member.id,'unlimited-proof-'+n,new File([new Uint8Array(bytes)],'proof.png',{type:'image/png'}))).id;}
  async function submit(proofId:string){const n=++sequence;return await perform(member.id,{action:'submit_social_submission',campaignKey:'SOCIAL_POST',platform:'XIAOHONGSHU',postUrl:'https://www.xiaohongshu.com/explore/'+suffix+n,note:'本人实际发布的独立品牌体验，隔离测试材料。',proofKeys:[proofId],requestId:'unlimited-post-'+n}) as {submission:{id:string;revision:number}};}
  await test('more than thirty distinct real-content submissions and uploads in one day can each earn rewards',async()=>{
   for(let i=0;i<35;i++){
    // Advance only the anti-burst window; all rows stay within the same day.
    await prisma.auditLog.updateMany({where:{actorId:member.id,action:{in:['member.social.proof.uploaded','member.social.submission.created']}},data:{createdAt:new Date(Date.now()-120000)}});
    const item=await submit(await proof());await review(admin.id,{action:'review_application',id:item.submission.id,decision:'APPROVED',expectedRevision:item.submission.revision,note:'核对独立内容通过'});
   }
   assert.equal((await prisma.memberProfile.findUniqueOrThrow({where:{userId:member.id}})).pointsBalance,5+34*20);
   assert.equal(Number((await prisma.$queryRaw<Array<{count:bigint}>>`SELECT count(*) AS count FROM member_social_uploads WHERE user_id=${member.id}`)[0].count),35);
  });
  await test('short submission bursts are still rate-limited without consuming a new reward',async()=>{
   const material=await proof();await prisma.auditLog.createMany({data:Array.from({length:5},()=>({actorId:member.id,actorType:'user',action:'member.social.submission.created',targetType:'member-operation',targetId:'burst-qa'}))});
   const clock=await prisma.$queryRaw<Array<Record<string,unknown>>>`SELECT current_setting('TimeZone') AS timezone,CURRENT_TIMESTAMP::text AS now,max(created_at)::text AS latest,count(*) FILTER(WHERE created_at>CURRENT_TIMESTAMP-INTERVAL '1 minute')::int AS local_count,count(*) FILTER(WHERE created_at>(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')-INTERVAL '1 minute')::int AS utc_count FROM audit_logs WHERE actor_id=${member.id} AND action='member.social.submission.created'`;
   await assert.rejects(submit(material),/MEMBER_OPERATIONS_RATE_LIMITED/,JSON.stringify(clock));
  });
  await test('short private-upload bursts are rate-limited independently of lifetime task rewards',async()=>{
   await prisma.auditLog.createMany({data:Array.from({length:15},()=>({actorId:member.id,actorType:'user',action:'member.social.proof.uploaded',targetType:'member-social-proof',targetId:'burst-qa'}))});
   await assert.rejects(proof(),/MEMBER_OPERATIONS_RATE_LIMITED/);
  });
 }finally{
  await prisma.$executeRaw`DELETE FROM member_social_uploads WHERE user_id=ANY(${ids}::text[])`;
  await prisma.$executeRaw`DELETE FROM member_operation_records WHERE user_id=ANY(${ids}::text[])`;
  await prisma.$executeRaw`DELETE FROM member_operation_settings WHERE updated_by=ANY(${ids}::text[])`;
  await prisma.pointEntry.deleteMany({where:{userId:{in:ids}}});await prisma.memberProfile.deleteMany({where:{userId:{in:ids}}});await prisma.auditLog.deleteMany({where:{actorId:{in:ids}}});await prisma.user.deleteMany({where:{id:{in:ids}}});await prisma.$disconnect();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { memberCouponStatus, memberCouponStatusLabels } from "@/lib/commerce/member-coupon-status";

async function main() {
  const url=new URL(process.env.DATABASE_URL??"");assert.equal(url.pathname,"/vk_system_remediation_smoke_20261019");assert.equal(url.hostname,"127.0.0.1");assert.equal(process.env.COMMERCE_STORAGE,"prisma");
  globalThis.fetch=async()=>{throw Error("Real gateway requests are forbidden");};
  (globalThis as any).React=React;
  const {prisma}=await import("@/lib/db/prisma");
  const {resolvePrismaSessionUser,persistPrismaSession}=await import("@/lib/services/prisma-session-store");
  const {claimMemberCoupon,getMemberOverview}=await import("@/lib/services/membership-service");
  const {getAdminMemberOperations}=await import("@/lib/services/member-operations-service");
  const {getMemberRewardCouponPresentation}=await import("@/lib/services/member-reward-coupon-presentation");
  const {MembershipPanel}=await import("@/app/admin/membership/panel");
  const {defaultMemberOperationsConfig}=await import("@/lib/commerce/member-operations");
  const {normalizeUploadedImage}=await import("@/lib/uploads/image");
  const sharp=(await import("sharp")).default;
  const tag=randomUUID();let sequence=0;
  const user=async(role:"CUSTOMER"|"ADMIN"|"OWNER"="CUSTOMER",status:"ACTIVE"|"DISABLED"="ACTIVE")=>prisma.user.create({data:{name:"audit-remediation-"+tag,role,status,phone:"139"+String(++sequence).padStart(8,"0"),...(role==="CUSTOMER"?{membership:{create:{pointsBalance:0}}}:{})}});
  try {
    await test("disabled customers, staff and owners cannot reactivate or persist sessions via SMS resolution",async()=>{
      for(const role of ["CUSTOMER","ADMIN","OWNER"] as const){const account=await user(role,"DISABLED"),payload={userId:account.id,phone:account.phone!,role:"customer" as const};
        await assert.rejects(resolvePrismaSessionUser(payload),/ACCOUNT_DISABLED/);
        await assert.rejects(persistPrismaSession("isolated-"+randomUUID(),new Date(Date.now()+60000),payload),/ACCOUNT_DISABLED/);
        await assert.rejects(resolvePrismaSessionUser({userId:account.id,role:"customer"}),/ACCOUNT_DISABLED/);
        const after=await prisma.user.findUniqueOrThrow({where:{id:account.id}});assert.equal(after.status,"DISABLED");assert.equal(after.role,role);assert.equal(await prisma.session.count({where:{userId:account.id}}),0);
      }
      const owner=await user("OWNER");assert.equal((await resolvePrismaSessionUser({userId:owner.id,phone:owner.phone!,role:"customer"})).role,"owner");
      assert.equal((await prisma.user.findUniqueOrThrow({where:{id:owner.id}})).role,"OWNER");
    });
    const customer=await user(),admin=await user("ADMIN");
    const createTemplate=(amountCents:number,minimumCents:number)=>prisma.couponTemplate.create({data:{title:"Remediation coupon "+tag,amountCents,minimumCents,deliveryMode:"REWARD",active:true,totalLimit:1000,startsAt:new Date(Date.now()-86400000),endsAt:new Date("2099-12-31T00:00:00Z")}});
    const student100=await createTemplate(10000,60000),student400=await createTemplate(40000,220000);
    const config=defaultMemberOperationsConfig();config.studentBenefits.couponTemplateIds=[student100.id,student400.id];
    await prisma.$executeRaw`INSERT INTO member_operation_settings(id,revision,config,updated_by) VALUES('member-operations',1,${JSON.stringify(config)}::jsonb,${admin.id})`;
    await test("event reward templates describe actual student and invitation validity instead of public unlimited redemption",async()=>{
      const presentation=await getMemberRewardCouponPresentation();assert.match(presentation[student100.id].validity,/180天/);assert.match(presentation[student400.id].condition,/微信学生认证/);
      const referral=Object.values(presentation).find(x=>x.condition.includes("邀请好友"));assert.match(referral!.validity,/2个月/);
      const router={push(){},replace(){},refresh(){},prefetch(){},back(){},forward(){}};
      const html=renderToStaticMarkup(React.createElement(AppRouterContext.Provider,{value:router as any},React.createElement(MembershipPanel,{owner:false,products:[],benefits:[],templates:[{...student100,startsAt:student100.startsAt.toISOString(),endsAt:student100.endsAt.toISOString(),longTerm:true,rewardCondition:presentation[student100.id].condition,rewardValidity:presentation[student100.id].validity}]})));
      assert.match(html,/每张券有效期180天/);assert.match(html,/符合活动条件的会员/);assert(!html.includes("<p>会员主动领取"));
      await assert.rejects(claimMemberCoupon(customer.id,student100.id),/COUPON_DELIVERY_FORBIDDEN/);
    });
    await test("wallet and admin status share individual expiry and preserve held, used and void precedence",async()=>{
      const claim=await prisma.couponClaim.create({data:{userId:customer.id,templateId:student100.id,source:"STUDENT",expiresAt:new Date(Date.now()-86400000)}});
      const wallet=(await getMemberOverview(customer.id)).wallet.find(x=>x.id===claim.id)!;assert.equal(wallet.status,"EXPIRED");assert.equal(memberCouponStatusLabels[memberCouponStatus({...claim,template:student100,heldOrder:null})],"已过期");
      const now=new Date(),base={voided:false,expiresAt:now,template:student100,heldOrder:null};assert.equal(memberCouponStatus(base,now),"EXPIRED");
      assert.equal(memberCouponStatus({...base,expiresAt:null},now),"AVAILABLE");assert.equal(memberCouponStatus({...base,voided:true},now),"VOID");
      assert.equal(memberCouponStatus({...base,heldOrder:{paymentStatus:"PAID"}},now),"USED");assert.equal(memberCouponStatus({...base,heldOrder:{paymentStatus:"PENDING"}},now),"HELD");
    });
    const pendingId="audit-pending-"+tag;
    await prisma.$executeRaw`INSERT INTO member_operation_records(id,kind,user_id,subject_id,state,payload,created_at,updated_at) VALUES(${pendingId},'APPLICATION',${customer.id},${pendingId},'PENDING','{"taskKey":"ENTERPRISE"}'::jsonb,CURRENT_TIMESTAMP-INTERVAL '2 days',CURRENT_TIMESTAMP-INTERVAL '2 days')`;
    await prisma.$executeRaw`INSERT INTO member_operation_records(id,kind,user_id,subject_id,state,payload) SELECT ${"draw-"+tag+"-"}||n,'DRAW',${customer.id},${"draw-subject-"+tag+"-"}||n,'APPROVED','{}'::jsonb FROM generate_series(1,301) n`;
    await test("an old pending application stays visible despite hundreds of newer draws",async()=>{
      const data=await getAdminMemberOperations(admin.id);assert.equal(data.records.length,300);assert.equal(data.review.pending,1);assert.equal(data.review.total,1);assert.equal(data.review.records[0].id,pendingId);
    });
    await prisma.$executeRaw`INSERT INTO member_operation_records(id,kind,user_id,subject_id,state,payload) SELECT ${"pending-"+tag+"-"}||n,'APPLICATION',${customer.id},${"pending-subject-"+tag+"-"}||n,'PENDING','{"taskKey":"ENTERPRISE"}'::jsonb FROM generate_series(1,65) n`;
    await test("pending pagination contains every application once and excludes non-review records",async()=>{
      const first=(await getAdminMemberOperations(admin.id,{status:"PENDING",page:1})).review,second=(await getAdminMemberOperations(admin.id,{status:"PENDING",page:2})).review;
      assert.equal(first.total,66);assert.equal(first.pending,66);assert.equal(first.records.length,50);assert.equal(second.records.length,16);assert.equal(first.records[0].id,pendingId);
      assert.equal(new Set([...first.records,...second.records].map(x=>x.id)).size,66);assert([...first.records,...second.records].every(x=>x.kind==="APPLICATION"));
      assert.equal((await getAdminMemberOperations(admin.id,{page:999})).review.page,2);
      const approved=(await getAdminMemberOperations(admin.id,{status:"APPROVED"})).review;assert.equal(approved.records.length,0);assert.equal(approved.pending,66);
      await assert.rejects(getAdminMemberOperations(customer.id),/ADMIN_REQUIRED/);await assert.rejects(getAdminMemberOperations(admin.id,{status:"arbitrary"}),/INVALID_MEMBER_OPERATION/);
    });
    await test("upgraded image decoder still accepts ordinary AVIF and strips metadata into a bounded WebP",async()=>{
      const bytes=await sharp({create:{width:32,height:24,channels:3,background:"white"}}).avif().toBuffer();
      const result=await normalizeUploadedImage(new File([new Uint8Array(bytes)],"image.avif",{type:"image/avif"}),{maxBytes:1024*1024,maxDimension:16});
      assert.equal(result.mimeType,"image/webp");assert(result.width<=16&&result.height<=16);assert.equal((await sharp(result.buffer).metadata()).exif,undefined);
      assert.equal(await prisma.order.count(),0);assert.equal(await prisma.paymentIntent.count(),0);
    });
  } finally { await prisma.$disconnect(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {createLoader,root}=require('./test-loader.cjs');
const proof={id:'msu_'+'a'.repeat(32),url:'/api/miniprogram/member-operations/proofs/msu_'+'a'.repeat(32)};
const task=(key,patch={})=>({key,enabled:true,state:'AVAILABLE',rewardPoints:key==='SOCIAL_POST'?20:key==='SOCIAL_FIRST_POST'?5:100,...patch});
function overview(patch={}){return {ok:true,registered:true,pointsBalance:1000,tasks:[task('STUDENT'),task('INVITE'),task('SOCIAL_FIRST_POST'),task('SOCIAL_POST'),task('SOCIAL_INTERACTION',{rewardPoints:5}),task('SOCIAL_REPOST',{rewardPoints:5})],
  student:{valid:false,certification:null,benefitsEnabled:true,firstSocialPoints:1500,firstSocialAwarded:false,coupons:[{templateId:'s100',title:'学生礼遇',amountCents:10000,minimumCents:60000},{templateId:'s400',title:'学生礼遇',amountCents:40000,minimumCents:220000}]},
  social:{enabled:true,postingEnabled:true,interactionEnabled:true,repostingEnabled:true,platforms:[{key:'XIAOHONGSHU'},{key:'WECHAT_MOMENTS'}]},referral:{code:'ref_own_123456',invited:4,bound:false,rewardSummary:{enabled:true,registrationRewardCount:2,registrationRewardLimit:20,registrationRewardRemaining:18,purchaseCouponCount:1}},
  myApplications:[],mySocialSubmissions:[],myPosts:[],myComments:[],posts:[],lotteries:[],surveys:[],...patch};}
function make(pageName,{value=overview(),upload,download,extraWx={}}={}){
 const store=new Map([['merchantkit.session',{accessToken:'qa-only',expiresAt:'2099-01-01'}],['merchantkit.user',{id:'reward-qa-member'}]]);
 const calls=[],uploads=[],previews=[];
 const wx={getStorageSync:key=>store.get(key),setStorageSync:(key,value)=>store.set(key,structuredClone(value)),removeStorageSync:key=>store.delete(key),previewImage:value=>previews.push(value),stopPullDownRefresh(){},...extraWx};
 const service={fetchMemberOperations:async()=>structuredClone(value),memberOperation:async(action,payload)=>{calls.push({action,payload:structuredClone(payload)});return action==='submit_application'?{ok:true,application:{id:'student-qa',status:'PENDING'}}:{ok:true,submission:{id:'social-qa',status:'PENDING'}};}};
 const media={uploadSocialProof:async(file,id,purpose)=>{uploads.push({file,id,purpose});return upload?upload(file,id,purpose):structuredClone(proof);},downloadSocialProof:async()=> download?download():'wxfile://tmp/private-proof.jpg',removeUnusedSocialProof:async()=>({ok:true})};
 const loader=createLoader(wx,{[path.join(root,'services/member-operations.js')]:service,[path.join(root,'services/member-social.js')]:media});loader.load(`pages/member-${pageName}/index.js`);const page=loader.page;page.data=structuredClone(page.data);page.setData=value=>Object.assign(page.data,value);page.onLoad({});return {page,store,calls,uploads,previews,wx,loader};
}
const localProof=()=>({localId:'image-local',localPath:'wxfile://tmp/student.jpg',uploadRequestId:'proof-upload-v3',id:'',url:''});
const event=dataset=>({currentTarget:{dataset}});

test('every social campaign requires a screenshot and interaction type cannot leak into other campaigns',()=>{
 const model=createLoader().load('models/member-social.js'),base={platform:'XIAOHONGSHU',postUrl:'https://www.xiaohongshu.com/explore/example',note:'本人完成的活动',proofKeys:[proof.id]};
 for(const campaignKey of ['SOCIAL_POST','SOCIAL_REPOST','SOCIAL_INTERACTION','XIAOHONGSHU_FOLLOW']){
   const payload={...base,campaignKey,...(campaignKey==='SOCIAL_INTERACTION'?{interactionType:'LIKE'}:{})};
   assert.equal(model.socialSubmissionPayload(payload).campaignKey,campaignKey);
   assert.throws(()=>model.socialSubmissionPayload({...payload,proofKeys:[]}),/SOCIAL_PROOF_REQUIRED/);
 }
 assert.throws(()=>model.socialSubmissionPayload({...base,campaignKey:'SOCIAL_INTERACTION'}),/INVALID_SOCIAL_SUBMISSION/);
 assert.throws(()=>model.socialSubmissionPayload({...base,campaignKey:'SOCIAL_POST',interactionType:'LIKE'}),/INVALID_SOCIAL_SUBMISSION/);
 assert.throws(()=>model.socialSubmissionPayload({...base,campaignKey:'SOCIAL_REPOST',platform:'WECHAT_MOMENTS'}),/SOCIAL_PROOF_REQUIRED/);
});
test('social records preserve all three interaction labels and forwarding rewards',()=>{
 const model=createLoader().load('models/member-social.js');
 for(const [interactionType,label] of [['LIKE','点赞'],['COMMENT','评论'],['FAVORITE','收藏']]){
   const [value]=model.socialSubmissionPresentation([{id:'record-'+interactionType,campaignKey:'SOCIAL_INTERACTION',interactionType,platform:'XIAOHONGSHU',status:'APPROVED',rewardPoints:5,proofs:[proof]}],()=> '2026-10-18');
   assert(value.title.includes(label));assert.equal(value.rewardLabel,'+5积分');
 }
 const [repost]=model.socialSubmissionPresentation([{id:'repost',campaignKey:'SOCIAL_REPOST',platform:'WECHAT_MOMENTS',status:'PENDING',rewardPoints:5,proofs:[proof]}],()=> '');
 assert.equal(repost.title,'朋友圈转发');assert.equal(repost.rewardLabel,'');
});
test('earning routes target external social tasks and disabled tasks do not promise points',()=>{
 const model=createLoader().load('models/member-operations.js'),value=model.operationsPresentation(overview());
 assert.equal(value.tasks.find(item=>item.key==='SOCIAL_INTERACTION').route,'/pages/member-community/index?tab=interaction');
 assert.equal(value.tasks.find(item=>item.key==='SOCIAL_REPOST').route,'/pages/member-community/index?tab=repost');
 assert(value.communityTasks.some(item=>item.key==='SOCIAL_REPOST'));
 const closed=model.operationsPresentation(overview({tasks:[task('SOCIAL_REPOST',{enabled:false,state:'DISABLED'})]}));assert.equal(closed.tasks[0].rewardLabel,'');
});
test('uniform lottery has one range and per-result probability instead of rendering 100 prize rows',()=>{
 const model=createLoader().load('models/member-operations.js');const lottery={id:'uniform',enabled:true,distribution:'UNIFORM_POINTS',minimumPoints:1,maximumPoints:100,costPoints:20,remainingDraws:3,prizes:Array.from({length:100},(_,i)=>({id:'p'+i,points:i+1,probability:.01,kind:'POINTS'}))};
 const value=model.operationsPresentation(overview({lotteries:[lottery]})).lotteries[0];assert.equal(value.uniformPoints,true);assert.equal(value.uniformRangeLabel,'1—100 积分');assert.equal(value.uniformProbabilityLabel,'1%');assert.equal(value.canDraw,true);
 const xml=fs.readFileSync(path.join(root,'pages/member-lottery/index.wxml'),'utf8');assert.match(xml,/wx:if="\{\{item\.uniformPoints\}\}"/);assert.match(xml,/<block wx:else>/);assert.doesNotMatch(xml,/wx:for="\{\{item\.prizes\}\}"[^>]*wx:if=/);
});
test('expired historical student record stays read-only while official verification is pending',async()=>{
 const value=overview({tasks:[task('STUDENT',{state:'COMPLETED'})],myApplications:[{id:'cert',taskKey:'STUDENT',status:'EXPIRED',revision:4,certification:{validUntil:'2026-10-18T01:00:00Z'}}],student:{...overview().student,certification:{validUntil:'2026-10-18T01:00:00Z'}}});
 const x=make('student',{value});await x.page.loadOperations();assert.equal(x.page.data.canSubmit,false);assert.equal(x.page.data.application.statusLabel,'已过期');assert.equal(x.page.data.firstCertificationPoints,0);assert.equal(x.page.data.application.certification.validUntil,'2026-10-18T01:00:00Z');
});
test('pending official verification never displays legacy student benefits even if old flags are enabled',async()=>{
 const x=make('student');await x.page.loadOperations();assert.equal(x.page.data.coupons.length,0);assert.equal(x.page.data.firstSocialPoints,0);assert.equal(x.page.data.overview.student.verification.provider,'WECHAT');assert.equal(x.page.data.overview.student.verification.status,'PENDING');assert.equal(x.page.data.overview.student.valid,false);assert.equal(x.page.data.overview.student.benefitsEnabled,false);
 const closed=make('student',{value:overview({tasks:[task('STUDENT',{enabled:false,state:'DISABLED'})]})});await closed.page.loadOperations();assert.equal(closed.page.data.benefitsVisible,false);assert.equal(closed.page.data.coupons.length,0);assert.equal(closed.page.data.canSubmit,false);
});
test('retired student submission never uploads proof or mutates points despite a forged local submit flag',async()=>{
 const x=make('student',{value:overview({myApplications:[{id:'cert',taskKey:'STUDENT',status:'EXPIRED',revision:4}]})});await x.page.loadOperations();
 x.page.setData({canSubmit:true,school:'某某大学',graduationYear:'2028',note:'在读',confirmed:true,proofItems:[localProof()]});await x.page.submit();
 assert.equal(x.uploads.length,0);assert.equal(x.calls.length,0);assert.equal(x.page.data.overview.pointsBalance,1000);assert.equal(x.page.data.notice,'暂未开放');
});
test('student unavailable page contains no manual form or rewarding action for any application status',async()=>{
 const x=make('student');await x.page.loadOperations();x.page.setData({school:'某某大学',graduationYear:'2028',confirmed:true});await x.page.submit();assert.equal(x.calls.length,0);assert.equal(x.uploads.length,0);assert.equal(x.page.data.notice,'暂未开放');
 const pending=make('student',{value:overview({myApplications:[{id:'cert',taskKey:'STUDENT',status:'PENDING',revision:1}]})});await pending.page.loadOperations();pending.page.setData({school:'某某大学',graduationYear:'2028',confirmed:true,proofItems:[localProof()]});await pending.page.submit();assert.equal(pending.calls.length,0);assert.equal(pending.uploads.length,0);
});
test('late authenticated historical student proof cannot preview after an account switch',async()=>{
 let resolve;const x=make('student',{value:overview({myApplications:[{taskKey:'STUDENT',status:'PENDING',proofs:[proof]}]}),download:()=>new Promise(done=>{resolve=done;})});await x.page.loadOperations();const pending=x.page.previewProof(event({id:proof.id}));
 x.store.set('merchantkit.user',{id:'other-member'});resolve('wxfile://tmp/private-proof.jpg');await pending;assert.equal(x.previews.length,0);assert.equal(x.calls.length,0);await x.page.loadOperations();assert.equal(x.page.data.proofItems.length,0);assert.equal(x.page.data.school,'');
});
test('retired student picker cannot open native media selection or collect new material',async()=>{
 let count=0;const x=make('student',{extraWx:{chooseMedia:()=>{count++;}}});await x.page.loadOperations();x.page.setData({canSubmit:true});x.page.chooseProof();x.page.chooseProof();assert.equal(count,0);assert.equal(x.uploads.length,0);assert.equal(x.page.data.proofItems.length,0);assert.equal(x.page.data.notice,'暂未开放');
});
test('social interaction sends selected behavior and SOCIAL screenshot purpose with no local reward credit',async()=>{
 const x=make('community');x.page.onLoad({tab:'interaction'});await x.page.loadOperations();x.page.selectSocialInteraction(event({key:'FAVORITE'}));x.page.setData({socialNote:'本人完成收藏',socialConfirmed:true,proofItems:[localProof()]});await x.page.submitSocial();
 assert.equal(x.uploads[0].purpose,'SOCIAL');assert.equal(x.calls[0].payload.campaignKey,'SOCIAL_INTERACTION');assert.equal(x.calls[0].payload.interactionType,'FAVORITE');assert.equal(x.page.data.overview.pointsBalance,1000);assert.equal(x.page.data.overview.mySocialSubmissions.length,0);
});
test('social repost preserves its own campaign and clears forbidden Moments links',async()=>{
 const x=make('community');x.page.onLoad({tab:'repost'});await x.page.loadOperations();x.page.setData({selectedPlatform:'WECHAT_MOMENTS',socialPostUrl:'https://old.example/item',socialNote:'本人朋友圈分享',socialConfirmed:true,proofItems:[{...proof,localId:proof.id,existing:true}]});await x.page.submitSocial();
 assert.equal(x.calls[0].payload.campaignKey,'SOCIAL_REPOST');assert.equal(x.calls[0].payload.postUrl,'');assert.equal(x.calls[0].payload.interactionType,undefined);
});
test('pending student capability suppresses student bonus without disabling ordinary moderated social activity',async()=>{
 const x=make('community',{value:overview({student:{...overview().student,valid:true}})});await x.page.loadOperations();assert.equal(x.page.data.studentSocialRewardLabel,'');assert.match(x.page.data.socialRewardLabel,/首篇/);assert.match(x.page.data.socialRewardLabel,/后续每篇/);assert.equal(x.page.data.socialCanSubmit,true);
});
test('invite reward display uses actual automatic reward counts and closed programs promise no new benefits',async()=>{
 const x=make('invite');await x.page.loadOperations();assert.equal(x.page.data.inviteBenefitsVisible,true);assert.equal(x.page.data.registrationRewardCount,2);assert.equal(x.page.data.registrationRewardLimit,20);assert.equal(x.page.data.purchaseCouponCount,1);assert.equal(x.calls.length,0);
 const closed=make('invite',{value:overview({referral:{...overview().referral,rewardSummary:{enabled:false}}})});await closed.page.loadOperations();assert.equal(closed.page.data.inviteBenefitsVisible,false);
 const xml=fs.readFileSync(path.join(root,'pages/member-invite/index.wxml'),'utf8');assert.match(xml,/有效期2个月/);assert.match(xml,/你得/);assert.doesNotMatch(xml,/已核验奖励|邀请码|bindReferral/);
});
test('private student screenshot sources are never rendered as remote image URLs',()=>{
 const xml=fs.readFileSync(path.join(root,'pages/member-student/index.wxml'),'utf8');assert.doesNotMatch(xml,/src="\{\{(?:item|proof)\.url/);assert.match(xml,/bindtap="previewProof"/);assert.doesNotMatch(xml,/operations-small/);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {createLoader,root}=require('./test-loader.cjs');
const proof={id:'proof-12345678',url:'/api/miniprogram/member-operations/proofs/proof-12345678'};
function overview(patch={}) {return {ok:true,registered:true,pointsBalance:42,shoppingRule:{},tasks:[{key:'XIAOHONGSHU_FOLLOW',enabled:true,state:'AVAILABLE',rewardPoints:50},{key:'SOCIAL_FIRST_POST',enabled:true,state:'AVAILABLE',rewardPoints:100},{key:'SOCIAL_POST',enabled:true,state:'AVAILABLE',rewardPoints:20}],social:{enabled:true,postingEnabled:true,platforms:[{key:'XIAOHONGSHU'},{key:'DOUYIN'},{key:'WECHAT_MOMENTS'},{key:'WECHAT_CHANNELS'},{key:'OTHER'}],instructions:'真实内容'},xiaohongshuAccount:{enabled:true},lotteries:[],surveys:[],posts:[],myPosts:[],myComments:[],myApplications:[],mySocialSubmissions:[],...patch};}
function make({value=overview(),action,upload,download,store,extraWx={}}={}){
 const storage=store||new Map([['merchantkit.session',{accessToken:'local-only',expiresAt:'2099-01-01'}],['merchantkit.user',{id:'qa-member'}]]);
 const calls=[],uploads=[],previews=[],copies=[];
 const wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,structuredClone(v)),removeStorageSync:k=>storage.delete(k),previewImage:o=>previews.push(o),setClipboardData:o=>{copies.push(o.data);o.success?.()},stopPullDownRefresh(){},...extraWx};
 const service={fetchMemberOperations:async()=>structuredClone(typeof value==='function'?value():value),memberOperation:async(a,p)=>{calls.push({action:a,payload:structuredClone(p)});return action? action(a,p):{ok:true,submission:{id:'social-1',status:'PENDING',requestId:p.requestId,campaignKey:p.campaignKey}}}};
 const media={uploadSocialProof:async(file,id)=>{uploads.push({file,id});return upload?upload(file,id):structuredClone(proof)},downloadSocialProof:async p=>download?download(p):'wxfile://tmp/proof.jpg',removeUnusedSocialProof:async()=>({ok:true})};
 const loader=createLoader(wx,{[path.join(root,'services/member-operations.js')]:service,[path.join(root,'services/member-social.js')]:media});loader.load('pages/member-community/index.js');const page=loader.page;page.data=structuredClone(page.data);page.setData=p=>Object.assign(page.data,p);page.onLoad({});return {page,storage,calls,uploads,previews,copies,wx,loader,service,media};
}
function fill(x,patch={}){x.page.setData({socialStage:'submit',socialNote:'本人发布的真实产品体验说明',socialConfirmed:true,socialPostUrl:'https://www.xiaohongshu.com/explore/abc123',proofItems:[{...proof,localId:proof.id,localPath:'',existing:true}],...patch})}

test('social proof DTO rejects arbitrary destinations and submission requires actual evidence',()=>{
 const m=createLoader().load('models/member-social.js');assert.equal(m.readSocialProof(proof).id,proof.id);
 for(const bad of [{...proof,url:'https://other.invalid/p.png'},{...proof,url:'/uploads/social/public.png'},{id:'../secret',url:'/api/miniprogram/member-operations/proofs/../secret'}])assert.throws(()=>m.readSocialProof(bad),/INVALID_SOCIAL_PROOF/);
 for(const bad of ['http://example.com/a','https://user:secret@example.com/a','https://example.com\\evil','javascript:alert(1)'])assert.equal(m.socialPostLink(bad),'');
 const base={campaignKey:'SOCIAL_POST',platform:'DOUYIN',postUrl:'https://v.douyin.com/AbCd/',note:'本人体验',proofKeys:[proof.id]};assert.equal(m.socialSubmissionPayload(base).platform,'DOUYIN');
 assert.throws(()=>m.socialSubmissionPayload({...base,platform:'WECHAT_MOMENTS'}),/SOCIAL_PROOF_REQUIRED/);
 assert.throws(()=>m.socialSubmissionPayload({...base,campaignKey:'XIAOHONGSHU_FOLLOW',platform:'XIAOHONGSHU',proofKeys:[]}),/SOCIAL_PROOF_REQUIRED/);
});
test('new presentation hides legacy entry tasks while retaining old audit data',()=>{
 const model=createLoader().load('models/member-operations.js');const source=overview({tasks:[...overview().tasks,{key:'OFFICIAL_ACCOUNT',enabled:true},{key:'FIRST_POST',enabled:true},{key:'COMMUNITY_SHARE',enabled:true}],myPosts:[{id:'old',status:'APPROVED',text:'保留旧投稿'}]});const v=model.operationsPresentation(source);assert.deepEqual(Array.from(v.tasks,x=>x.key),['XIAOHONGSHU_FOLLOW','SOCIAL_FIRST_POST','SOCIAL_POST']);assert.equal(v.myPosts[0].text,'保留旧投稿');assert.equal(v.officialVisible,false);assert.equal(v.xiaohongshuVisible,true);assert.match(v.tasks[0].route,/tab=follow/);
});
test('viewing rules, copying brand link and previewing the full original card do not submit or award',async()=>{
 const x=make();x.page.onLoad({tab:'follow'});await x.page.loadOperations();assert.equal(x.page.data.socialStage,'requirements');x.page.copyBrandLink();x.page.previewBrandProfile();assert.equal(x.calls.length,0);assert.equal(x.uploads.length,0);assert.equal(x.copies[0],'https://example.invalid/social');assert.equal(x.previews[0].current,'/assets/brand/xiaohongshu-profile.jpg');assert.equal(x.page.data.notice,'品牌主页链接已复制。');assert.equal(x.page.data.overview.pointsBalance,42);
});
test('disabled activities stay readable and never choose files or submit mutations',async()=>{
 let chosen=0;const x=make({value:overview({social:{enabled:false,postingEnabled:false},tasks:overview().tasks.map(t=>({...t,enabled:false,state:'DISABLED'}))}),extraWx:{chooseMedia(){chosen++}}});await x.page.loadOperations();x.page.nextSocialStep();assert.equal(x.page.data.socialStage,'requirements');fill(x);x.page.chooseSocialProof();await x.page.submitSocial();assert.equal(chosen,0);assert.equal(x.calls.length,0);assert.match(x.page.data.socialDisabledReason,/暂未开放/);
});
test('moments sharing and brand-follow cannot use only a link as evidence',async()=>{
 const x=make();await x.page.loadOperations();fill(x,{selectedPlatform:'WECHAT_MOMENTS',proofItems:[]});x.page.syncSocialState();await x.page.submitSocial();assert.equal(x.calls.length,0);assert.match(x.page.data.error,/截图/);
 x.page.setData({socialTab:'follow'});x.page.syncSocialState();await x.page.submitSocial();assert.equal(x.calls.length,0);assert.equal(x.uploads.length,0);
});
test('a successful submission does not invent rewards or an approved history record',async()=>{
 const x=make();await x.page.loadOperations();fill(x);await x.page.submitSocial();assert.equal(x.calls[0].action,'submit_social_submission');assert.equal(x.calls[0].payload.campaignKey,'SOCIAL_POST');assert.equal(x.calls[0].payload.proofKeys.length,1);assert.equal(x.page.data.overview.pointsBalance,42);assert.equal(x.page.data.overview.mySocialSubmissions.length,0);assert.equal(x.page.data.socialStage,'history');assert.match(x.page.data.notice,/等待人工审核/);assert.equal(x.page.pendingSocial,null);
});
test('ambiguous social results persist exactly one request and replay the same payload after reopening',async()=>{
 const x=make({action:async()=>{throw Error('NETWORK_REQUEST_FAILED')}});await x.page.loadOperations();fill(x);await x.page.submitSocial();const first=x.calls[0].payload;assert.equal(x.page.pendingSocial.requestId,first.requestId);assert.equal(x.page.data.pendingSocialReady,true);
 x.page.onUnload();const y=make({store:x.storage});await y.page.loadOperations();assert.equal(y.page.data.pendingSocialReady,true);await y.page.retrySocialSubmission();assert.deepEqual(y.calls[0].payload,first);assert.equal(y.page.pendingSocial,null);assert.equal([...x.storage.keys()].some(k=>k.includes('.pending.social.')),false);
});
test('upload retries keep each image request id and never send a submission before upload confirmation',async()=>{
 let attempt=0;const x=make({upload:async()=>{if(++attempt===1)throw Error('SOCIAL_PROOF_UPLOAD_FAILED');return proof}});await x.page.loadOperations();fill(x,{selectedPlatform:'WECHAT_MOMENTS',socialPostUrl:'',proofItems:[{localId:'local1',localPath:'wxfile://tmp/test.jpg',uploadRequestId:'upload-request-123',id:'',url:'',existing:false}]});x.page.syncSocialState();await x.page.submitSocial();assert.equal(x.calls.length,0);assert.equal(x.page.data.proofItems.length,1);assert.match(x.page.data.error,/上传未完成/);await x.page.submitSocial();assert.equal(x.uploads[0].id,x.uploads[1].id);assert.deepEqual(Array.from(x.calls[0].payload.proofKeys),[proof.id]);
});
test('an authenticated receipt resolves an ambiguous request and clears its old draft',async()=>{
 const x=make({action:async()=>{throw Error('NETWORK_REQUEST_FAILED')}});await x.page.loadOperations();fill(x);await x.page.submitSocial();const requestId=x.calls[0].payload.requestId;
 x.service.fetchMemberOperations=async()=>overview({mySocialSubmissions:[{id:'s-receipt',requestId,campaignKey:'SOCIAL_POST',platform:'XIAOHONGSHU',status:'PENDING',note:'本人材料',proofs:[]}]});await x.page.loadOperations();assert.equal(x.page.pendingSocial,null);assert.equal(x.page.data.socialNote,'');assert.equal(x.page.data.socialStage,'history');assert.equal(x.page.data.overview.mySocialSubmissions[0].status,'PENDING');assert.equal(x.page.data.overview.pointsBalance,42);
});
test('rejected applications revise the same request with the server revision',async()=>{
 const row={id:'social-old',requestId:'old-request-123',campaignKey:'SOCIAL_POST',platform:'DOUYIN',postUrl:'https://v.douyin.com/example/',note:'原始说明',proofs:[proof],status:'REJECTED',reviewNote:'请补充说明',revision:2,createdAt:'2026-10-18T00:00:00Z'};
 const x=make({value:overview({mySocialSubmissions:[row]})});await x.page.loadOperations();x.page.reviseSocialSubmission({currentTarget:{dataset:{id:row.id}}});x.page.setData({socialNote:'补充后的本人发布说明',socialConfirmed:true});await x.page.submitSocial();assert.equal(x.calls[0].payload.requestId,row.requestId);assert.equal(x.calls[0].payload.expectedRevision,2);assert.equal(x.calls[0].payload.note,'补充后的本人发布说明');assert.equal(x.uploads.length,0);
});
test('confirmed server validation rejection unlocks material editing instead of trapping retries',async()=>{
 const x=make({action:async()=>{throw Error('MEMBER_OPERATIONS_DUPLICATE_CONTENT')}});await x.page.loadOperations();fill(x);await x.page.submitSocial();assert.equal(x.page.pendingSocial,null);assert.equal(x.page.data.pendingSocialReady,false);assert.match(x.page.data.error,/原申请/);assert.equal(x.page.data.socialNote,'本人发布的真实产品体验说明');
});
test('identity changes during upload cannot submit old materials under the new account',async()=>{
 let resolve;const x=make({upload:()=>new Promise(r=>resolve=r)});await x.page.loadOperations();fill(x,{proofItems:[{localId:'local1',localPath:'wxfile://tmp/private.jpg',uploadRequestId:'upload-request-123',id:'',url:''}]});const pending=x.page.submitSocial();x.storage.set('merchantkit.user',{id:'other-member'});resolve(proof);await pending;assert.equal(x.calls.length,0);assert.equal(x.page.data.proofItems.length,0);assert.equal(x.page.data.socialNote,'');assert.equal(x.page.data.socialUploading,false);
});
test('expired or changed sessions clear private draft previews on reload',async()=>{
 const x=make();await x.page.loadOperations();fill(x,{proofItems:[{localPath:'wxfile://tmp/private.jpg'}]});x.storage.delete('merchantkit.session');await x.page.loadOperations();assert.equal(x.page.data.proofItems.length,0);assert.equal(x.page.data.socialNote,'');assert.equal(x.page.data.overview,null);assert.equal(x.page.data.guest,true);
});
test('native image selection is single-flight and scoped to the original account',async()=>{
 let selection,count=0;const x=make({extraWx:{chooseMedia:o=>{count++;selection=o}}});await x.page.loadOperations();x.page.chooseSocialProof();x.page.chooseSocialProof();assert.equal(count,1);x.storage.set('merchantkit.user',{id:'other-member'});selection.success({tempFiles:[{tempFilePath:'wxfile://tmp/private.jpg',size:10}]});assert.equal(x.page.data.proofItems.length,0);
});
test('private screenshots are authenticated downloads and only local files are previewed',async()=>{
 const transfers=[],store=new Map([['merchantkit.session',{accessToken:'private-token',expiresAt:'2099-01-01'}],['merchantkit.user',{id:'member'}]]);
 const wx={getStorageSync:k=>store.get(k),removeStorageSync:k=>store.delete(k),downloadFile:o=>{transfers.push(o);o.success({statusCode:200,tempFilePath:'wxfile://tmp/private.jpg'})}};const service=createLoader(wx).load('services/member-social.js');assert.equal(await service.downloadSocialProof(proof),'wxfile://tmp/private.jpg');assert.equal(transfers[0].url,'https://example.invalid'+proof.url);assert.equal(transfers[0].header.Authorization,'Bearer private-token');await assert.rejects(service.downloadSocialProof({...proof,url:'https://evil.invalid/a.png'}),/INVALID_SOCIAL_PROOF/);assert.equal(transfers.length,1);
 const row={id:'s1',requestId:'request-1234',campaignKey:'SOCIAL_POST',platform:'DOUYIN',proofs:[proof],status:'PENDING'};const x=make({value:overview({mySocialSubmissions:[row]})});await x.page.loadOperations();await x.page.previewSocialProof({currentTarget:{dataset:{submission:'s1',id:proof.id}}});assert.equal(x.previews[0].current,'wxfile://tmp/proof.jpg');assert.doesNotMatch(x.previews[0].current,/api/);
});
test('an account change in a private download rejects late image delivery',async()=>{
 const store=new Map([['merchantkit.session',{accessToken:'old-token',expiresAt:'2099-01-01'}]]);let transfer;const service=createLoader({getStorageSync:k=>store.get(k),removeStorageSync:k=>store.delete(k),downloadFile:o=>{transfer=o}}).load('services/member-social.js');const pending=service.downloadSocialProof(proof);store.set('merchantkit.session',{accessToken:'new-token',expiresAt:'2099-01-01'});transfer.success({statusCode:200,tempFilePath:'wxfile://tmp/old.jpg'});await assert.rejects(pending,/SESSION_CHANGED/);
});
test('strict login return keeps the selected social tab without accepting arbitrary query strings',()=>{
 const m=createLoader().load('stores/navigation.js');for(const tab of ['follow','share','history']){m.rememberMemberLoginReturn('/pages/member-community/index?tab='+tab);assert.equal(m.consumeMemberLoginReturn(),'/pages/member-community/index?tab='+tab)}for(const bad of ['?tab=evil','?tab=follow&next=https://evil.invalid','?tab=follow&tab=share','?tab=follow#evil']){m.rememberMemberLoginReturn('/pages/member-community/index'+bad);assert.equal(m.consumeMemberLoginReturn(),'')}
});
test('social markup has no internal-post entry or remote private-image source',()=>{
 const xml=fs.readFileSync(path.join(root,'pages/member-community/index.wxml'),'utf8');assert.doesNotMatch(xml,/bindtap="(?:submitPost|react|prepareShare|submitComment)"/);assert.doesNotMatch(xml,/src="\{\{(?:proof|item)\.url/);assert.match(xml,/提交审核/);assert.equal(createLoader().load('models/member-social.js').socialPlatforms.find(item=>item.key==='WECHAT_MOMENTS').label,'朋友圈');assert.match(xml,/previewSocialProof/);
});

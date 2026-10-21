const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');

function overview(patch={}) { return {ok:true,pointsBalance:1000,registered:true,ruleVersion:1,summary:'按当前规则',shoppingRule:{enabled:true,pointsPerYuan:1,centsPerPoint:100,settlementLabel:'确认收货后',description:'确认收货后按规则发放积分'},tasks:[{key:'INVITE',title:'邀请入会',description:'邀请关系需核验',rewardPoints:100,enabled:true,state:'AVAILABLE',limitLabel:''},{key:'STUDENT',title:'学生认证',rewardPoints:100,enabled:true,state:'AVAILABLE'},{key:'PROFILE',title:'完善资料',rewardPoints:100,enabled:false,state:'DISABLED'}],community:{enabled:true,postingEnabled:true},officialAccount:{enabled:false,qrImageUrl:''},enterpriseContact:{enabled:false,qrImageUrl:''},lotteries:[{id:'L1',title:'会员抽奖',enabled:true,costPoints:100,maxDraws:3,remainingDraws:3,prizes:[{id:'NONE',title:'谢谢参与',kind:'NONE',points:0,probability:1,remainingStock:null}]}],surveys:[{id:'STYLE_SURVEY',title:'偏好问卷',enabled:true,rewardPoints:20,completed:false,questions:[{id:'q1',title:'风格',type:'SINGLE',required:true,options:['简约','运动']},{id:'q2',title:'说明',type:'TEXT',required:false,options:[]}]}],referral:{code:null,invited:0,rewarded:0,bound:false},posts:[{id:'P1',authorName:'会员',text:'一段已经审核的穿着体验文字',likeCount:1,favoriteCount:0,liked:false,favorited:false}],myApplications:[],myPosts:[],...patch}; }
function make(name,{value=overview(),action,guest=false,modal=true,storage}={}) {
 const store=storage||new Map([['merchantkit.session',guest?null:{accessToken:'local-only',expiresAt:'2099-01-01'}],['merchantkit.user',{id:'QA-LOCAL-MEMBER'}]]);const calls=[],nav=[];
 const wx={getStorageSync:k=>store.get(k),setStorageSync:(k,v)=>store.set(k,v),removeStorageSync:k=>store.delete(k),switchTab:v=>nav.push(v.url),navigateTo:v=>nav.push(v.url),showModal:options=>{if(typeof modal==='function')modal(options);else options.success({confirm:modal});},stopPullDownRefresh(){}};
 const service={fetchMemberOperations:async()=>structuredClone(typeof value==='function'?value():value),memberOperation:async(a,p)=>{calls.push({action:a,payload:structuredClone(p)});return action?action(a,p):{ok:true};}};
 const loader=createLoader(wx,{[path.join(root,'services/member-operations.js')]:service});loader.load(`pages/member-${name}/index.js`);const page=loader.page;page.data=structuredClone(page.data);page.setData=patch=>Object.assign(page.data,patch);page.onLoad({});return {page,calls,nav,store,service,wx,loader};
}

test('all six operation pages bind real methods and keep native page chrome',()=>{
 for(const name of ['earn','invite','lottery','student','surveys','community']){const {page}=make(name);const xml=fs.readFileSync(path.join(root,`pages/member-${name}/index.wxml`),'utf8');for(const match of xml.matchAll(/(?:bind|catch)(?::)?[\w-]+="([A-Za-z][\w]*)"/g))assert.equal(typeof page[match[1]],'function',name+' '+match[1]);assert.match(xml,/<brand-header back/);assert.doesNotMatch(xml,/Calvin|CK会员/);}
});
test('guest never fetches or invents points and login preserves invitation code',async()=>{
 const x=make('invite',{guest:true});let reads=0;x.service.fetchMemberOperations=async()=>{reads++;return overview()};x.page.onLoad({referralCode:'INVITE123'});await x.page.loadOperations();assert.equal(reads,0);assert.equal(x.page.data.overview,null);assert.equal(x.page.data.guest,true);x.page.goLogin();assert.equal(x.nav.at(-1),'/pages/account/index');assert.equal(x.loader.load('stores/navigation.js').consumeMemberLoginReturn(),'/pages/member-invite/index?referralCode=INVITE123');
});
test('presentation hides disabled reward promises and unsafe contact links',()=>{
 const loader=createLoader();const model=loader.load('models/member-operations.js');const result=model.operationsPresentation(overview({officialAccount:{enabled:true,qrImageUrl:'javascript:bad'},enterpriseContact:{enabled:false,qrImageUrl:'https://example.invalid/a.png'}}));assert.equal(result.tasks.find(x=>x.key==='PROFILE').rewardLabel,'');assert.equal(result.officialVisible,false);assert.equal(result.enterpriseVisible,false);assert.equal(result.lotteries[0].prizes[0].probabilityLabel,'100%');
});
test('draft lottery and cancelled confirmation never create a draw or debit',async()=>{
 const draft=make('lottery',{value:overview({lotteries:[{id:'L1',title:'草稿',enabled:false,costPoints:100,remainingDraws:3,prizes:[]}]})});await draft.page.loadOperations();await draft.page.draw({currentTarget:{dataset:{id:'L1'}}});assert.equal(draft.calls.length,0);
 const cancel=make('lottery',{modal:false});await cancel.page.loadOperations();await cancel.page.draw({currentTarget:{dataset:{id:'L1'}}});assert.equal(cancel.calls.length,0);assert.equal(cancel.page.data.busy,false);
});
test('ambiguous lottery result keeps the same request across retries and page recreation',async()=>{
 const x=make('lottery',{action:async()=>{throw Error('NETWORK_REQUEST_FAILED')}});await x.page.loadOperations();await x.page.draw({currentTarget:{dataset:{id:'L1'}}});const requestId=x.calls[0].payload.requestId;assert.match(requestId,/^[\w-]{8,80}$/);assert.equal(x.page.pendingDraw.requestId,requestId);assert.equal(x.page.data.pointsBalance,undefined);x.page.onUnload();const y=make('lottery',{storage:x.store,action:async()=>({ok:true,draw:{id:'D1',prizeTitle:'谢谢参与',kind:'NONE',points:0,costPoints:100},replayed:true})});await y.page.loadOperations();await y.page.draw({currentTarget:{dataset:{id:'L1'}}});assert.equal(y.calls[0].payload.requestId,requestId);assert.equal(y.page.pendingDraw,null);assert.equal(y.page.data.result.id,'D1');assert.equal([...x.store.keys()].some(k=>k.includes('.pending.draw.')),false);
});
test('draw double tap is blocked while the cost confirmation is open',async()=>{
 let decision;const x=make('lottery',{modal:options=>{decision=options}});await x.page.loadOperations();const pending=x.page.draw({currentTarget:{dataset:{id:'L1'}}});await x.page.draw({currentTarget:{dataset:{id:'L1'}}});assert.equal(x.calls.length,0);assert.equal(x.page.confirmingDraw,true);decision.success({confirm:false});await pending;assert.equal(x.page.data.busy,false);
});
test('pending official student verification rejects even fully populated legacy manual callbacks',async()=>{
 const value=overview({myApplications:[{id:'A1',taskKey:'STUDENT',status:'REJECTED',note:'历史记录',revision:2}]});const x=make('student',{value});await x.page.loadOperations();x.page.setData({canSubmit:true,confirmed:true,school:'某某大学',graduationYear:'2028',note:'在读',proofItems:[{localId:'proof-1',id:'msu_'+'a'.repeat(32),url:'/api/miniprogram/member-operations/proofs/msu_'+'a'.repeat(32)}]});await x.page.submit();assert.equal(x.calls.length,0);assert.equal(x.page.data.notice,'暂未开放');assert.equal(x.page.data.application.status,'REJECTED');
 const pending=make('student',{value:overview({myApplications:[{id:'A1',taskKey:'STUDENT',status:'PENDING',revision:1}]})});await pending.page.loadOperations();pending.page.setData({confirmed:true,school:'某某大学',graduationYear:'2028'});await pending.page.submit();assert.equal(pending.calls.length,0);
});
test('surveys submit actual answers once completed and require required questions',async()=>{
 const x=make('surveys',{action:async()=>({ok:true,completed:true,rewardPoints:20})});await x.page.loadOperations();x.page.selectSurvey({currentTarget:{dataset:{id:'STYLE_SURVEY'}}});x.page.setData({confirmed:true});await x.page.submit();assert.equal(x.calls.length,0);x.page.changeAnswer({currentTarget:{dataset:{id:'q1'}},detail:{value:'简约'}});x.page.setData({confirmed:true});await x.page.submit();assert.deepEqual(x.calls[0].payload,{surveyId:'STYLE_SURVEY',answers:{q1:'简约'}});
 const done=make('surveys',{value:overview({surveys:[{id:'STYLE_SURVEY',enabled:true,completed:true,questions:[]}]})});await done.page.loadOperations();done.page.selectSurvey({currentTarget:{dataset:{id:'STYLE_SURVEY'}}});done.page.setData({confirmed:true});await done.page.submit();assert.equal(done.calls.length,0);
});
test('invitation is automatically bound after qualification and sharing never adds a business write',async()=>{
 const x=make('invite',{value:overview({referral:{code:'INVITE123',invited:1,rewarded:0,bound:false}}),action:async()=>({ok:true,bound:true})});x.page.onLoad({referralCode:'FRIEND123'});await x.page.loadOperations();assert.equal(x.calls.length,1);assert.equal(x.calls[0].action,'bind_referral');assert.equal(x.calls[0].payload.code,'FRIEND123');const share=x.page.onShareAppMessage();assert.match(share.path,/referralCode=INVITE123/);assert.equal(x.calls.length,1);
});
test('community posting is moderated, uses request id, and never assumes publication',async()=>{
 const x=make('community',{action:async()=>({ok:true,post:{id:'NEW1',status:'PENDING'}})});await x.page.loadOperations();x.page.setData({postText:'这是一段真实的产品穿着体验内容，用于本地模拟检查。',confirmed:true});await x.page.submitPost();assert.equal(x.calls[0].action,'create_post');assert.match(x.calls[0].payload.requestId,/^[\w-]{8,80}$/);assert.equal(x.page.data.overview.posts.length,1);assert.equal(x.page.data.postText,'');assert.match(x.page.data.notice,/审核/);
});
test('community reactions are server-backed and sharing does not reward on callback',async()=>{
 const x=make('community',{action:async(action)=>action==='create_share'?{ok:true,token:'TOKEN123456'}:{ok:true}});await x.page.loadOperations();await x.page.react({currentTarget:{dataset:{id:'P1',reaction:'LIKE'}}});assert.deepEqual(x.calls[0],{action:'react_post',payload:{postId:'P1',reaction:'LIKE',active:true}});assert.equal(x.page.data.overview.posts[0].liked,false);await x.page.prepareShare({currentTarget:{dataset:{id:'P1'}}});const count=x.calls.length;assert.match(x.page.onShareAppMessage({from:'button',target:{dataset:{id:'P1'}}}).path,/shareToken=TOKEN123456/);assert.equal(x.calls.length,count);
});
test('disabled community and contact drafts never send application or content mutations',async()=>{
 const c=make('community',{value:overview({community:{enabled:false,postingEnabled:false}})});await c.page.loadOperations();c.page.setData({postText:'这是一段超过二十字且不应该提交的草稿文字内容。',confirmed:true});await c.page.submitPost();await c.page.react({currentTarget:{dataset:{id:'P1',reaction:'LIKE'}}});assert.equal(c.calls.length,0);
 const e=make('earn');await e.page.loadOperations();e.page.setData({contactKey:'ENTERPRISE'});e.page.updateContact();await e.page.submitContact();await e.page.claimProfile();e.page.openTask({currentTarget:{dataset:{key:'STUDENT'}}});assert.equal(e.calls.length,0);assert.equal(e.nav.length,0);assert.equal(e.page.data.overview.tasks.find(task=>task.key==='STUDENT').stateLabel,'暂未开放');
});
test('late loads cannot overwrite an unloaded page and failed refresh disables mutations',async()=>{
 const x=make('student');let resolve;x.service.fetchMemberOperations=()=>new Promise(r=>{resolve=r});const pending=x.page.loadOperations();x.page.onUnload();resolve(overview());await pending;assert.equal(x.page.data.overview,null);
 const y=make('student');y.service.fetchMemberOperations=async()=>{throw Error('unavailable')};await y.page.loadOperations();assert.equal(y.page.data.syncFailed,true);assert.equal(y.page.canOperate(),false);
});
test('login return accepts only exact operation routes and known bounded query fields',()=>{
 const {rememberMemberLoginReturn,consumeMemberLoginReturn}=createLoader().load('stores/navigation.js');
 for(const route of ['/pages/subscriptions/index','/pages/member-earn/index','/pages/member-invite/index?referralCode=INVITE123','/pages/member-community/index?shareToken=TOKEN123456','/pages/member-surveys/index?id=STYLE_SURVEY','/pages/member/index?section=points']){rememberMemberLoginReturn(route);assert.equal(consumeMemberLoginReturn(),route);assert.equal(consumeMemberLoginReturn(),'');}
 for(const route of ['/pages/member-invite/index?referralCode=INVITE123&referralCode=OTHER123','/pages/member-community/index?shareToken=https%3A%2F%2Fevil.invalid','/pages/member-earn/index?next=other','/pages/member-surveys/index?id=UNKNOWN','//evil.invalid/pages/member-earn/index','/pages/subscriptions/index?callback=https://evil.invalid']){rememberMemberLoginReturn(route);assert.equal(consumeMemberLoginReturn(),'');}
});
test('service uses the authenticated endpoint, no write retries, and validates costly results',async()=>{
 const calls=[];let response=overview();const loader=createLoader({}, {[path.join(root,'services/http.js')]:{request:async request=>{calls.push(request);return response}}});const service=loader.load('services/member-operations.js');await service.fetchMemberOperations();assert.equal(calls[0].path,'/api/miniprogram/member-operations');assert.equal(calls[0].auth,'required');response={ok:true,draw:{id:'D1',prizeTitle:'谢谢参与',costPoints:100}};await service.memberOperation('draw',{lotteryId:'L1',requestId:'QA-request'});assert.equal(calls[1].method,'POST');assert.equal(calls[1].retries,0);response={ok:true};await assert.rejects(service.memberOperation('draw',{}),/INVALID_MEMBER_OPERATION_RESPONSE/);response={ok:true,pointsBalance:0};await assert.rejects(service.fetchMemberOperations(),/INVALID_MEMBER_OPERATIONS_RESPONSE/);
});
test('account changes block stale mutations and clear the previous account overview',async()=>{
 const x=make('student');await x.page.loadOperations();x.page.setData({confirmed:true,school:'旧账户大学',graduationYear:'2028'});x.store.set('merchantkit.user',{id:'QA-OTHER-MEMBER'});await x.page.submit();assert.equal(x.calls.length,0);await x.page.loadOperations();assert.equal(x.page.data.school,'');assert.equal(x.page.data.confirmed,false);
});
test('configured upload QR images use the existing website origin and encoded traversal is hidden',async()=>{
 let response=overview({officialAccount:{enabled:true,name:'品牌公众号',qrImageUrl:'/uploads/qr/code.png'},enterpriseContact:{enabled:true,name:'顾问',qrImageUrl:'/uploads/%2e%2e/private'}});const loader=createLoader({}, {[path.join(root,'services/http.js')]:{request:async()=>response}});const service=loader.load('services/member-operations.js');const value=await service.fetchMemberOperations();assert.equal(value.officialAccount.qrImageUrl,'https://example.invalid/uploads/qr/code.png');assert.equal(value.enterpriseContact.qrImageUrl,'');
});
test('an authenticated post receipt clears an ambiguous pending post without inventing publication',async()=>{
 const x=make('community',{action:async()=>{throw Error('NETWORK_REQUEST_FAILED')}});await x.page.loadOperations();x.page.setData({postText:'这是一段用于本地检查的真实长度示例，不含任何个人信息。',confirmed:true});await x.page.submitPost();const requestId=x.calls[0].payload.requestId;assert.equal(x.page.pendingPost.requestId,requestId);x.service.fetchMemberOperations=async()=>overview({myPosts:[{id:'POST1',requestId,text:x.page.data.postText,status:'PENDING',note:'',revision:1}]});await x.page.loadOperations();assert.equal(x.page.pendingPost,null);assert.equal(x.page.data.overview.myPosts[0].status,'PENDING');assert.equal(x.page.data.overview.posts.length,1);
});


test('comments use moderated server submission and never appear public before approval',async()=>{
 const x=make('community',{action:async()=>({ok:true,comment:{id:'COMMENT1',status:'PENDING'}})});await x.page.loadOperations();x.page.openComment({currentTarget:{dataset:{id:'P1'}}});x.page.changeComment({detail:{value:'这是一条本地评论。'}});await x.page.submitComment();assert.equal(x.calls[0].action,'create_comment');assert.equal(x.calls[0].payload.postId,'P1');assert.match(x.calls[0].payload.requestId,/^[A-Za-z0-9_-]{8,80}$/);assert.equal(x.page.data.overview.posts[0].commentCount,0);assert.equal(x.page.data.overview.comments.length,0);assert.match(x.page.data.notice,/审核/);assert.equal(x.page.pendingComment,null);
});
test('ambiguous comment retry keeps request id and own receipt clears pending safely',async()=>{
 const x=make('community',{action:async()=>{throw Error('NETWORK_REQUEST_FAILED')}});await x.page.loadOperations();x.page.openComment({currentTarget:{dataset:{id:'P1'}}});x.page.setData({commentText:'评论界面检查'});await x.page.submitComment();const id=x.calls[0].payload.requestId;await x.page.submitComment();assert.equal(x.calls[1].payload.requestId,id);x.service.fetchMemberOperations=async()=>overview({myComments:[{id:'COMMENT1',requestId:id,postId:'P1',text:'评论界面检查',status:'PENDING',note:'',revision:1}]});await x.page.loadOperations();assert.equal(x.page.pendingComment,null);assert.equal(x.page.data.overview.myComments[0].status,'PENDING');assert.equal(x.page.data.overview.comments.length,0);
});
test('disabled community and invalid comment text never send a comment mutation',async()=>{
 const x=make('community');await x.page.loadOperations();x.page.openComment({currentTarget:{dataset:{id:'P1'}}});x.page.setData({commentText:'一'});await x.page.submitComment();assert.equal(x.calls.length,0);x.page.setData({commentText:'有效评论',overview:{...x.page.data.overview,community:{enabled:false,postingEnabled:false}}});await x.page.submitComment();assert.equal(x.calls.length,0);
});

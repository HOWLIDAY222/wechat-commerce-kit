const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
const offer={enabled:true,visible:true,status:'CLAIMABLE',amountCents:500,minimumCents:4900,bonusPoints:1000};
function account(service,app={globalData:{}},wx={}){
 const loader=createLoader({getStorageSync:()=>null,...wx},{[path.join(root,'services/member.js')]:service},app);
 loader.load('pages/account/index.js');const p=loader.page;p.setData=v=>Object.assign(p.data,v);return {p,app,loader};
}
function member(service,wx={},loggedIn=true){
 const loader=createLoader({getStorageSync:()=>null,switchTab(){},...wx},{[path.join(root,'services/member.js')]:service,[path.join(root,'stores/session.js')]:{hasSession:()=>loggedIn}});
 loader.load('pages/member/index.js');const p=loader.page;p.setData=v=>Object.assign(p.data,v);return {p,loader};
}
test('newcomer service supports anonymous browsing and formats actual configured benefits',async()=>{
 let request;const loader=createLoader({}, {[path.join(root,'services/http.js')]:{request:async input=>{request=input;return {ok:true,offer};}}});
 const result=await loader.load('services/member.js').fetchNewcomerOffer();assert.equal(request.auth,'optional');assert.equal(request.path,'/api/miniprogram/newcomer');assert.equal(result.couponText,'满49减5');assert.equal(result.bonusPoints,1000);assert.equal(result.claimable,true);
});
test('inactive and ineligible campaigns never become a visible account offer',async()=>{
 for(const value of [{...offer,enabled:false},{...offer,visible:false,status:'INELIGIBLE'}]){
  const loader=createLoader({}, {[path.join(root,'services/http.js')]:{request:async()=>({ok:true,offer:value})}});assert.equal(await loader.load('services/member.js').fetchNewcomerOffer(),null);
 }
});
test('account ignores stale personalized benefit responses and clears an unavailable offer',async()=>{
 let resolve;let count=0;const {p}=account({fetchMemberPromotions:()=>++count===1?new Promise(r=>resolve=r):count===2?Promise.resolve({newcomer:{...offer,status:'CLAIMED'},promotions:null}):Promise.reject(Error('OFFLINE'))});
 const first=p.loadMemberPromotions();await p.loadMemberPromotions();resolve({newcomer:offer,promotions:null});await first;assert.equal(p.data.newcomerOffer.status,'CLAIMED');
 await p.loadMemberPromotions();assert.equal(count,3);assert.equal(p.data.newcomerOffer,null);
});
test('account newcomer entry requires login and resumes its destination after existing login',async()=>{
 let signedIn=false;const urls=[],loader=createLoader({getStorageSync:()=>null,pageScrollTo(){},navigateTo:v=>urls.push(v.url)},{[path.join(root,'stores/session.js')]:{hasSession:()=>signedIn}});
 loader.load('pages/account/index.js');const p=loader.page;p.setData=v=>Object.assign(p.data,v);
 p.openNewcomer();assert.equal(urls.length,0);assert.equal(p.loginReturnRoute,'/pages/member/index?section=newcomer');assert.equal(p.data.loginOpen,true);assert.equal(p.data.consented,false);assert.equal(p.data.crossBorderConsented,false);
 signedIn=true;p.finishMemberLogin();p.finishMemberLogin();assert.deepEqual(urls,['/pages/member/index?section=newcomer']);
});
test('newcomer login return survives phone login and explicit membership consent remains required',async()=>{
 const {p,loader}=member({}, {},false);p.onLoad({section:'newcomer'});await p.loadMember();assert.equal(loader.load('stores/navigation.js').consumeMemberLoginReturn(),'/pages/member/index?section=newcomer');
 let calls=0;const ready=member({memberAction:async()=>calls++,fetchMember:async()=>({wallet:[],newcomer:offer})}).p;ready.data.loading=false;await ready.join();assert.equal(calls,0);
});
test('already-joined first-time buyers claim once during double tap and see 1000 points after refresh',async()=>{
 let finish;const actions=[];const {p}=member({memberAction:async action=>{actions.push(action);await new Promise(r=>finish=r);},fetchMember:async()=>({member:{},newcomer:{...offer,claimed:true},wallet:[{id:'first',status:'AVAILABLE'}],points:{balance:1000}})});
 p.data.loading=false;p.data.overview={member:{},newcomer:offer};const first=p.claimNewcomer();await p.claimNewcomer();assert.deepEqual(actions,['newcomer']);finish();await first;assert.equal(p.data.overview.points.balance,1000);assert.equal(p.data.walletItems[0].id,'first');
 await p.claimNewcomer();assert.deepEqual(actions,['newcomer']);
});
test('failed eligibility checks cannot display a successful gift or a fabricated point balance',async()=>{
 const {p}=member({memberAction:async()=>{throw Error('COUPON_NEWCOMER_ONLY');}});p.data.loading=false;p.data.overview={member:{},points:{balance:0}};
 await p.claimNewcomer();assert.equal(p.data.overview.points.balance,0);assert.match(p.data.error,/成功支付/);assert.equal(p.data.notice,'');
});
test('a first redemption leaves the configured second redemption visible with its count and balance',async()=>{
 let actions=0;const overview={member:{},wallet:[{id:'one',status:'AVAILABLE'}],points:{balance:500},rewards:[{templateId:'reward',title:'兑换券',pointsCost:500,canAfford:true,eligible:true,claimed:false,redemptionCount:1,perUserLimit:2}]};
 const {p}=member({memberAction:async()=>actions++,fetchMember:async()=>overview},{showModal:o=>o.success({confirm:true})});p.data.loading=false;p.data.overview={...overview,points:{balance:1000},rewards:[{...overview.rewards[0],redemptionCount:0}]};
 await p.redeem({currentTarget:{dataset:{id:'reward'}}});assert.equal(actions,1);assert.equal(p.data.rewardsEmpty,false);assert.equal(p.data.rewardItems[0].redemptionCount,1);assert.equal(p.data.overview.points.balance,500);
});

test('native price preview preserves points coupons when an equal first-purchase coupon is available',()=>{
 const loader=createLoader(),view=loader.load('models/product-price.js').productPriceView;
 const now=Date.now(),coupon={amountCents:500,minimumCents:4900,productIds:[],status:'AVAILABLE',startsAt:new Date(now-1000).toISOString()};
 const result=view({id:'product',priceCents:4900},{quantity:1,variant:{priceCents:4900}},[{...coupon,id:'points',endsAt:new Date(now+86400000).toISOString()},{...coupon,id:'first',newcomerOnly:true,endsAt:new Date(now+172800000).toISOString()}],'ready',now);
 assert.equal(result.couponId,'first');assert.equal(result.payableCents,4400);
});

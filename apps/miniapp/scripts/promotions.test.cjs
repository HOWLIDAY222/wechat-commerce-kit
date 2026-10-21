const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
const summary={campaign:{enabled:true,visible:true,status:'ACTIVE',startsAt:'2026-10-14T16:00:00.000Z',endsAt:'2026-12-14T15:59:59.999Z',tiers:[[49,5],[69,10],[129,20],[189,30],[249,50]].map(([minimum,amount])=>({minimumCents:minimum*100,amountCents:amount*100,active:true}))},exchange:{enabled:true,available:true,pointsPerYuan:100,repeatable:true,longTerm:true,denominations:Array.from({length:10},(_,i)=>({amountCents:(i+1)*500,pointsCost:(i+1)*500}))}};
test('public promotions present all five tiers and ten 100-points-per-yuan denominations',async()=>{
 const loader=createLoader({}, {[path.join(root,'services/http.js')]:{request:async()=>({ok:true,offer:{enabled:false},promotions:summary})}});
 const result=await loader.load('services/member.js').fetchMemberPromotions();
 assert.equal(result.newcomer,null);assert.equal(result.promotions.campaign.tiersText,'满49减5 · 满69减10 · 满129减20 · 满189减30 · 满249减50');assert.equal(result.promotions.campaign.periodLabel,'2026/10/15—2026/12/14');assert.equal(result.promotions.exchange.denominations.length,10);
});
test('account offers member campaign entry to customers who are not newcomer-eligible',async()=>{
 const urls=[],loader=createLoader({getStorageSync:()=>null,navigateTo:o=>urls.push(o.url)},{[path.join(root,'services/member.js')]:{fetchMemberPromotions:async()=>({newcomer:null,promotions:summary})}},{globalData:{miniappVisitId:1}});
 loader.load('pages/account/index.js');const p=loader.page;p.setData=data=>Object.assign(p.data,data);p.data.loggedIn=true;
 await p.loadMemberPromotions();assert.equal(p.data.newcomerOffer,null);assert.equal(p.data.promotions.campaign.visible,true);p.openMemberBenefit({currentTarget:{dataset:{section:'claim'}}});assert.equal(urls[0],'/pages/member/index?section=claim');
});
test('after the limited campaign, permanent exchange remains in the account tab',async()=>{
 const urls=[],promotions={...summary,campaign:{...summary.campaign,visible:false,status:'ENDED'}},loader=createLoader({getStorageSync:()=>null,navigateTo:o=>urls.push(o.url)},{[path.join(root,'services/member.js')]:{fetchMemberPromotions:async()=>({newcomer:null,promotions})}},{globalData:{miniappVisitId:1}});
 loader.load('pages/account/index.js');const p=loader.page;p.setData=data=>Object.assign(p.data,data);p.data.loggedIn=true;await p.loadMemberPromotions();p.openMemberBenefit({currentTarget:{dataset:{section:'points'}}});assert.equal(urls[0],'/pages/member/index?section=points');assert.equal(p.data.promotions.exchange.available,true);
});
test('long-term redeemed coupons display their actual validity and have no extra minimum',async()=>{
 const loader=createLoader({}, {[path.join(root,'services/http.js')]:{request:async()=>({ok:true,member:{},wallet:[{id:'one',longTerm:true,minimumCents:0,amountCents:1000,endsAt:'9999-12-31T15:59:59.999Z',status:'AVAILABLE'}],available:[],rewards:[],points:{balance:0},promotions:summary})}});
 const result=await loader.load('services/member.js').fetchMember();assert.equal(result.wallet[0].validityLabel,'长期有效');assert.equal(result.wallet[0].threshold,'无额外满减门槛');assert.equal(result.wallet[0].amount,'10');
});
test('repeatable rewards stay visible after three completed exchanges and charge new requests',async()=>{
 let count=0;const requests=[];let balance=2000;
 const reward=()=>({templateId:'repeatable',title:'5元长期券',longTerm:true,pointsCost:500,claimed:false,eligible:true,canAfford:balance>=500,unlimitedRedemption:true,redemptionCount:count,perUserLimit:null});
 const loader=createLoader({getStorageSync:()=>null,showModal:o=>o.success({confirm:true})},{[path.join(root,'stores/session.js')]:{hasSession:()=>true},[path.join(root,'services/member.js')]:{memberAction:async(action,id,requestId)=>{requests.push(requestId);count++;balance-=500;},fetchMember:async()=>({member:{},wallet:[],points:{balance},rewards:[reward()]})}});
 loader.load('pages/member/index.js');const p=loader.page;p.setData=data=>Object.assign(p.data,data);p.data.loading=false;p.data.overview={member:{},rewards:[reward()]};
 for(let n=0;n<3;n++)await p.redeem({currentTarget:{dataset:{id:'repeatable'}}});
 assert.equal(balance,500);assert.equal(count,3);assert.equal(new Set(requests).size,3);assert.equal(p.data.rewardsEmpty,false);assert.equal(p.data.rewardItems[0].unlimitedRedemption,true);
});
test('the storefront homepage no longer loads personalized membership benefits',()=>{
 const loader=createLoader({getStorageSync:()=>null});loader.load('pages/home/home.js');const p=loader.page;let loads=0;p.load=()=>loads++;
 p.onShow();p.onPullDownRefresh();assert.equal(loads,2);assert.equal(p.data.promotions,undefined);assert.equal(p.loadMemberPromotions,undefined);assert.equal(p.loadNewcomer,undefined);
});
test('each guest benefit entry preserves its destination without accepting login consent',()=>{
 for(const section of ['wallet','claim','points']){
  const urls=[],loader=createLoader({getStorageSync:()=>null,pageScrollTo(){},navigateTo:o=>urls.push(o.url)});loader.load('pages/account/index.js');const p=loader.page;p.setData=data=>Object.assign(p.data,data);
  p.openMemberBenefit({currentTarget:{dataset:{section}}});assert.equal(p.loginReturnRoute,'/pages/member/index?section='+section);assert.equal(p.data.loginOpen,true);assert.equal(p.data.consented,false);assert.equal(p.data.crossBorderConsented,false);assert.equal(urls.length,0);
 }
});

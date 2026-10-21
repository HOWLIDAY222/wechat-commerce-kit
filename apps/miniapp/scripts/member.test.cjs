const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
function page(service,wx={}){const loader=createLoader({getStorageSync:()=>null,showToast(){},switchTab(){},...wx},{[path.join(root,'stores/session.js')]:{hasSession:()=>true},[path.join(root,'services/member.js')]:service});loader.load('pages/member/index.js');const p=loader.page;p.setData=data=>Object.assign(p.data,data);return p;}
test('stale member response cannot replace a newer overview',async()=>{
 let resolveOld;let calls=0;const p=page({fetchMember:()=>++calls===1?new Promise(r=>resolveOld=r):Promise.resolve({memberNo:'NEW'} )});
 const old=p.loadMember();await p.loadMember();resolveOld({memberNo:'OLD'});await old;assert.equal(p.data.overview.memberNo,'NEW');
});
test('double claim tap sends once and membership requires explicit consent',async()=>{
 let resolve;let calls=0;const p=page({fetchMember:async()=>({wallet:[]}),memberAction:()=>{calls++;return new Promise(r=>resolve=r);}});p.data.loading=false;
 await p.join();assert.equal(calls,0);const first=p.perform('claim','id');await p.perform('claim','id');assert.equal(calls,1);resolve();await first;assert.equal(p.data.busy,false);
});
test('checkout sends quoted amount for server-side confirmation and opts into coupons',async()=>{
 let input;const loader=createLoader({getStorageSync:()=>null},{[path.join(root,'config/index.js')]:{config:{checkoutEnabled:true,paymentEnabled:true,paymentProvider:'wechat'}},[path.join(root,'services/http.js')]:{request:async x=>{input=x;return {ok:true,order:{items:[],payableAmountCents:3900}};}}});
 await loader.load('services/orders.js').createOrder('address',3900);assert.equal(input.data.useCoupons,true);assert.equal(input.data.expectedPayableCents,3900);
});

function readyReward(p){p.data.loading=false;p.data.overview={member:{memberNo:'QA'},rewards:[{templateId:'reward',title:'测试兑换券',pointsCost:500,eligible:true,canAfford:true}]};}
const rewardEvent={currentTarget:{dataset:{id:'reward'}}};
test('redemption cancellation and insufficient balance never debit',async()=>{
 let calls=0;const p=page({memberAction:async()=>{calls++;}},{showModal:o=>o.success({confirm:false})});readyReward(p);
 await p.redeem(rewardEvent);assert.equal(calls,0);assert.equal(p.data.busy,false);
 p.data.overview.rewards[0].canAfford=false;await p.redeem(rewardEvent);assert.equal(calls,0);
});
test('redemption double tap and uncertain retry preserve the request identifier',async()=>{
 let decide;const requests=[];let fail=true;
 const p=page({fetchMember:async()=>({member:{},wallet:[{id:'claimed'}],rewards:[],points:{balance:0}}),memberAction:async(...args)=>{requests.push(args);if(fail)throw Error('NETWORK_REQUEST_FAILED');}},{showModal:o=>{decide=()=>o.success({confirm:true});}});readyReward(p);
 const first=p.redeem(rewardEvent);await p.redeem(rewardEvent);assert.equal(requests.length,0);decide();await first;assert.equal(requests.length,1);
 assert.match(requests[0][2],/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 fail=false;const retry=p.redeem(rewardEvent);decide();await retry;assert.equal(requests.length,2);assert.equal(requests[0][2],requests[1][2]);assert.equal(p.data.overview.wallet[0].id,'claimed');assert.equal(p.pendingRedemption,null);
});
test('redemption service sends the UUID and formats point offers',async()=>{
 let input;const loader=createLoader({}, {[path.join(root,'services/http.js')]:{request:async x=>{input=x;return {ok:true,wallet:[],available:[],rewards:[{templateId:'r',amountCents:500,minimumCents:4900,pointsCost:500,canAfford:false,eligible:true}]};}}});
 const service=loader.load('services/member.js');await service.memberAction('redeem','r','id');assert.equal(input.data.requestId,'id');assert.equal(input.data.action,'redeem');const result=await service.fetchMember();assert.equal(result.rewards[0].redeemLabel,'积分不足');assert.equal(result.rewards[0].amount,'5');
});

test('a redeemed coupon appears in current wallet without contradictory empty state',async()=>{
 const p=page({fetchMember:async()=>({member:{},wallet:[{id:'ready',status:'AVAILABLE'},{id:'held',status:'HELD'},{id:'used',status:'USED'}],available:[],rewards:[{templateId:'r',claimed:true}],points:{balance:0,entries:[{id:'e',delta:-500,balanceAfter:0}]}})});
 p.onLoad({});await p.loadMember();assert.equal(p.data.showWallet,true);assert.equal(p.data.showPoints,false);assert.equal(p.data.walletEmpty,false);assert.equal(p.data.walletCurrentCount,2);assert.equal(p.data.walletHistoryCount,1);assert.equal(p.data.rewardsEmpty,true);assert.equal(p.data.hasRedeemedRewards,true);assert.equal(p.data.ledgerEmpty,false);
 p.changeWalletFilter({currentTarget:{dataset:{filter:'history'}}});assert.equal(p.data.walletItems.length,1);assert.equal(p.data.walletItems[0].id,'used');assert.equal(p.data.walletEmpty,false);
 p.openPoints();assert.equal(p.data.showWallet,false);assert.equal(p.data.showClaim,false);assert.equal(p.data.showPoints,true);assert.equal(p.data.showLedger,false);assert.equal(p.data.showRules,false);
});

test('successful redemption opens the current wallet with a persistent result',async()=>{
 const p=page({fetchMember:async()=>({member:{},wallet:[{id:'new',status:'AVAILABLE'}],rewards:[{templateId:'reward',claimed:true}],points:{balance:0,entries:[]}}),memberAction:async()=>{}},{showModal:o=>o.success({confirm:true})});readyReward(p);p.data.activeTab='points';
 await p.redeem(rewardEvent);assert.equal(p.data.activeTab,'wallet');assert.equal(p.data.showWallet,true);assert.equal(p.data.walletItems[0].id,'new');assert.match(p.data.notice,/兑换成功/);assert.equal(p.data.rewardsEmpty,true);assert.equal(p.data.overview.points.balance,0);
});

test('committed redemption with failed refresh keeps previous data and blocks another debit',async()=>{
 let debits=0;const p=page({fetchMember:async()=>{throw Error('NETWORK_REQUEST_FAILED');},memberAction:async()=>{debits++;}},{showModal:o=>o.success({confirm:true})});readyReward(p);const previous=p.data.overview;
 await p.redeem(rewardEvent);assert.equal(debits,1);assert.equal(p.data.overview,previous);assert.equal(p.data.syncFailed,true);assert.match(p.data.error,/兑换已完成/);await p.redeem(rewardEvent);assert.equal(debits,1);
});

test('member login return preserves the requested section and checkout context',async()=>{
 for(const section of ['wallet','claim','points']){
  const paths=[];const loader=createLoader({switchTab:o=>paths.push(o.url)}, {[path.join(root,'stores/session.js')]:{hasSession:()=>false}});
  loader.load('pages/member/index.js');const p=loader.page;p.setData=data=>Object.assign(p.data,data);p.onLoad({section,from:'checkout'});await p.loadMember();
  assert.equal(paths[0],'/pages/account/index');assert.equal(loader.load('stores/navigation.js').consumeMemberLoginReturn(),`/pages/member/index?section=${section}&from=checkout`);
 }
});

test('checkout coupon and redemption entrances open their distinct member sections',()=>{
 const urls=[];const loader=createLoader({navigateTo:o=>urls.push(o.url)});loader.load('pages/checkout/index.js');const p=loader.page;p.setData=data=>Object.assign(p.data,data);
 p.openMember({currentTarget:{dataset:{section:'claim'}}});p.openMember({currentTarget:{dataset:{section:'points'}}});assert.deepEqual(urls,['/pages/member/index?section=claim&from=checkout','/pages/member/index?section=points&from=checkout']);
 p.data.submitting=true;p.openMember({currentTarget:{dataset:{section:'points'}}});assert.equal(urls.length,2);
});

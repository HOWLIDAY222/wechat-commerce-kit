const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
const tiers=(a,b,c)=>[{quantity:2,totalPriceCents:a},{quantity:3,totalPriceCents:b},{quantity:4,totalPriceCents:c}];
function product(){return {id:'x1',slug:'x1-air-white',showPrice:true,isPurchasable:true,minPriceCents:4900,colors:['白色'],sizes:['S','M','L'],quantityPricing:{maxQuantity:99,repeatBundles:true,tiers:tiers(8900,12900,16900),styles:[{key:'regular',label:'常规款',unitPriceCents:4900,tiers:tiers(8900,12900,16900)},{key:'upgraded',label:'升级款',unitPriceCents:6900,tiers:tiers(12900,18900,24900)}]},variants:['S','M','L'].map(size=>({size,color:'白色',priceCents:4900,availableQuantity:99,soldOut:false}))};}
const now=Date.UTC(2026,9,15);
function coupon(patch={}){return {id:'claim',title:'已领取的券',status:'AVAILABLE',amountCents:500,minimumCents:4900,productIds:[],startsAt:new Date(now-1000).toISOString(),endsAt:new Date(now+86400000).toISOString(),...patch};}
function calculate(quantity=1,style='regular',wallet=[],status='ready'){
 const l=createLoader(),p=product(),selection=l.load('utils/selection.js').selectionState(p,'M','白色',quantity,style);
 return l.load('models/product-price.js').productPriceView(p,selection,wallet,status,now);
}
test('price equation uses actual selected style and quantity, including combinations above four',()=>{
 for(const [style,q,total,discount] of [['regular',1,4900,0],['regular',2,8900,900],['regular',5,21800,2700],['upgraded',4,24900,2700],['upgraded',8,49800,5400]]){
  const view=calculate(q,style);assert.equal(view.payableCents,total);assert.equal(view.discountCents,discount);assert.equal(view.subtotalCents-view.discountCents,view.payableCents);
 }
 const rows=calculate(5).bundles;assert.equal(rows.length,2);assert.equal(rows[0].label,'4 条装 × 1');assert.equal(rows[0].amountLabel,'¥169');assert.equal(rows[1].amountLabel,'¥49');
});
test('one claimed coupon can beat combination pricing but never stacks with it; a tie preserves the coupon',()=>{
 let view=calculate(1,'regular',[coupon()]);assert.equal(view.payableCents,4400);assert.equal(view.kind,'coupon');
 view=calculate(2,'regular',[coupon()]);assert.equal(view.payableCents,8900);assert.equal(view.kind,'bundle');assert.equal(view.couponId,'');
 view=calculate(2,'regular',[coupon({amountCents:900})]);assert.equal(view.kind,'bundle');
 view=calculate(2,'regular',[coupon({amountCents:1000})]);assert.equal(view.payableCents,8800);assert.equal(view.discountCents,1000);assert.equal(view.bundles.length,0);
 view=calculate(1,'regular',[coupon({amountCents:100000})]);assert.equal(view.payableCents,1);
});
test('unclaimed, held, expired, future, out-of-scope and below-threshold coupons do not reduce the price',()=>{
 for(const patch of [{status:'HELD'},{status:'USED'},{status:'EXPIRED'},{status:'INELIGIBLE'},{endsAt:new Date(now).toISOString()},{startsAt:new Date(now+1000).toISOString()},{productIds:['other']},{minimumCents:5000},{status:undefined},{amountCents:NaN},{endsAt:'invalid'}])assert.equal(calculate(1,'regular',[coupon(patch)]).payableCents,4900);
 for(const status of ['guest','loading','error'])assert.equal(calculate(1,'regular',[coupon()],status).payableCents,4900);
 assert.equal(calculate(1,'regular',[coupon({productIds:['x1']})]).payableCents,4400);
});
test('equal coupons use the earliest expiry and then claim id, matching checkout ordering',()=>{
 const a=coupon({id:'z',endsAt:new Date(now+20000).toISOString()}),b=coupon({id:'b',endsAt:new Date(now+10000).toISOString()}),c=coupon({id:'a',endsAt:b.endsAt});
 assert.equal(calculate(1,'regular',[a,b,c]).couponId,'a');
});
test('price panel closes to the existing selection without losing modal or purchase state',()=>{
 const l=createLoader({getStorageSync:()=>null});l.load('pages/product-detail/index.js');const p=l.page;p.data=structuredClone(p.data);p.setData=v=>Object.assign(p.data,v);
 p.setData({product:product(),selectedStyle:'upgraded',selectedSize:'L',selectedColor:'白色',quantity:5});p.refreshSelection();p.openSpecs();
 p.openPriceDetails();assert.equal(p.data.specOpen,true);assert.equal(p.data.priceSheetOpen,true);
 p.closePriceDetails();assert.equal(p.data.specOpen,true);assert.equal(p.data.quantity,5);assert.equal(p.data.selectedStyle,'upgraded');assert.equal(p.data.selectedSize,'L');
 p.setData({specOpen:false});p.openPriceDetails();p.selectFromPriceDetails();assert.equal(p.data.priceSheetOpen,false);assert.equal(p.data.specOpen,true);p.onUnload();
});
test('a late wallet response cannot expose the previous account coupon after logout',async()=>{
 let session='first',resolveWallet;
 const overrides={[path.join(root,'stores/session.js')]:{readAccessToken:()=>session,hasSession:()=>!!session},[path.join(root,'services/member.js')]:{fetchMember:()=>new Promise(resolve=>resolveWallet=resolve)}};
 const l=createLoader({},overrides);l.load('pages/product-detail/index.js');const p=l.page;p.data=structuredClone(p.data);p.setData=v=>Object.assign(p.data,v);
 const pending=p.loadPriceWallet();session='';await p.loadPriceWallet();resolveWallet({wallet:[coupon()]});await pending;
 assert.equal(p.priceWallet.length,0);assert.equal(p.data.priceWalletStatus,'guest');p.onUnload();
});
test('opening a fresh price estimate reuses the wallet without a second request or a price flash',async()=>{
 let calls=0;
 const overrides={[path.join(root,'stores/session.js')]:{readAccessToken:()=> 'current',hasSession:()=>true},[path.join(root,'services/member.js')]:{fetchMember:async()=>{calls++;return {wallet:[coupon({startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString()})]};}}};
 const l=createLoader({},overrides);l.load('pages/product-detail/index.js');const p=l.page;p.data=structuredClone(p.data);p.setData=v=>Object.assign(p.data,v);
 p.setData({product:product(),selectedStyle:'regular',selectedSize:'M',selectedColor:'白色',quantity:1});p.refreshSelection();await p.loadPriceWallet();assert.equal(p.data.priceView.payableCents,4400);
 p.openPriceDetails();assert.equal(calls,1);assert.equal(p.data.priceView.payableCents,4400);assert.equal(p.data.priceWalletStatus,'ready');p.onUnload();
});

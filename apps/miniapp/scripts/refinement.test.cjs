const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
const event=dataset=>({currentTarget:{dataset}});
function product(){return {slug:'x1-air-white',sizes:['S','M','L'],colors:['白色'],minPriceCents:4900,isPurchasable:true,quantityPricing:{maxQuantity:3,tiers:[{quantity:2,totalPriceCents:7900},{quantity:3,totalPriceCents:9900}]},variants:['S','M','L'].map(size=>({size,color:'白色',priceCents:4900,availableQuantity:10,soldOut:false}))};}
function page(loader){loader.load('pages/product-detail/index.js');const p=loader.page;p.data=structuredClone(p.data);p.setData=v=>Object.assign(p.data,v);return p;}
test('selection totals, average price and savings agree with actual tier pricing',()=>{
 const select=createLoader().load('utils/selection.js').selectionState,p=product();
 let s=select(p,'M','白色',2);assert.equal(s.totalLabel,'¥79');assert.equal(s.unitLabel,'每条 ¥39.50');assert.equal(s.savingLabel,'比单条选购省 ¥19');assert.equal(s.selectionLabel,'白色 / M / 2 条');
 s=select(p,'L','白色',3);assert.equal(s.totalLabel,'¥99');assert.equal(s.unitLabel,'每条 ¥33');assert.equal(s.savingLabel,'比单条选购省 ¥48');
 p.quantityPricing.tiers=[];s=select(p,'L','白色',3);assert.equal(s.totalLabel,'¥147');assert.equal(s.savingLabel,'');assert.equal(s.packs[2].savingLabel,'单条选购');
});
test('switching to low-stock size clamps quantity and disables unavailable packs and sizes',()=>{
 const select=createLoader().load('utils/selection.js').selectionState,p=product();p.variants[0].availableQuantity=1;p.variants[2].soldOut=true;p.variants[2].availableQuantity=0;
 const s=select(p,'S','白色',3);assert.equal(s.quantity,1);assert.equal(s.totalLabel,'¥49');assert.equal(s.packs[1].disabled,true);assert.equal(s.sizes[2].disabled,true);
});
test('shipment deadline uses China calendar and ignores invalid date',()=>{
 const normalize=createLoader().load('models/product.js').normalizeProduct;
 const p=normalize({...product(),release:{estimatedShipAt:'2026-11-15T15:59:59.000Z'}});assert.equal(p.shipLabel,'预计 2026年11月15日前发货');
 assert.equal(normalize({...product(),release:{estimatedShipAt:'2026-11-14T18:00:00.000Z'}}).shipLabel,'预计 2026年11月15日前发货');
 assert.equal(normalize({...product(),release:{estimatedShipAt:'invalid'}}).shipLabel,'');
});
test('guide reuses published content and preserves chosen size and quantity',async()=>{
 let reads=0;const loader=createLoader({}, {[path.join(root,'services/content.js')]:{fetchPublishedPage:async key=>{assert.equal(key,'size-guide');reads++;return {document:{sections:[]}};}},[path.join(root,'models/document-nodes.js')]:{documentNodes:()=>[{name:'p'}]}});
 const p=page(loader);p.setData({product:product(),selectedSize:'L',selectedColor:'白色',quantity:2});p.refreshSelection();await p.openGuide();assert.equal(p.data.guideOpen,true);p.closeGuide();assert.equal(p.data.selectedSize,'L');assert.equal(p.data.quantity,2);assert.equal(p.data.totalLabel,'¥79');await p.openGuide();assert.equal(reads,1);
});
test('guide failure can be retried without navigation or losing selection',async()=>{
 let reads=0;const loader=createLoader({}, {[path.join(root,'services/content.js')]:{fetchPublishedPage:async()=>{if(++reads===1)throw Error('offline');return {};}},[path.join(root,'models/document-nodes.js')]:{documentNodes:()=>[{name:'p'}]}});
 const p=page(loader);p.setData({selectedSize:'S',quantity:3});await p.openGuide();assert.match(p.data.guideError,/重试/);await p.openGuide();assert.equal(p.data.guideError,'');assert.equal(p.data.guideNodes.length,1);assert.equal(p.data.selectedSize,'S');assert.equal(p.data.quantity,3);
});
test('successful addition keeps selected summary; bag shortcut opens bag and add button continues shopping',async()=>{
 const calls=[];let resolveWrite;
 const loader=createLoader({showToast:()=>{},switchTab:v=>calls.push(v.url)}, {[path.join(root,'stores/session.js')]:{hasSession:()=>false},[path.join(root,'services/guest-cart.js')]:{writeGuestItem:input=>new Promise(r=>{calls.push(input);resolveWrite=r;})}});
 const p=page(loader);p.slug='x1-air-white';p.setData({product:product(),selectedSize:'M',selectedColor:'白色',quantity:2,specOpen:true});p.refreshSelection();const add=p.addToCart();await p.addToCart();assert.equal(calls.length,1);assert.equal(p.data.adding,true);resolveWrite();await add;
 assert.equal(p.data.added,true);assert.equal(p.data.addedLabel,'白色 / M / 2 条');p.openBag();assert.equal(calls.at(-1),'/pages/cart/index');p.beginAddToBag();assert.equal(p.data.added,false);assert.equal(p.data.specOpen,true);assert.equal(p.data.specClosing,false);p.onUnload();
});
test('failed add remains selectable and does not show success',async()=>{
 const calls=[];const loader=createLoader({showToast:v=>calls.push(v.title)}, {[path.join(root,'stores/session.js')]:{hasSession:()=>false},[path.join(root,'services/guest-cart.js')]:{writeGuestItem:async()=>{throw Error('INSUFFICIENT_INVENTORY');}}});
 const p=page(loader);p.slug='x1-air-white';p.setData({product:product(),selectedSize:'S',selectedColor:'白色',quantity:1,specOpen:true});p.refreshSelection();await p.addToCart();assert.equal(p.data.added,false);assert.equal(p.data.specOpen,true);assert.equal(p.data.adding,false);assert.match(calls[0],/库存不足/);
});
test('image retry remounts exactly once, clears old state and stops updates after unload',()=>{
 const queue=[],l=createLoader({nextTick:fn=>queue.push(fn)}),m=l.load('utils/media-feedback.js').mediaFeedback;
 const p={...m,data:{mediaLoaded:{photo:true},mediaFailed:{photo:true}},setData:v=>Object.assign(p.data,v)};
 p.onMediaRetry(event({source:'photo'}));p.onMediaRetry(event({source:'photo'}));assert.equal(queue.length,1);assert.equal(p.data.mediaRetrying.photo,true);assert.equal(p.data.mediaLoaded.photo,false);assert.equal(p.data.mediaFailed.photo,false);queue.shift()();assert.equal(p.data.mediaRetrying.photo,false);
 p.onMediaRetry(event({source:'photo'}));p.onUnload();queue.shift()();assert.equal(p.data.mediaRetrying.photo,true);
});
test('catalog selection action goes directly to selected product purchase section',()=>{
 const urls=[],l=createLoader({navigateTo:v=>urls.push(v.url)});l.load('pages/products/index.js');l.page.openPurchase(event({slug:'x1-air-white'}));assert.deepEqual(urls,['/pages/product-detail/index?slug=x1-air-white&section=purchase']);
});

test('malformed link quantity cannot produce fractional or invalid cart selections',()=>{const select=createLoader().load('utils/selection.js').selectionState;for(const q of [NaN,1.5,Infinity,'bad',-2]){const s=select(product(),'M','白色',q);assert.equal(s.quantity,1);assert.equal(s.totalLabel,'¥49');}});

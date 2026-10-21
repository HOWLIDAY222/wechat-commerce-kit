const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
const selection={productSlug:'x1-air-white',style:'upgraded',color:'白色',size:'L',quantity:5};
function session(user='buyer'){let value=user;return {module:{hasSession:()=>!!value,readStoredUser:()=>value?{id:value}:null,readAccessToken:()=>value||''},set:v=>value=v};}
test('direct purchase preserves selection across login, binds it to the buyer and does not write bag storage',()=>{
 const s=session(''),l=createLoader({setStorageSync:()=>assert.fail('Direct selection must not write the bag')},{[path.join(root,'stores/session.js')]:s.module});const store=l.load('stores/direct-checkout.js');
 const draft=store.beginDirectCheckout(selection);assert.equal(draft.selection.quantity,5);assert.match(draft.requestId,/^[a-f0-9-]{36}$/);
 s.set('buyer');assert.equal(store.readDirectCheckout().ownerId,'buyer');assert.equal(store.readDirectCheckout().requestId,draft.requestId);
 s.set('other');assert.throws(()=>store.readDirectCheckout(),/DIRECT_CHECKOUT_ACCOUNT_CHANGED/);
 s.set('buyer');store.clearDirectCheckout('different-request');assert.ok(store.readDirectCheckout());store.clearDirectCheckout(draft.requestId);assert.equal(store.readDirectCheckout(),null);
});
test('buy now keeps its intent through product details and navigates once without calling bag mutations',async()=>{
 const s=session('');let navigations=0;const l=createLoader({navigateTo:v=>{navigations++;v.success({});},showToast(){},nextTick:f=>f()},{[path.join(root,'stores/session.js')]:s.module,[path.join(root,'services/cart.js')]:{addCartItem:()=>assert.fail('Buy now must not add to bag')},[path.join(root,'services/guest-cart.js')]:{writeGuestItem:()=>assert.fail('Buy now must not write guest bag')}});
 l.load('pages/product-detail/index.js');const p=l.page;p.data=structuredClone(p.data);p.setData=v=>Object.assign(p.data,v);p.slug=selection.productSlug;p.setData({product:{isPurchasable:true},variant:{soldOut:false},selectedStyle:selection.style,selectedSize:selection.size,selectedColor:selection.color,quantity:5});
 p.beginBuyNow();assert.equal(p.data.purchaseIntent,'buy');p.openProductDetails();p.closeProductDetails();assert.equal(p.data.purchaseIntent,'buy');
 await Promise.all([p.confirmPurchase(),p.confirmPurchase()]);assert.equal(navigations,1);assert.equal(l.load('stores/direct-checkout.js').readDirectCheckout().selection.quantity,5);p.onUnload();
});
test('direct checkout fetches only its selection and quotes an owned address, without fetching the bag',async()=>{
 const s=session(),calls=[],cart={items:[{id:'direct',quantity:5,size:'L'}],itemCount:5},quote={payableAmountCents:31800};
 const l=createLoader({getStorageSync:()=>null},{[path.join(root,'stores/session.js')]:s.module,[path.join(root,'services/cart.js')]:{fetchCart:()=>assert.fail('Do not load bag into direct checkout')},[path.join(root,'services/addresses.js')]:{fetchAddresses:async()=>[{id:'address',isDefault:true}]},[path.join(root,'services/orders.js')]:{fetchDirectCheckout:async(item,addressId)=>{calls.push({item,addressId});return {cart,quote:addressId?quote:null};}}});
 l.load('stores/direct-checkout.js').beginDirectCheckout(selection);l.load('pages/checkout/index.js');const p=l.page;p.data=structuredClone(p.data);p.setData=v=>Object.assign(p.data,v);p.onLoad({mode:'direct'});await p.loadCheckout();
 assert.equal(p.data.cart.itemCount,5);assert.equal(p.data.quote.payableAmountCents,31800);assert.equal(calls.length,2);assert.equal(calls[1].addressId,'address');assert.equal(calls[1].item.style,'upgraded');
});
test('guest login resumes direct checkout and leaves the original selection intact',()=>{
 const s=session(''),urls=[],l=createLoader({switchTab:v=>urls.push(v.url)},{[path.join(root,'stores/session.js')]:s.module});const draft=l.load('stores/direct-checkout.js').beginDirectCheckout(selection);
 l.load('pages/checkout/index.js');const p=l.page;p.data=structuredClone(p.data);p.setData=v=>Object.assign(p.data,v);p.onLoad({mode:'direct'});p.onShow();
 assert.equal(urls[0],'/pages/account/index');assert.equal(l.load('stores/navigation.js').consumeMemberLoginReturn(),'/pages/checkout/index?mode=direct');assert.equal(l.load('stores/direct-checkout.js').readDirectCheckout().requestId,draft.requestId);
});
test('uncertain direct order submission keeps the request id and disables resubmission',async()=>{
 const s=session(),l=createLoader({},{[path.join(root,'stores/session.js')]:s.module,[path.join(root,'services/orders.js')]:{createDirectOrder:async()=>{const e=Error('network');e.code='NETWORK_REQUEST_FAILED';throw e;}}});
 const store=l.load('stores/direct-checkout.js'),draft=store.beginDirectCheckout(selection);l.load('pages/checkout/index.js');const p=l.page;p.data=structuredClone(p.data);p.setData=v=>Object.assign(p.data,v);p.loadCheckout=async()=>{};p.directDraft=draft;p.setData({directMode:true,loading:false,checkoutEnabled:true,address:{id:'address'},quote:{payableAmountCents:31800}});await p.submitOrder();
 assert.equal(p.data.submissionUncertain,true);assert.equal(store.readDirectCheckout().requestId,draft.requestId);
});

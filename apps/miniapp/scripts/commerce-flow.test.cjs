const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
function page(l,file){l.load(file);const p=l.page;p.data=structuredClone(p.data);p.setData=x=>Object.assign(p.data,x);return p;}
const event=dataset=>({currentTarget:{dataset}});

test('last-item decrement asks once; cancellation preserves the cart',async()=>{
 let decide,dialogs=0,writes=0;
 const l=createLoader({showModal:()=>{dialogs++;return new Promise(r=>decide=r);}});
 const p=page(l,'pages/cart/index.js');p.data.loading=false;p.applyQuantity=async()=>writes++;
 p.changeQuantity(event({id:'one',quantity:1,delta:-1}));p.changeQuantity(event({id:'one',quantity:1,delta:-1}));
 assert.equal(dialogs,1);assert.equal(writes,0);decide({confirm:false});await new Promise(setImmediate);assert.equal(writes,0);
 p.changeQuantity(event({id:'one',quantity:1,delta:-1}));decide({confirm:true});await new Promise(setImmediate);assert.equal(writes,1);assert.equal(p.removalPending,false);
});

test('cart editing and checkout wait for quantity updates and unresolved guest sync',()=>{
 const routes=[];const l=createLoader({navigateTo:o=>routes.push(o.url),switchTab:o=>routes.push(o.url)}, {[path.join(root,'stores/session.js')]:{hasSession:()=>true}});
 const p=page(l,'pages/cart/index.js');p.setData({loading:false,cart:{items:[{id:'one'}]},updatingItemId:'one'});
 p.editVariant(event({slug:'x',id:'one'}));p.goCheckout();assert.equal(routes.length,0);
 p.setData({updatingItemId:'',syncBlocked:true});p.editVariant(event({slug:'x',id:'one'}));p.goCheckout();assert.equal(routes.length,0);
 p.setData({syncBlocked:false});p.goCheckout();assert.equal(routes.length,1);
});

test('cart checkout resumes after explicit login and successful guest sync only once',async()=>{
 let signedIn=false,failSync=false;const routes=[];
 const l=createLoader({switchTab:o=>routes.push(o.url),navigateTo:o=>routes.push(o.url),pageScrollTo(){},showToast(){}},{
  [path.join(root,'stores/session.js')]:{hasSession:()=>signedIn},
  [path.join(root,'services/auth.js')]:{getCachedUser:()=>null,loginWithWeChat:async()=>{signedIn=true;return {name:'test'};}},
  [path.join(root,'services/guest-sync.js')]:{syncGuestCart:async()=>{if(failSync)throw Error('CART_SYNC_PENDING');}}
 });
 const cart=page(l,'pages/cart/index.js');cart.setData({loading:false,cart:{items:[{id:'one'}],guest:true}});cart.goCheckout();assert.equal(routes[0],'/pages/account/index');
 const account=page(l,'pages/account/index.js');account.onShow();assert.equal(account.data.loginOpen,true);assert.match(account.data.loginReturnHint,/结算/);assert.equal(account.data.consented,false);
 account.setData({consented:true,crossBorderConsented:true});failSync=true;await account.signIn();assert.equal(routes.length,1);assert.match(account.data.error,/尚未同步/);
 failSync=false;await account.signIn();assert.equal(routes.at(-1),'/pages/checkout/index');const count=routes.length;account.finishMemberLogin();assert.equal(routes.length,count);
});

test('empty checkout skips quote and cannot submit an order',async()=>{
 let quotes=0,orders=0;
 const l=createLoader({getStorageSync:()=>null},{
  [path.join(root,'services/cart.js')]:{fetchCart:async()=>({items:[]})},
  [path.join(root,'services/addresses.js')]:{fetchAddresses:async()=>[{id:'a'}]},
  [path.join(root,'services/orders.js')]:{fetchOrderQuote:async()=>{quotes++;throw Error('CART_EMPTY');},createOrder:async()=>orders++}
 });
 const p=page(l,'pages/checkout/index.js');await p.loadCheckout();await p.submitOrder();assert.equal(quotes,0);assert.equal(orders,0);assert.equal(p.data.error,'');assert.equal(p.data.loading,false);assert.equal(p.data.quote,null);
});

test('checkout wallet, claims, and points have distinct destinations; uncertain order locks edits',()=>{
 const routes=[];const l=createLoader({navigateTo:o=>routes.push(o.url),switchTab:o=>routes.push(o.url)});const p=page(l,'pages/checkout/index.js');
 for(const section of ['wallet','claim','points'])p.openMember(event({section}));
 assert.deepEqual(routes,['/pages/member/index?section=wallet&from=checkout','/pages/member/index?section=claim&from=checkout','/pages/member/index?section=points&from=checkout']);
 p.setData({submissionUncertain:true});p.openMember(event({section:'wallet'}));p.chooseAddress();p.editBag();assert.equal(routes.length,3);
});

test('checkout reload cannot replace the confirmed amount while order creation is pending',async()=>{
 let calls=0;const l=createLoader({}, {[path.join(root,'services/cart.js')]:{fetchCart:async()=>{calls++;return {items:[]};}}});const p=page(l,'pages/checkout/index.js');p.setData({submitting:true,quote:{payableAmountCents:4900}});
 await p.loadCheckout();assert.equal(calls,0);assert.equal(p.data.quote.payableAmountCents,4900);
});

test('checkout login return cannot be replaced by an arbitrary external route',()=>{
 const l=createLoader(),nav=l.load('stores/navigation.js');nav.rememberCheckoutLoginReturn();nav.rememberMemberLoginReturn('https://example.com');assert.equal(nav.consumeMemberLoginReturn(),'/pages/checkout/index');assert.equal(nav.consumeMemberLoginReturn(),'');
});


test('cart variant edit opens selection directly and preserves the current style and size',()=>{
 const routes=[];const l=createLoader({navigateTo:o=>routes.push(o.url)});const p=page(l,'pages/cart/index.js');p.setData({loading:false,cart:{guest:false}});
 p.editVariant(event({slug:'x1-air-white',id:'one',style:'upgraded',size:'S',color:'白色',quantity:2}));
 const query=new URL(routes[0],'https://test.invalid').searchParams;
 assert.equal(query.get('section'),'purchase');assert.equal(query.get('style'),'upgraded');assert.equal(query.get('size'),'S');assert.equal(query.get('quantity'),'2');assert.equal(query.get('cartItemId'),'one');
});


test('encoded cart color preserves the selected size instead of falling back to M',async()=>{
 const product={slug:'x1-air-white',sizes:['S','M','L'],colors:['白色'],isPurchasable:true,quantityPricing:{maxQuantity:4,styles:[{key:'regular',label:'常规款',unitPriceCents:4900,tiers:[]}]},variants:['S','M','L'].map(size=>({size,color:'白色',priceCents:4900,availableQuantity:10,soldOut:false}))};
 const l=createLoader({}, {[path.join(root,'services/catalog.js')]:{fetchProductBySlug:async()=>product}});const p=page(l,'pages/product-detail/index.js');p.loadGuide=()=>{};p.measureSections=()=>{};
 p.onLoad({slug:'x1-air-white',cartItemId:'one',size:'S',color:encodeURIComponent('白色'),style:'regular',quantity:'2',section:'purchase'});await new Promise(setImmediate);
 assert.equal(p.data.error,'');assert.equal(p.data.selectedSize,'S');assert.equal(p.data.selectedColor,'白色');assert.equal(p.data.quantity,2);assert.equal(p.data.specOpen,true);p.onUnload();
});

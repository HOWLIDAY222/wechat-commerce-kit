const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
const prices=(a,b,c)=>[{quantity:2,totalPriceCents:a},{quantity:3,totalPriceCents:b},{quantity:4,totalPriceCents:c}];
function product(stock=99){return {slug:'x1-air-white',name:'X1',isPurchasable:true,minPriceCents:4900,colors:['白色'],sizes:['S','M'],quantityPricing:{maxQuantity:99,repeatBundles:true,tiers:prices(8900,12900,16900),styles:[{key:'regular',label:'常规款',unitPriceCents:4900,tiers:prices(8900,12900,16900)},{key:'upgraded',label:'升级款',unitPriceCents:6900,tiers:prices(12900,18900,24900)}]},variants:['S','M'].map(size=>({size,color:'白色',priceCents:4900,availableQuantity:stock,soldOut:false}))};}
const event=(dataset)=>({currentTarget:{dataset}});
test('quantity above four uses existing tiers, keeps four quick picks, and clamps to stock',()=>{
 const l=createLoader(),select=l.load('utils/selection.js').selectionState,p=product();
 for(const [style,totals] of [['regular',['¥218','¥258','¥298','¥338']],['upgraded',['¥318','¥378','¥438','¥498']]])for(let q=5;q<=8;q++){const s=select(p,'M','白色',q,style);assert.equal(s.quantity,q);assert.equal(s.totalLabel,totals[q-5]);assert.equal(s.packs.length,4);}
 assert.equal(select(product(6),'M','白色',8,'regular').quantity,6);
});
test('product stepper and typed quantity keep price and style in sync',()=>{
 const l=createLoader();l.load('pages/product-detail/index.js');const page=l.page;page.setData=x=>Object.assign(page.data,x);page.setData({product:product(),selectedSize:'M',selectedColor:'白色',selectedStyle:'regular',quantity:4});page.refreshSelection();
 page.changeQuantity(event({delta:1}));assert.equal(page.data.quantity,5);assert.equal(page.data.totalLabel,'¥218');
 page.chooseStyle(event({style:'upgraded'}));assert.equal(page.data.quantity,5);assert.equal(page.data.totalLabel,'¥318');
 page.inputQuantity({detail:{value:'8'}});assert.equal(page.data.totalLabel,'¥498');
 page.inputQuantity({detail:{value:'bad'}});assert.equal(page.data.quantity,1);page.onUnload();
});
test('guest bag sums mixed sizes, separates styles, and rejects shared stock without partial writes',async()=>{
 const store=new Map(),p=product(30),l=createLoader({getStorageSync:k=>store.get(k),setStorageSync:(k,v)=>store.set(k,v),removeStorageSync:k=>store.delete(k),setTabBarBadge(){},removeTabBarBadge(){}},{[path.join(root,'services/catalog.js')]:{fetchProducts:async()=>[p]}}),bag=l.load('services/guest-cart.js');
 await bag.writeGuestItem({productSlug:p.slug,color:'白色',size:'M',quantity:3,style:'regular'});let cart=await bag.writeGuestItem({productSlug:p.slug,color:'白色',size:'S',quantity:2,style:'regular'});assert.equal(cart.subtotalCents,21800);
 cart=await bag.writeGuestItem({productSlug:p.slug,color:'白色',size:'M',quantity:5,style:'upgraded'});assert.equal(cart.subtotalCents,53600);assert.equal(cart.items.find(i=>i.style==='regular'&&i.size==='M').quantityLimit,25);
 const id=cart.items.find(i=>i.style==='regular'&&i.size==='S').id;cart=await bag.updateGuestQuantity(id,3);assert.equal(cart.subtotalCents,57600);
 await assert.rejects(bag.updateGuestQuantity(cart.items.find(i=>i.style==='upgraded').id,28),/INSUFFICIENT_INVENTORY/);assert.equal(bag.readGuestItems().find(i=>i.style==='upgraded').quantity,5);
});
test('editing logged-in bag sends original quantity for stale-change protection',async()=>{
 let sent;const l=createLoader({nextTick:fn=>fn(),showToast(){}},{[path.join(root,'stores/session.js')]:{hasSession:()=>true},[path.join(root,'services/cart.js')]:{replaceCartItemVariant:async(id,input)=>{sent=input;}}});l.load('pages/product-detail/index.js');const page=l.page;page.setData=x=>Object.assign(page.data,x);page.slug='x1-air-white';page.cartItemId='qa';page.initialQuantity=2;page.setData({product:product(),selectedStyle:'regular',selectedSize:'M',selectedColor:'白色',quantity:5});page.refreshSelection();l.load('pages/product-detail/index.js');
 await page.addToCart();assert.equal(sent.quantity,5);assert.equal(sent.expectedQuantity,2);page.onUnload();
});

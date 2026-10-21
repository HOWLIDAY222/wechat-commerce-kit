const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
function page(loader,file){loader.load(file);const p=loader.page;p.data=structuredClone(p.data);p.setData=v=>Object.assign(p.data,v);return p;}
const event=dataset=>({currentTarget:{dataset}});

test('social login returns preserve supported activity tabs without accepting extra callback fields',()=>{
  const nav=createLoader().load('stores/navigation.js');
  for(const tab of ['follow','share','history','interaction','repost']) {const route='/pages/member-community/index?tab='+tab;nav.rememberMemberLoginReturn(route);assert.equal(nav.consumeMemberLoginReturn(),route);}
  for(const route of ['/pages/member-community/index?tab=unknown','/pages/member-community/index?tab=repost&next=https://evil.invalid','/pages/member-community/index?tab=interaction/../account']) {nav.rememberMemberLoginReturn(route);assert.equal(nav.consumeMemberLoginReturn(),'');}
});

test('home introduction stays on home, while explicit purchase and CMS links keep their destinations',()=>{
  const calls=[],scrolls=[];const loader=createLoader({navigateTo:v=>{calls.push(v.url);v.complete?.();},switchTab:v=>calls.push(v.url),showToast:v=>calls.push(v.title),pageScrollTo:v=>scrolls.push(v.selector)});
  const p=page(loader,'pages/home/home.js');const link={pageKey:'shop'};
  p.data.product={slug:'x1-air-white'};p.data.introductionAnchor='home-section-1';
  p.data.sections=[{id:'hero',type:'hero'},{id:'details',type:'contentGrid',layout:'detailPair'},{id:'purchase',type:'productGrid',products:[{slug:'another-product'}]}];
  for(const section of ['hero','details','purchase'])p.openLink(event({section,link}));
  assert.deepEqual(scrolls,['#home-section-1','#home-section-1']);
  assert.deepEqual(calls,['/pages/product-detail/index?slug=another-product&section=purchase']);
  p.openPurchase(event({}));assert.equal(calls.at(-1),'/pages/product-detail/index?slug=x1-air-white&section=purchase');
  p.openLink(event({section:'hero',link:{pageKey:'contact'}}));assert.equal(calls.at(-1),'/pages/contact/index');
  p.openLink(event({section:'hero',link:{pageKey:'shop',query:'q=white'}}));assert.equal(calls.at(-1),'/pages/products/index');
  p.data.product=null;p.openPurchase(event({}));assert.equal(calls.at(-1),'商品正在加载，请稍后重试');
});

test('search intent reaches the existing product tab once, while all-products clears the search',()=>{
  const calls=[];const loader=createLoader({switchTab:v=>calls.push(v.url),nextTick:fn=>fn()});
  const home=page(loader,'pages/home/home.js');home.openSearch();
  const products=page(loader,'pages/products/index.js');products.data.products=[{name:'White',colors:[],sizes:[]},{name:'Black',colors:[],sizes:[]}];
  products.onShow();assert.equal(products.data.searchFocused,true);assert.equal(products.data.visibleProducts.length,2);
  products.onSearch({detail:{value:'Black'}});assert.equal(products.data.visibleProducts.length,1);
  home.openProducts();products.onShow();
  assert.equal(products.data.query,'');assert.equal(products.data.searchFocused,false);assert.equal(products.data.visibleProducts.length,2);
  products.onSearch({detail:{value:'White'}});products.onShow();assert.equal(products.data.query,'White');
  const content=page(loader,'pages/content/index.js');content.goShopping();products.onShow();assert.equal(products.data.query,'');
  assert.deepEqual(calls,['/pages/products/index','/pages/products/index','/pages/products/index']);
});

test('product links carry an allowlisted section and never accept path injection',()=>{
  const urls=[];const l=createLoader({navigateTo:v=>{urls.push(v.url);v.complete?.();}});const nav=l.load('utils/navigation.js');
  nav.navigateToManagedPage({pageKey:'shop',query:'slug=x1-air-white&section=purchase'});
  assert.equal(urls[0],'/pages/product-detail/index?slug=x1-air-white&section=purchase');
  assert.equal(nav.navigateToProduct('../account'),false);assert.equal(urls.length,1);
  nav.navigateToProduct('x1-air-white','../../account');assert.equal(urls[1],'/pages/product-detail/index?slug=x1-air-white');
  nav.navigateToManagedPage('about');assert.equal(urls.at(-1),'/pages/content/index?pageKey=about');
  assert.equal(nav.parseShopQuery('q=%XX&focus=1').focus,'1');
});

test('detail and purchase entry apply only once without changing selected size or quantity',()=>{
  const scrolled=[];const loader=createLoader({pageScrollTo:v=>scrolled.push(v.selector),nextTick:fn=>fn()});const p=page(loader,'pages/product-detail/index.js');
  p.setData({selectedSize:'L',quantity:2,detailsOpen:false});p.entrySection='details';p.applyEntry();
  assert.equal(p.data.detailsOpen,true);assert.deepEqual(scrolled,['#product-details']);p.applyEntry();assert.equal(scrolled.length,1);
  p.entrySection='purchase';p.applyEntry();assert.equal(p.data.specOpen,true);assert.equal(p.data.selectedSize,'L');assert.equal(p.data.quantity,2);
});

test('wallet login returns to coupons without preselecting consent',async()=>{
  let signedIn=false;const routes=[];const loader=createLoader({switchTab:v=>routes.push(v.url),navigateTo:v=>routes.push(v.url),pageScrollTo(){},showToast(){}},{
    [path.join(root,'stores/session.js')]:{hasSession:()=>signedIn},
    [path.join(root,'services/auth.js')]:{getCachedUser:()=>null,loginWithWeChat:async()=>{signedIn=true;return {name:'test'};}},
    [path.join(root,'services/guest-sync.js')]:{syncGuestCart:async()=>{}},
  });
  const member=page(loader,'pages/member/index.js');member.onLoad({section:'wallet'});await member.loadMember();assert.equal(member.data.walletOnly,true);
  const account=page(loader,'pages/account/index.js');account.onShow();assert.equal(account.data.loginOpen,true);assert.equal(account.data.consented,false);assert.equal(account.data.crossBorderConsented,false);
  assert.deepEqual(routes,['/pages/account/index']);await account.signIn();assert.equal(signedIn,false);
  account.setData({consented:true,crossBorderConsented:true});await account.signIn();assert.equal(routes.at(-1),'/pages/member/index?section=wallet');
  const count=routes.length;account.finishMemberLogin();assert.equal(routes.length,count);
});

test('editorial fallback purchase action is omitted when the published document already has one',()=>{
  const loader=createLoader();const p=page(loader,'pages/content/index.js');p.onLoad({pageKey:'about'});
  p.applyPage({key:'about',document:{sections:[{id:'cta',type:'hero',action:{pageKey:'shop',label:'Shop'}}]}});
  assert.equal(p.data.showShoppingAction,false);assert.equal(p.data.actions.length,1);
  p.applyPage({key:'about',document:{sections:[]}});assert.equal(p.data.showShoppingAction,true);
});

test('mobile content and compact cart use smaller public images while zoom and private media keep their boundaries',()=>{
  const l=createLoader();const sections=l.load('models/content.js').toNativeContentSections({key:'home',assets:{a:{url:'/_next/image?url=%2Fassets%2Fcampaign%2Fa.JPG&w=1080&q=75'}},document:{sections:[{id:'s',mediaAssetId:'a',items:[{id:'i',mediaAssetId:'a'}]}]}});
  assert.match(sections[0].imageUrl,/w=750/);assert.match(sections[0].items[0].imageUrl,/w=384/);
  const urls=l.load('utils/url.js');assert.equal(urls.resolveContentImage('https://other.example/a.jpg',384),'https://other.example/a.jpg');
  assert.equal(urls.resolveContentImage('/_next/image?url=%2Fuploads%2Fprivate.jpg&w=1080&q=75',384),'https://example.invalid/_next/image?url=%2Fuploads%2Fprivate.jpg&w=1080&q=75');
  const cart=l.load('models/cart.js').normalizeCart({items:[{productImage:'/assets/catalog/a.jpg',unitPriceCents:100,quantity:1}]});assert.match(cart.items[0].productImage,/w=256/);
  const p=l.load('models/product.js').normalizeProduct({image:'/assets/catalog/a.jpg',images:['/assets/catalog/a.jpg'],variants:[]});let preview;
  const detail=page(createLoader({previewImage:v=>preview=v}),'pages/product-detail/index.js');detail.data.product=p;detail.previewImage(event({src:p.images[0]}));assert.match(preview.current,/w=1080/);
});

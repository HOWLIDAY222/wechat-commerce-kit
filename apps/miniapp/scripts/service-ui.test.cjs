const test=require('node:test'),assert=require('node:assert/strict');
const {createLoader}=require('./test-loader.cjs');

test('prepared gallery photos use their existing mobile files without a second optimizer',()=>{
 const l=createLoader(),resolve=l.load('utils/url.js').resolveProductImage;
 assert.equal(resolve('/assets/catalog/x1-air-white/vk-20261014/product-front-1080.webp'),'https://example.invalid/assets/catalog/x1-air-white/vk-20261014/product-front-750.webp');
 assert.match(resolve('/assets/catalog/x1-air-white/vk-20261014/product-front-1080.webp',256),/_next\/image\?/);
 assert.equal(resolve('/uploads/private.jpg'),'https://example.invalid/uploads/private.jpg');
});

test('product details return to their entry layer and keep selected style, size and quantity',()=>{
 const l=createLoader();l.load('pages/product-detail/index.js');const p=l.page;
 p.data=structuredClone(p.data);p.setData=x=>Object.assign(p.data,x);
 p.setData({product:{slug:'x1-air-white'},selectedStyle:'upgraded',selectedSize:'L',quantity:8});
 p.openProductDetails();assert.equal(p.data.detailSheetOpen,true);assert.equal(p.data.specOpen,false);
 p.closeProductDetails();assert.equal(p.data.detailSheetOpen,false);assert.equal(p.data.specOpen,false);
 p.openSpecs();p.openProductDetails();assert.equal(p.data.specOpen,false);p.closeProductDetails();assert.equal(p.data.specOpen,true);
 assert.equal(p.data.selectedStyle,'upgraded');assert.equal(p.data.selectedSize,'L');assert.equal(p.data.quantity,8);
 p.openProductDetails();p.shopFromDetails();assert.equal(p.data.detailSheetOpen,false);assert.equal(p.data.specOpen,true);p.onUnload();
});

test('offline detail copy is present while upgraded gusset claims stay out of regular selection',()=>{
 const l=createLoader(),model=l.load('models/product-detail-media.js');
 const regular=model.detailMediaForStyle({slug:'x1-air-white'},'regular').detailSections;
 const upgraded=model.detailMediaForStyle({slug:'x1-air-white'},'upgraded').detailSections;
 assert.equal(regular.length,5);assert.equal(upgraded.length,6);
 assert.equal(/莫代尔|新疆柔棉/.test(regular.map(x=>x.body).join('')),false);
 assert.match(upgraded[5].body,/仅适用于升级款裆部/);
 assert.equal(model.detailMediaForStyle({slug:'another-product'},'upgraded').detailSections.length,0);
 const updated=model.detailMediaForStyle({slug:'x1-air-white',detailMedia:[{id:'waist-embossing',style:'all',detail:{...regular[0],body:'已发布的新腰头说明'}}]},'regular');
 assert.equal(updated.detailSections[0].body,'已发布的新腰头说明');
});

test('customer service passes a public product card and excludes unrelated personal data',()=>{
 const l=createLoader(),context=l.load('utils/customer-service.js').customerServiceContext;
 const result=context({scene:'product',slug:'x1-air-white',styleKey:'upgraded',productName:'X1 Air',image:'/assets/catalog/x1.webp',phone:'13900000007',token:'secret',address:'private'});
 assert.equal(result.showMessageCard,true);assert.equal(result.messagePath,'pages/product-detail/index?slug=x1-air-white&style=upgraded');
 assert.deepEqual(JSON.parse(result.sessionFrom),{scene:'product',slug:'x1-air-white',style:'upgraded'});
 assert.equal(/13900000007|secret|private/.test(JSON.stringify(result)),false);
 const invalid=context({scene:'product',slug:'../admin?token=secret',image:'https://unrelated.example/portrait.jpg'});
 assert.equal(invalid.showMessageCard,false);assert.equal(invalid.messageImage,'');assert.equal(invalid.messagePath,'pages/home/home');
 const order=context({scene:'order',orderNo:'QA_ORDER_123',image:'/uploads/private.jpg'});
 assert.equal(order.showMessageCard,false);assert.equal(order.messageImage,'');assert.equal(order.messagePath.includes('QA_ORDER'),false);
});

test('guest order help resumes the chosen destination after login and failures reveal email fallback',()=>{
 let route;const l=createLoader({getStorageSync:()=>null,switchTab:x=>route=x.url,navigateTo:x=>route=x.url});
 l.load('pages/contact/index.js');const p=l.page;p.data=structuredClone(p.data);p.setData=x=>Object.assign(p.data,x);
 p.openAfterSales();assert.equal(route,'/pages/account/index');
 const nav=l.load('stores/navigation.js');assert.equal(nav.consumeMemberLoginReturn(),'/pages/after-sales/index');
 nav.rememberServiceLoginReturn('https://unrelated.example');assert.equal(nav.consumeMemberLoginReturn(),'');
 p.serviceError();assert.equal(p.data.moreOpen,true);assert.equal(p.data.serviceUnavailable,true);
 p.openTopic({currentTarget:{dataset:{key:'shipping-policy'}}});assert.equal(route,'/pages/content/index?pageKey=shipping-policy');
 p.openTopic({currentTarget:{dataset:{key:'admin'}}});assert.equal(route,'/pages/content/index?pageKey=shipping-policy');
});

test('native contact failure opens email help from the product and cannot loop on the help page',()=>{
 let route,events=0;const l=createLoader({navigateTo:x=>route=x.url,showToast(){}});
 l.load('components/service-contact/index.js');const definition=l.component;
 const c={properties:{mode:'primary'},data:{},setData:x=>Object.assign(c.data,x),triggerEvent:()=>events++,...definition.methods};
 c.openHelp();assert.equal(route,undefined);assert.equal(c.data.unavailable,true);assert.equal(events,1);
 c.properties.mode='toolbar';c.contactError();assert.equal(route,'/pages/contact/index?email=1');
});

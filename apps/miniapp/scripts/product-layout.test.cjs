const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
const event=section=>({currentTarget:{dataset:{section}}});

test('section navigation accounts for both sticky bars and scrolling updates active section',()=>{
 const l=createLoader(),nav=l.load('utils/product-navigation.js');
 const positions={overview:180,size:1100,details:1600};
 assert.equal(nav.activeProductSection(positions,0,150),'overview');
 assert.equal(nav.activeProductSection(positions,960,150),'size');
 assert.equal(nav.activeProductSection(positions,1460,150),'details');
 assert.equal(nav.activeProductSection(positions,100,150),'overview');
 assert.equal(nav.sectionScrollTop(600,500,150),952);
 assert.equal(nav.sectionScrollTop(10,0,150),0);
});

test('actual page navigation offsets target, ignores invalid destinations and preserves selection',()=>{
 const calls=[];let selectors=[],batch=[];
 const l=createLoader({nextTick:fn=>fn(),pageScrollTo:v=>calls.push(v),createSelectorQuery:()=>({select:s=>{selectors.push(s);return {boundingClientRect:()=>{batch.push(s==='.product-nav'?{height:50}:{top:600});}};},selectViewport:()=>({scrollOffset:()=>batch.push({scrollTop:500})}),exec:cb=>{const result=batch;batch=[];cb(result);}})});
 l.load('pages/product-detail/index.js');const p=l.page;p.setData=x=>Object.assign(p.data,x);p.setData({headerHeight:100,selectedSize:'L',quantity:4,detailsOpen:false});
 p.jumpToSection(event('details'));assert.equal(calls[0].scrollTop,952);assert.equal(p.data.detailsOpen,true);assert.equal(p.data.activeSection,'details');assert.equal(p.data.selectedSize,'L');assert.equal(p.data.quantity,4);
 p.jumpToSection(event('../../account'));assert.equal(calls.length,1);p.navScrolling=false;p.sectionPositions={overview:180,size:1100,details:1600};p.stickyHeight=150;p.onPageScroll({scrollTop:960});assert.equal(p.data.activeSection,'size');p.onUnload();
});

test('immersive section navigation occupies no initial space and follows the measured introduction after image height changes',()=>{
 let intro=350,scroll=0,batch=[];
 const l=createLoader({createSelectorQuery:()=>({select:selector=>({boundingClientRect:()=>batch.push(selector==='.product-nav'?null:{top:({'#product-overview':0,'#product-size':1100,'#product-details':1600,'#product-intro':intro}[selector]||0)-scroll})}),selectViewport:()=>({scrollOffset:()=>batch.push({scrollTop:scroll})}),exec:callback=>{const result=batch;batch=[];callback(result);}})});
 l.load('pages/product-detail/index.js');const p=l.page;p.data=structuredClone(p.data);p.setData=v=>Object.assign(p.data,v);p.setData({product:{slug:'x1-air-white'},headerHeight:64});
 p.measureSections();assert.equal(p.data.sectionNavVisible,false);assert.equal(p.stickyHeight,0);assert.equal(p.sectionPositions.overview,0);
 scroll=300;p.onPageScroll({scrollTop:scroll});assert.equal(p.data.sectionNavVisible,true);assert.equal(p.stickyHeight,112);
 intro=850;p.measureSections();assert.equal(p.data.sectionNavVisible,false);assert.equal(p.introTop,850);
 scroll=800;p.onPageScroll({scrollTop:scroll});assert.equal(p.data.sectionNavVisible,true);
 scroll=0;p.onPageScroll({scrollTop:scroll});assert.equal(p.data.sectionNavVisible,false);assert.equal(p.stickyHeight,0);p.onUnload();
});

test('anchors work before the collapsed navigation mounts and the product tab returns precisely to the media origin',()=>{
 const calls=[];let batch=[];
 const l=createLoader({nextTick:fn=>fn(),pageScrollTo:v=>calls.push(v),createSelectorQuery:()=>({select:selector=>({boundingClientRect:()=>batch.push(selector==='.product-nav'?null:{top:600})}),selectViewport:()=>({scrollOffset:()=>batch.push({scrollTop:500})}),exec:callback=>{const result=batch;batch=[];callback(result);}})});
 l.load('pages/product-detail/index.js');const p=l.page;p.data=structuredClone(p.data);p.setData=v=>Object.assign(p.data,v);p.setData({headerHeight:64,selectedSize:'L',quantity:5});
 p.jumpToSection(event('details'));assert.equal(calls[0].scrollTop,990);assert.equal(p.data.activeSection,'details');
 p.setData({sectionNavVisible:true});p.jumpToSection(event('overview'));assert.equal(calls[1].scrollTop,0);assert.equal(p.data.sectionNavVisible,false);assert.equal(p.data.selectedSize,'L');assert.equal(p.data.quantity,5);p.onUnload();
});

test('floating return aligns with the native capsule while video and photo status text changes stay local to this page',()=>{
 const colors=[],routes=[],l=createLoader({getWindowInfo:()=>({statusBarHeight:44}),getMenuButtonBoundingClientRect:()=>({top:52,height:32}),setNavigationBarColor:v=>colors.push(v.frontColor),navigateBack:v=>v.fail(),switchTab:v=>routes.push(v.url)});
 l.load('pages/product-detail/index.js');const p=l.page;p.data=structuredClone(p.data);p.setData=v=>Object.assign(p.data,v);
 p.setData({product:{slug:'x1-air-white'},galleryMedia:[{type:'video'},{type:'image',source:'photo.webp'}]});p.updateHeaderHeight();
 assert.equal(p.data.headerHeight,92);assert.equal(p.data.backTop,46);assert.equal(colors.at(-1),'#ffffff');
 p.chooseImage({currentTarget:{dataset:{index:1}}});assert.equal(colors.at(-1),'#000000');p.goBack();assert.equal(routes[0],'/pages/home/home');
 p.setData({isTimelinePreview:true});const count=colors.length;p.updateHeaderHeight();p.goBack();assert.equal(p.data.headerHeight,0);assert.equal(colors.length,count);assert.equal(routes.length,1);p.onUnload();
});

test('published guide never invents measurements; hidden and unrelated tables are ignored',()=>{
 const model=createLoader().load('models/size-guide.js');
 const page={document:{sections:[{id:'tips',items:[{id:'waist',title:'腰围',body:'在腰头位置水平测量。'}]},{id:'hidden',visible:false,items:[{table:{headers:['尺码','腰围'],rows:[['M','fake']]}}]}]}};
 const first=model.sizeGuideView(page,'M');assert.equal(first.sizeMeasurements.length,0);assert.equal(first.guideTips[0].body,'在腰头位置水平测量。');
 page.document.sections.push({id:'measure',items:[{id:'table',table:{headers:['尺码','腰围/cm','臀围/cm'],rows:[['S','merchant-S','hip-S'],['M','merchant-M','hip-M']]}}]});
 assert.equal(model.sizeGuideView(page,'M').sizeMeasurements[0].value,'merchant-M');assert.equal(model.sizeGuideView(page,'S').sizeMeasurements[1].value,'hip-S');assert.equal(model.sizeGuideView(page,'L').sizeMeasurements.length,0);
});

test('guide fetch does not block product loading or replace latest selected size',async()=>{
 let resolveGuide;const product={slug:'x',sizes:['S','M'],quantityPricing:{maxQuantity:4},variants:[{size:'M',color:'白色',availableQuantity:10,priceCents:4900}]};
 const l=createLoader({}, {[path.join(root,'services/catalog.js')]:{fetchProductBySlug:async()=>product},[path.join(root,'services/content.js')]:{fetchPublishedPage:()=>new Promise(r=>resolveGuide=r)}});
 l.load('pages/product-detail/index.js');const p=l.page;p.setData=x=>Object.assign(p.data,x);p.slug='x';p.initialQuantity=1;await p.load();assert.equal(p.data.loading,false);assert.equal(p.data.guideLoading,true);p.setData({selectedSize:'S',quantity:3});
 resolveGuide({document:{sections:[{id:'s',items:[{id:'t',table:{headers:['尺码','腰围'],rows:[['S','merchant-S'],['M','merchant-M']]}}]}]}});
 await new Promise(setImmediate);assert.equal(p.data.sizeMeasurements[0].value,'merchant-S');assert.equal(p.data.quantity,3);p.onUnload();
});

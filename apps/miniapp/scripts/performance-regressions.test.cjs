const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
const tick=()=>new Promise(setImmediate);
function page(file,wx={},overrides={}){
 const l=createLoader(wx,Object.fromEntries(Object.entries(overrides).map(([file,value])=>[path.join(root,file),value])));
 l.load(file);const p=l.page;p.data=structuredClone(p.data);p.patches=[];
 p.setData=value=>{p.patches.push(value);Object.assign(p.data,value);};return p;
}
test('six rapid product taps start one native transition, completion permits a new action',()=>{
 const calls=[],l=createLoader({navigateTo:o=>calls.push(o)}),nav=l.load('utils/navigation.js');
 for(let i=0;i<6;i++)assert.equal(nav.navigateToProduct('x1-air-white'),true);
 assert.equal(calls.length,1);calls[0].complete();nav.navigateToProduct('x1-air-white','purchase');
 assert.equal(calls.length,2);assert.match(calls[1].url,/section=purchase$/);
 calls[0].complete();nav.navigateToProduct('another-product');assert.equal(calls.length,2);
 calls[1].complete();nav.navigateToProduct('another-product');assert.equal(calls.length,3);
});
test('native route failure provides feedback and permits retry without a stranded lock',()=>{
 const calls=[],messages=[],nav=createLoader({navigateTo:o=>calls.push(o),showToast:o=>messages.push(o.title)}).load('utils/navigation.js');
 nav.navigateToProduct('x1-air-white');calls[0].fail({errMsg:'navigateTo:fail page limit'});
 assert.equal(messages.length,1);nav.navigateToProduct('x1-air-white');assert.equal(calls.length,2);
 calls[0].complete();nav.navigateToProduct('another-product');assert.equal(calls.length,2);
 calls[1].complete();assert.equal(nav.navigateToProduct('../private'),false);
});
test('home subscription button coalesces taps until its transition completes',()=>{
 const calls=[],p=page('pages/home/home.js',{navigateTo:o=>calls.push(o)});
 for(let i=0;i<6;i++)p.openSubscriptions();assert.equal(calls.length,1);
 assert.equal(calls[0].url,'/pages/subscriptions/index');calls[0].complete();p.openSubscriptions();assert.equal(calls.length,2);
});
test('catalog cards coalesce taps without losing purchase intent',()=>{
 const calls=[],p=page('pages/products/index.js',{navigateTo:o=>calls.push(o)}),event={currentTarget:{dataset:{slug:'x1-air-white'}}};
 for(let i=0;i<6;i++)p.openPurchase(event);assert.equal(calls.length,1);assert.match(calls[0].url,/section=purchase$/);
 calls[0].complete();p.openProduct(event);assert.equal(calls.length,2);assert.doesNotMatch(calls[1].url,/section=/);
});
test('cart variant link retains private editing intent while repeated taps coalesce',()=>{
 const calls=[],p=page('pages/cart/index.js',{navigateTo:o=>calls.push(o)});
 p.data.loading=false;p.data.cart={guest:true};const event={currentTarget:{dataset:{slug:'x1-air-white',id:'local-item',size:'M',color:'白色',quantity:2,style:'regular'}}};
 for(let i=0;i<6;i++)p.editVariant(event);assert.equal(calls.length,1);assert.match(calls[0].url,/cartItemId=local-item/);assert.match(calls[0].url,/guest=1&section=purchase$/);
});
test('full local storage cannot turn a successful public catalog response into an error',async()=>{
 let requests=0;const l=createLoader({setStorageSync(){throw Error('QUOTA_EXCEEDED');},request:o=>{requests++;o.success({statusCode:200,data:{ok:true,products:[{id:'p',slug:'x1-air-white',images:[],variants:[]}]}});}}),catalog=l.load('services/catalog.js');
 const first=await catalog.fetchProducts();assert.equal(first.length,1);assert.equal(first[0].slug,'x1-air-white');
 assert.equal((await catalog.fetchProducts())[0],first[0]);assert.equal(requests,1);
});
test('full local storage preserves successful page and layout responses in memory',async()=>{
 const calls=[],l=createLoader({setStorageSync(){throw Error('QUOTA_EXCEEDED');},request:o=>{calls.push(o.url);o.success({statusCode:200,data:o.url.includes('/layouts/')?{ok:true,layout:{document:{sections:[]}}}:{ok:true,page:{document:{sections:[{id:'hero'}]}}}});}}),content=l.load('services/content.js');
 const p=await content.fetchPublishedPage('home'),layout=await content.fetchPublishedLayout('header');
 assert.equal((await content.fetchPublishedPage('home')),p);assert.equal(await content.fetchPublishedLayout('header'),layout);assert.equal(calls.length,2);
});
test('public cache changes do not hide invalid live API responses',async()=>{
 const l=createLoader({setStorageSync(){throw Error('QUOTA_EXCEEDED');},request:o=>o.success({statusCode:200,data:{ok:true}})});
 await assert.rejects(l.load('services/catalog.js').fetchProducts(),/INVALID_PRODUCT_RESPONSE/);
 await assert.rejects(l.load('services/content.js').fetchPublishedPage('home'),/INVALID_CONTENT_RESPONSE/);
});
test('foreground returns install one update listener and one ready dialog',()=>{
 const callbacks={check:[],ready:[],failed:[]};let dialogs=0;
 const init=createLoader({canIUse:()=>true,getUpdateManager:()=>({onCheckForUpdate:f=>callbacks.check.push(f),onUpdateReady:f=>callbacks.ready.push(f),onUpdateFailed:f=>callbacks.failed.push(f)}),showModal(){dialogs++;}}).load('common/updateManager.js').default;
 for(let i=0;i<6;i++)init();assert.equal(callbacks.ready.length,1);assert.equal(callbacks.check.length,1);assert.equal(callbacks.failed.length,1);
 callbacks.ready[0]();assert.equal(dialogs,1);
});
test('repeated hero visibility callbacks do not restart playback or its loading state',()=>{
 let plays=0;const p=page('pages/home/home.js',{nextTick:f=>f(),createVideoContext:()=>({play(){plays++;},pause(){}})});
 p.homeVisible=true;p.onCampaignVisibility(true);p.onCampaignVideoReady();const count=p.patches.length;
 p.onCampaignVisibility(true);p.onCampaignVisibility(true);assert.equal(plays,0);assert.equal(p.patches.length,count);assert.equal(p.data.campaignVideoLoading,false);
});
test('leaving and reentering the hero resumes the mounted film once',()=>{
 let plays=0,pauses=0;const p=page('pages/home/home.js',{nextTick:f=>f(),createVideoContext:()=>({play(){plays++;},pause(){pauses++;}})});
 p.homeVisible=true;p.onCampaignVisibility(true);p.onCampaignVideoReady();p.onCampaignVisibility(false);p.onCampaignVisibility(true);p.onCampaignVisibility(true);
 assert.equal(plays,1);assert.equal(pauses,1);p.onCampaignVideoError();p.openCampaignVideo();assert.equal(p.data.campaignVideoFailed,false);
});
test('unchanged cached home return avoids sending the full section tree again',async()=>{
 const products=[{id:'p',slug:'x1-air-white'}],document={document:{sections:[{id:'hero',type:'hero'}]}};
 const p=page('pages/home/home.js',{stopPullDownRefresh(){}},{'services/catalog.js':{fetchProducts:async()=>products},'services/content.js':{fetchPublishedPage:async()=>document,toNativeContentSections:p=>p.document.sections}});
 await p.load();assert.equal(p.data.product.slug,'x1-air-white');p.patches=[];await p.load();assert.equal(p.patches.filter(p=>p.sections).length,0);
});
test('new published home content still replaces the cached presentation',async()=>{
 const products=[{id:'p',slug:'x1-air-white'}];let doc={document:{sections:[{id:'hero',type:'hero',title:'old'}]}};
 const p=page('pages/home/home.js',{stopPullDownRefresh(){}},{'services/catalog.js':{fetchProducts:async()=>products},'services/content.js':{fetchPublishedPage:async()=>doc,toNativeContentSections:p=>p.document.sections}});
 await p.load();doc={document:{sections:[{id:'hero',type:'hero',title:'new'}]}};await p.load(true);assert.equal(p.data.sections[0].title,'new');
});
test('a home response arriving after unload cannot update the destroyed page',async()=>{
 let resolveProducts,resolvePage;
 const p=page('pages/home/home.js',{stopPullDownRefresh(){}},{'services/catalog.js':{fetchProducts:()=>new Promise(r=>resolveProducts=r)},'services/content.js':{fetchPublishedPage:()=>new Promise(r=>resolvePage=r),toNativeContentSections:p=>p.document.sections}});
 const pending=p.load();p.onUnload();const count=p.patches.length;
 resolvePage({document:{sections:[{id:'hero',type:'hero'}]}});await tick();resolveProducts([]);await pending;assert.equal(p.patches.length,count);
});

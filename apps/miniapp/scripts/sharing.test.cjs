const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
const photo='https://example.invalid/_next/image?url=%2Fuploads%2Fphoto.jpg&w=750&q=75';
const product={slug:'x1-air-white',displayName:'X1 Air',image:photo,quantityPricing:{styles:[{key:'regular',label:'常规款'},{key:'upgraded',label:'升级款'}]}};

test('product shares keep only product and allowed style, including when editing a private cart',()=>{
 const l=createLoader();l.load('pages/product-detail/index.js');const p=l.page;p.data.product=product;p.data.selectedStyle='upgraded';p.slug=product.slug;p.cartItemId='private-cart';p.options={cartItemId:'private-cart',phone:'private-phone',token:'private-token',guest:'1',quantity:'99'};
 const friend=p.onShareAppMessage(),timeline=p.onShareTimeline();
 assert.equal(friend.path,'/pages/product-detail/index?slug=x1-air-white&style=upgraded');assert.equal(timeline.query,'slug=x1-air-white&style=upgraded');assert.match(timeline.title,/升级款/);assert.equal(timeline.imageUrl,'https://example.invalid/uploads/photo.jpg');assert.equal(timeline.path,undefined);
 assert.doesNotMatch(JSON.stringify([friend,timeline]),/private-|quantity|guest/);
 p.data.selectedStyle='unlisted&token=bad';assert.equal(p.onShareTimeline().query,'slug=x1-air-white');
});

test('public home and catalog shares discard inherited query and catalog search',()=>{
 for(const file of ['pages/home/home.js','pages/products/index.js']){
  const l=createLoader();l.load(file);const p=l.page;p.options={token:'private'};p.data.product=product;p.data.products=[product];p.data.query='private search';
  assert.equal(p.onShareTimeline().query,'');assert.equal(p.onShareTimeline().imageUrl,'https://example.invalid/uploads/photo.jpg');assert.doesNotMatch(JSON.stringify(p.onShareAppMessage()),/private/);
 }
});

test('share menu failure falls back to friends, without breaking the page',()=>{
 const calls=[],l=createLoader({showShareMenu:o=>{calls.push(o.menus);if(calls.length===1)o.fail();}});l.load('utils/sharing.js').enablePublicSharing();assert.equal(JSON.stringify(calls),'[["shareAppMessage","shareTimeline"],["shareAppMessage"]]');
 assert.doesNotThrow(()=>createLoader().load('utils/sharing.js').enablePublicSharing());
});

test('timeline preview guards cart mutation and navigation while preserving browsing',async()=>{
 const toasts=[],l=createLoader({getLaunchOptionsSync:()=>({scene:1154}),showToast:x=>toasts.push(x.title)});const sharing=l.load('utils/sharing.js');assert.equal(sharing.isTimelinePreview(),true);
 l.load('pages/product-detail/index.js');const p=l.page;p.setData=x=>Object.assign(p.data,x);p.data.isTimelinePreview=true;p.data.headerHeight=64;
 p.updateHeaderHeight();assert.equal(p.data.headerHeight,0);
 await p.addToCart();p.openBag();p.openContact();p.openDelivery();p.previewImage({});assert.equal(toasts.length,5);
 for(const file of ['pages/home/home.js','pages/products/index.js']){const loader=createLoader({showToast(){}});loader.load(file);const page=loader.page;page.data.isTimelinePreview=true;page.openProduct({currentTarget:{dataset:{slug:'x1-air-white'}}});}
});

test('WebP covers export as JPEG and stale cover callbacks cannot replace the current product',async()=>{
 const exports=[],ready=[],images=[],callbacks=[],releases=[];
 const l=createLoader({getImageInfo(){},canvasToTempFilePath:o=>{exports.push(o);o.success({tempFilePath:'wxfile://share-cover.jpg'});o.complete();}},{[path.join(root,'utils/share-image.js')]:{loadLocalShareImage:()=>new Promise(resolve=>callbacks.push(resolve))}});l.load('components/share-entry/index.js');const def=l.component;
 const c={properties:{source:'https://example.test/new.webp'},canvasReady:true,disposed:false,triggerEvent:(event,data)=>ready.push(data)};Object.assign(c,def.methods);
 c.createSelectorQuery=()=>({select(){return this;},fields(){return this;},exec(fn){fn([{node:{createImage(){const image={width:800,height:1200};images.push(image);return image;},getContext(){return {fillRect(){},drawImage(){}};}}}]);}});
 const first=c.prepareCover();callbacks[0]({path:'wxfile://source.webp',release:()=>releases.push(0)});await first;images[0].onload();assert.equal(exports[0].fileType,'jpg');assert.equal(ready[0].path,'wxfile://share-cover.jpg');assert.equal(releases.length,1);
 c.properties.source='https://example.test/stale.webp';const stale=c.prepareCover();c.properties.source=photo;c.prepareCover();const count=ready.length;callbacks[1]({path:'wxfile://old.webp',release:()=>releases.push(1)});await stale;assert.equal(ready.length,count);assert.equal(ready.at(-1).source,photo);assert.equal(releases.at(-1),1);
});

test('share image loader uses the approved public request domain, no login header, and removes temporary source',async()=>{
 let request;const removed=[],writes=[],l=createLoader({env:{USER_DATA_PATH:'wxfile://owned'},getFileSystemManager:()=>({writeFile:o=>{writes.push(o.filePath);o.success();},unlink:o=>removed.push(o.filePath)}),request:o=>{request=o;o.success({statusCode:200,data:new Uint8Array([255,216,255,1]).buffer});},getImageInfo:o=>o.success({path:o.src,width:400,height:600})});
 const {loadLocalShareImage}=l.load('utils/share-image.js'),source='https://example.invalid/uploads/public.webp';const loaded=await loadLocalShareImage(source);assert.equal(request.url,source);assert.equal(request.header.Authorization,undefined);assert.equal(request.responseType,'arraybuffer');assert.match(loaded.path,/\.jpg$/);assert.equal(removed.length,0);loaded.release();loaded.release();assert.equal(removed.length,1);assert.equal(removed[0],writes[0]);
 await assert.rejects(loadLocalShareImage('https://outside.example/photo.webp'),/UNSUPPORTED_SHARE_IMAGE_ORIGIN/);
});

test('invalid image responses are rejected before writing and write failures remove the owned source',async()=>{
 let mode='html';const writes=[],removed=[],l=createLoader({env:{USER_DATA_PATH:'wxfile://owned'},getFileSystemManager:()=>({writeFile:o=>{writes.push(o.filePath);o.fail(new Error('WRITE_FAILED'));},unlink:o=>removed.push(o.filePath)}),request:o=>o.success({statusCode:mode==='html'?404:200,data:new Uint8Array(mode==='format'?[1,2,3]:[255,216,255,1]).buffer})});const load=l.load('utils/share-image.js').loadLocalShareImage;
 await assert.rejects(load('https://example.invalid/uploads/a.webp'),/INVALID_SHARE_IMAGE/);assert.equal(writes.length,0);mode='format';await assert.rejects(load('https://example.invalid/uploads/a.webp'),/INVALID_SHARE_IMAGE_FORMAT/);assert.equal(writes.length,0);mode='write';await assert.rejects(load('https://example.invalid/uploads/a.webp'),/WRITE_FAILED/);assert.equal(removed.length,1);
});

test('new WebP product uses only its prepared cover and safely falls back to app icon before ready',()=>{
 const {publicShareContent}=createLoader().load('utils/sharing.js'),p={...product,image:'https://example.test/new.webp'};
 assert.equal(publicShareContent({product:p,page:'product',slug:p.slug}).timeline.imageUrl,undefined);
 assert.equal(publicShareContent({product:p,cover:'wxfile://old.jpg',coverSource:photo}).timeline.imageUrl,undefined);
 assert.equal(publicShareContent({product:p,cover:'wxfile://new.jpg',coverSource:p.image}).timeline.imageUrl,'wxfile://new.jpg');
});

test('sharing is exposed only on public pages and share buttons bind real component methods',()=>{
 const app=JSON.parse(fs.readFileSync(path.join(root,'app.json')));
 for(const route of app.pages){const loader=createLoader();loader.load(route+'.js');const allowed=['pages/home/home','pages/products/index','pages/product-detail/index'].includes(route);assert.equal(typeof loader.page.onShareTimeline==='function',allowed,route);if(allowed){const config=JSON.parse(fs.readFileSync(path.join(root,route+'.json')));assert.equal(config.singlePage.navigationBarFit,route==='pages/product-detail/index'?'float':'squeezed');assert.equal(config.usingComponents['share-entry'],'/components/share-entry/index');}}
 const l=createLoader();l.load('components/share-entry/index.js');const xml=fs.readFileSync(path.join(root,'components/share-entry/index.wxml'),'utf8');for(const m of xml.matchAll(/(?:bind|catch)(?::)?[\w-]+="([A-Za-z][\w]*)"/g))assert.equal(typeof l.component.methods[m[1]],'function',m[1]);assert.match(xml,/open-type="share"/);assert.match(xml,/id="share-timeline"/);
});


test('share overlay blocks tab switching and restores navigation on close or page hide',()=>{
 const events=[],l=createLoader({showShareMenu(){},hideTabBar:()=>events.push('hide'),showTabBar:()=>events.push('show')});l.load('components/share-entry/index.js');const def=l.component,c={properties:{tabPage:true},data:{open:false,timelineGuide:false},setData(patch){Object.assign(this.data,patch);}};Object.assign(c,def.methods);
 c.openShare();assert.equal(c.data.open,true);c.guideTimeline();assert.equal(c.data.timelineGuide,true);c.closeShare();assert.equal(JSON.stringify(events),'["hide","show"]');assert.equal(c.data.timelineGuide,false);
 c.openShare();def.pageLifetimes.hide.call(c);assert.equal(c.data.open,false);assert.equal(events.at(-1),'show');
});

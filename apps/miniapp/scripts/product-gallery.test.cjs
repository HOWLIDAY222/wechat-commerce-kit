const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
const event=dataset=>({currentTarget:{dataset}});
const source={slug:'x1-air-white',videoUrl:'https://example.invalid/demo-film.mp4',images:['front.webp','rear.webp','detail.webp'],thumbImages:['front-thumb.webp','rear-thumb.webp','detail-thumb.webp'],previewImages:['front-full.webp','rear-full.webp','detail-full.webp']};
function page(wx={}){
  const loader=createLoader(wx);loader.load('pages/product-detail/index.js');
  const p=loader.page;p.data=structuredClone(p.data);p.setData=v=>Object.assign(p.data,v);
  p.pageVisible=true;p.videoVisibility={gallery:true,details:false};
  p.setData({product:source,...loader.load('models/product-gallery.js').productGallery(source)});return p;
}

test('a configured demo film precedes photos and unconfigured products keep their own first image',()=>{
  const model=createLoader().load('models/product-gallery.js');
  const before=JSON.stringify(source),gallery=model.productGallery(source);
  assert.deepEqual(Array.from(gallery.galleryMedia,x=>x.type),['video','image','image','image']);
  assert.equal(gallery.galleryMedia[0].id,'product-film');assert.equal(gallery.galleryHeight,562.5);
  assert.equal(gallery.galleryMedia[1].source,source.images[0]);assert.equal(gallery.galleryMedia[1].imageIndex,0);
  assert.equal(gallery.galleryMedia[2].imageIndex,1);
  assert.equal(gallery.galleryMedia[2].thumbnail,source.thumbImages[1]);
  assert.match(gallery.productFilm.source,/^https:\/\/example\.invalid\/demo-film\.mp4$/);
  assert.equal(JSON.stringify(source),before);
  const other=model.productGallery({...source,slug:'another-product',videoUrl:undefined});
  assert.equal(other.productFilm,null);assert.equal(other.galleryMedia.length,3);assert.equal(other.galleryMedia[0].source,source.images[0]);assert.equal(other.galleryHeight,750);
  assert.equal(model.productGallery(null).galleryMedia.length,0);
});

test('active visible gallery video starts automatically and pauses on image change, page hide and purchase sheets',()=>{
  const paused=[],p=page({createVideoContext:id=>({pause:()=>paused.push(id)})});
  p.setData({selectedStyle:'upgraded',selectedSize:'L',quantity:7});
  assert.equal(p.data.activeVideoId,'');
  assert.equal(p.data.galleryIndex,0);assert.equal(p.data.galleryHeight,562.5);p.syncProductVideoPlayback();
  assert.equal(p.data.activeVideoId,'product-gallery-video');
  p.onGalleryChange({detail:{current:1}});assert.equal(p.data.activeVideoId,'');assert.equal(paused.pop(),'product-gallery-video');
  p.chooseImage(event({index:0}));p.onHide();
  assert.equal(p.data.activeVideoId,'');assert.equal(paused.pop(),'product-gallery-video');
  p.pageVisible=true;p.videoVisibility={gallery:false,details:true};p.syncProductVideoPlayback();p.openSpecs('buy');
  assert.equal(p.data.activeVideoId,'');assert.equal(paused.pop(),'product-detail-video');
  assert.equal(p.data.purchaseIntent,'buy');assert.equal(p.data.selectedStyle,'upgraded');assert.equal(p.data.selectedSize,'L');assert.equal(p.data.quantity,7);
  p.chooseImage(event({index:-1}));p.chooseImage(event({index:99}));assert.equal(p.data.galleryIndex,0);
  p.onUnload();
});

test('only one product player is mounted and failed playback can be retried without changing selection',()=>{
  const paused=[],p=page({createVideoContext:id=>({pause:()=>paused.push(id)})});
  p.syncProductVideoPlayback();
  p.videoVisibility={gallery:false,details:true};p.syncProductVideoPlayback();assert.equal(paused[0],'product-gallery-video');
  p.onProductVideoError({currentTarget:{id:'product-detail-video'}});
  assert.equal(p.data.activeVideoId,'');assert.equal(p.data.videoFailures['product-detail-video'],true);
  p.playProductVideo(event({videoId:'product-detail-video'}));assert.equal(p.data.videoFailures['product-detail-video'],false);
  p.onProductVideoEnded({currentTarget:{id:'product-detail-video'}});assert.equal(p.data.activeVideoId,'product-detail-video');
  p.onHide();p.playProductVideo(event({videoId:'unrelated-video'}));assert.equal(p.data.activeVideoId,'');p.onUnload();
});

test('photo preview after the inserted video opens the correct original and never sends MP4 to image preview',()=>{
  let preview;const p=page({previewImage:v=>preview=v});
  p.chooseImage(event({index:2}));p.previewImage(event({src:p.data.galleryMedia[2].source}));
  assert.equal(preview.current,'rear-full.webp');assert.deepEqual(Array.from(preview.urls),source.previewImages);
  assert(preview.urls.every(url=>!url.endsWith('.mp4')));
  preview=undefined;p.previewImage(event({src:p.data.productFilm.source}));assert.equal(preview,undefined);p.onUnload();
});

test('native gallery keeps full photos and 4:3 film, with thumbnails outside the swiper and no eager video',()=>{
  const xml=fs.readFileSync(path.join(root,'pages/product-detail/index.wxml'),'utf8');
  const css=fs.readFileSync(path.join(root,'pages/product-detail/index.wxss'),'utf8');
  const gallery=xml.slice(xml.indexOf('<view class="gallery-wrap"'),xml.indexOf('<view class="detail">'));
  assert.doesNotMatch(xml,/<brand-header/);
  assert.doesNotMatch(xml.slice(0,xml.indexOf('<view class="gallery-wrap"')),/class="product-nav"/);
  assert.match(xml,/<view wx:if="\{\{sectionNavVisible\}\}" class="product-nav"/);
  assert.match(css,/\.product-nav\{position:fixed/);
  assert.match(css,/\.product-return\{position:fixed/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'pages/product-detail/index.json'),'utf8')).singlePage.navigationBarFit,'float');
  assert.match(gallery,/class="gallery-image[^\n]+mode="aspectFit"/);
  assert.doesNotMatch(gallery,/mode="aspectFill"/);
  assert(gallery.indexOf('</swiper>')<gallery.indexOf('class="gallery-toolbar"'));
  assert.match(gallery,/wx:if="\{\{activeVideoId==='product-gallery-video' && index===galleryIndex\}\}"/);
  assert.match(gallery,/muted="\{\{true\}\}" controls="\{\{true\}\}"/);
  assert.match(gallery,/object-fit="contain"/);
  assert.match(gallery,/loop="\{\{true\}\}"/);
  assert.match(gallery,/show-center-play-btn="\{\{false\}\}"/);
  assert.doesNotMatch(xml,/product-film__play/);
  assert.match(css,/\.gallery\{height:750rpx/);
  assert.match(css,/\.gallery--video\{height:562\.5rpx/);
  assert.match(css,/\.product-film--detail\{height:0;padding-top:75%/);
  assert.match(gallery,/style="height:\{\{galleryHeight\}\}rpx"/);
  assert.match(gallery,/<brand-loader wx:if="\{\{index===galleryIndex && galleryImageLoading===item.source && !mediaFailed\[item.source\]\}\}" overlay compact/);
  assert.match(xml,/<view wx:if="\{\{!product\}\}" class="product-state"[^>]*><brand-loader wx:if="\{\{loading\}\}"/);
});

test('portrait gallery keeps the whole source and stops its loader on image readiness or error',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const p=page({nextTick:fn=>fn()}),imageEvent={currentTarget:{dataset:{source:'front.webp'}},detail:{width:900,height:1600}};
  p.chooseImage(event({index:1}));assert.equal(p.data.galleryImageLoading,'front.webp');
  p.onMediaLoad(imageEvent);assert.equal(p.data.galleryImageLoading,'');assert.equal(p.data.mediaLoaded['front.webp'],true);
  assert.ok(Math.abs(p.data.galleryHeight-1333.3333)<.001);
  t.mock.timers.tick(12000);assert.equal(p.data.mediaFailed['front.webp'],false);
  p.chooseImage(event({index:2}));assert.equal(p.data.galleryImageLoading,'rear.webp');
  p.onMediaError(event({source:'rear.webp'}));assert.equal(p.data.galleryImageLoading,'');assert.equal(p.data.mediaFailed['rear.webp'],true);
  p.onMediaRetry(event({source:'rear.webp'}));assert.equal(p.data.galleryImageLoading,'rear.webp');assert.equal(p.data.mediaFailed['rear.webp'],false);
  t.mock.timers.tick(12000);assert.equal(p.data.galleryImageLoading,'');assert.equal(p.data.mediaFailed['rear.webp'],true);
  p.chooseImage(event({index:1}));assert.equal(p.data.galleryImageLoading,'');assert.ok(p.data.galleryHeight>1300);p.onUnload();
});

test('video loader follows actual play and buffering, then times out to retry instead of masking forever',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const p=page(),videoEvent={currentTarget:{id:'product-detail-video'}};
  p.videoVisibility={gallery:false,details:true};
  p.playProductVideo(event({videoId:'product-detail-video'}));assert.equal(p.data.videoLoadingId,'product-detail-video');
  p.onProductVideoReady(videoEvent);assert.equal(p.data.videoLoadingId,'');
  t.mock.timers.tick(15000);assert.equal(p.data.activeVideoId,'product-detail-video');assert.equal(p.data.videoFailures['product-detail-video'],false);
  p.onProductVideoWaiting(videoEvent);assert.equal(p.data.videoLoadingId,'product-detail-video');
  t.mock.timers.tick(10000);p.onProductVideoWaiting(videoEvent);t.mock.timers.tick(5000);
  assert.equal(p.data.activeVideoId,'');assert.equal(p.data.videoLoadingId,'');assert.equal(p.data.videoFailures['product-detail-video'],true);
  p.playProductVideo(event({videoId:'product-detail-video'}));assert.equal(p.data.videoFailures['product-detail-video'],false);
  p.onHide();assert.equal(p.data.videoLoadingId,'');t.mock.timers.tick(15000);assert.equal(p.data.videoFailures['product-detail-video'],false);p.onUnload();
});

test('native viewport observers mount only one visible player and resume it after the selection sheet closes',t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const observed={},disconnected=[],p=page({createIntersectionObserver:()=>({relativeToViewport(){return this;},observe(selector,callback){observed[selector]=callback;},disconnect(){disconnected.push(true);}})});
  p.setupProductVideoObservers();assert.equal(p.data.galleryIndex,0);assert.equal(p.data.activeVideoId,'');
  observed['#product-gallery-frame']({intersectionRatio:1});assert.equal(p.data.activeVideoId,'product-gallery-video');
  observed['#product-detail-film']({intersectionRatio:1});assert.equal(p.data.activeVideoId,'product-gallery-video');
  observed['#product-gallery-frame']({intersectionRatio:0});assert.equal(p.data.activeVideoId,'product-detail-video');
  observed['#product-detail-film']({intersectionRatio:0});assert.equal(p.data.activeVideoId,'');
  observed['#product-gallery-frame']({intersectionRatio:1});p.openSpecs('buy');assert.equal(p.data.activeVideoId,'');
  observed['#product-gallery-frame']({intersectionRatio:1});assert.equal(p.data.activeVideoId,'');
  p.dismissSpecs();t.mock.timers.tick(180);assert.equal(p.data.activeVideoId,'product-gallery-video');
  p.onHide();observed['#product-gallery-frame']({intersectionRatio:1});assert.equal(p.data.activeVideoId,'');
  p.onUnload();assert.equal(disconnected.length,2);
});

const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
const tick=()=>new Promise(setImmediate);
test('HTTP/2 transport retains fresh authenticated responses and write retry protection',async()=>{
  const calls=[];const l=createLoader({request:options=>{calls.push(options);options.success({statusCode:200,data:{ok:true}});}});
  await l.load('services/http.js').request({path:'/api/orders',method:'POST',auth:'none'});
  assert.equal(calls.length,1);assert.equal(calls[0].enableHttp2,true);assert.equal(calls[0].enableCache,false);assert.equal(calls[0].method,'POST');
});
test('home starts its public requests on load and show shares the same in-flight work',async()=>{
  let resolveProducts,resolveContent;let catalogCalls=0,contentCalls=0;
  const p=page('pages/home/home.js',{
    'services/catalog.js':{fetchProducts:()=>{catalogCalls++;return new Promise(r=>resolveProducts=r);}},
    'services/content.js':{fetchPublishedPage:()=>{contentCalls++;return new Promise(r=>resolveContent=r);},toNativeContentSections:p=>p.document.sections},
  });
  p.onLoad();p.onShow();assert.equal(catalogCalls,1);assert.equal(contentCalls,1);
  resolveProducts([]);resolveContent({document:{sections:[{id:'hero',type:'hero'}]}});await tick();assert.equal(p.data.loading,false);
});
function page(file,overrides){
  const mapped=Object.fromEntries(Object.entries(overrides).map(([key,value])=>[path.join(root,key),value]));
  const l=createLoader({stopPullDownRefresh(){}},mapped);l.load(file);
  const p=l.page;p.data=structuredClone(p.data);p.setData=value=>Object.assign(p.data,value);return p;
}
test('home renders content while catalog is still pending and default refresh respects cache',async()=>{
  let resolveProducts;const forces=[];
  const p=page('pages/home/home.js',{
    'services/catalog.js':{fetchProducts:({force})=>{forces.push(force);return new Promise(r=>resolveProducts=r);}},
    'services/content.js':{fetchPublishedPage:async(key,{force})=>{forces.push(force);return {document:{sections:[{id:'hero',type:'hero'}]}};},toNativeContentSections:p=>p.document.sections},
  });
  const loading=p.load();await tick();assert.equal(p.data.sections.length,1);assert.equal(p.data.product,null);
  resolveProducts([{id:'p',slug:'x1-air-white'}]);await loading;assert.equal(p.data.product.slug,'x1-air-white');assert.deepEqual(forces,[false,false]);
  const refresh=p.load(true);await tick();resolveProducts([]);await refresh;assert.deepEqual(forces.slice(2),[true,true]);
});
test('a failed catalog does not hide available home content',async()=>{
  const p=page('pages/home/home.js',{
    'services/catalog.js':{fetchProducts:async()=>{throw Error('offline');}},
    'services/content.js':{fetchPublishedPage:async()=>({document:{sections:[{id:'hero'}]}}),toNativeContentSections:p=>p.document.sections},
  });await p.load();assert.equal(p.data.sections.length,1);assert.equal(p.data.loading,false);assert.match(p.data.notice,/商品暂时/);assert.equal(p.data.error,'');
});
test('empty visitor bag opens without catalog or network',async()=>{
  let calls=0;const l=createLoader({getStorageSync:()=>[],removeTabBarBadge(){}},{[path.join(root,'services/catalog.js')]:{fetchProducts:async()=>{calls++;throw Error('offline');}}});
  const cart=await l.load('services/guest-cart.js').fetchGuestCart();assert.equal(calls,0);assert.equal(cart.items.length,0);assert.equal(cart.subtotalCents,0);assert.equal(cart.hasUnavailable,false);
});
test('concurrent content reads share a request and failed requests can be retried',async()=>{
  let resolve;let calls=0;let fail=true;const saved=new Map();
  const l=createLoader({getStorageSync:k=>saved.get(k),setStorageSync:(k,v)=>saved.set(k,v)},{[path.join(root,'services/http.js')]:{request:()=>{calls++;if(fail)return Promise.reject(Error('offline'));return new Promise(r=>resolve=r);}}});
  const svc=l.load('services/content.js');await Promise.all([assert.rejects(svc.fetchPublishedPage('home'),/offline/),assert.rejects(svc.fetchPublishedPage('home'),/offline/)]);assert.equal(calls,1);
  fail=false;const a=svc.fetchPublishedPage('home'),b=svc.fetchPublishedPage('home');assert.equal(calls,2);resolve({ok:true,page:{document:{sections:[]}}});await Promise.all([a,b]);await svc.fetchPublishedPage('home');assert.equal(calls,2);
});
test('product detail reuses current catalog while retry forces a fresh read',async()=>{
  const options=[];const p=page('pages/product-detail/index.js',{'services/catalog.js':{fetchProductBySlug:async(slug,o)=>{options.push(o.force);return null;}}});p.slug='missing';await p.load();await p.load(true);assert.deepEqual(options,[false,true]);
});
test('gallery thumbnails are 256px, display gallery is 750px and zoom retains 1080px and private media is untouched',()=>{
  const l=createLoader(),normalize=l.load('models/product.js').normalizeProduct;
  const p=normalize({image:'/assets/catalog/main.jpg',images:['/assets/catalog/main.jpg','/assets/catalog/detail.jpg'],variants:[]});
  assert(p.images.every(x=>x.includes('w=750&q=75')));assert(p.previewImages.every(x=>x.includes('w=1080&q=75')));assert(p.cardImage.includes('w=384&q=75'));assert(p.thumbImages.every(x=>x.includes('w=256&q=75')));
  assert.equal(l.load('utils/url.js').resolveProductImage('/uploads/after-sales/a.jpg',256),'https://example.invalid/uploads/after-sales/a.jpg');
});

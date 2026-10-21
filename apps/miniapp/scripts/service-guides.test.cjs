const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
const product={slug:'x1-air-white',name:'Essential Brief Demo',sizes:['S','M','L'],careInstructions:'30℃以下轻柔洗涤；\n不可漂白；不可烘干；\n阴凉处晾干。\n具体洗护要求以商品洗标为准。'};
const published={document:{sections:[{visible:true,items:[{id:'size-waist',title:'腰围',body:'在内裤腰头通常停留的位置水平测量，软尺贴合身体但不要勒紧。'},{id:'live-size-S',title:'S',body:'人体腰围 64–72 cm；参考体重 45–60 kg。'},{id:'live-size-M',title:'M',body:'人体腰围 72–80 cm；参考体重 55–65 kg。'},{id:'live-size-L',title:'L',body:'人体腰围 80–88 cm；参考体重 65–75 kg。'}]}]}};
const models=()=>createLoader().load('models/service-guides.js');
const tick=()=>new Promise(setImmediate);
const tap=(key,value)=>({type:'tap',currentTarget:{dataset:{[key]:value}}});
function fixture(kind='size',{signedIn=true,consent=true,verify,fetchProduct,fetchGuide}={}){
  const identity={signedIn,consent,token:'test-service-session'},calls={tabs:[],pages:[],products:0,guides:0};
  const loader=createLoader({switchTab(options){calls.tabs.push(options.url);options.complete?.();},navigateTo(options){calls.pages.push(options.url);options.complete?.();},showToast(){}},{
    [path.join(root,'stores/session.js')]:{hasSession:()=>identity.signedIn,readAccessToken:()=>identity.token},
    [path.join(root,'stores/privacy-consent.js')]:{isPrivacyAccepted:()=>identity.consent},
    [path.join(root,'services/auth.js')]:{fetchCurrentUser:async()=>verify?verify():{id:'test-service-user'}},
    [path.join(root,'services/catalog.js')]:{fetchProductBySlug:async(slug,options)=>{calls.products++;assert.equal(slug,'x1-air-white');assert.equal(options.force,true);return fetchProduct?fetchProduct():structuredClone(product);}},
    [path.join(root,'services/content.js')]:{fetchPublishedPage:async(key,options)=>{calls.guides++;assert.equal(key,'size-guide');assert.equal(options.force,true);return fetchGuide?fetchGuide():structuredClone(published);}},
  });
  loader.load('pages/'+kind+'-guide/index.js');const page=loader.page;page.data=structuredClone(page.data);page.setData=patch=>Object.assign(page.data,patch);page.onLoad();
  return {page,identity,calls,navigation:loader.load('stores/navigation.js')};
}

test('published body ranges become three native table rows in waist order',()=>{
  const value=models().publishedSizeGuide(published,product);
  assert.deepEqual(Array.from(value.rows,row=>[row.size,row.waistLabel,row.weightLabel]),[['S','64–72','45–60'],['M','72–80','55–65'],['L','80–88','65–75']]);
  assert.equal(value.tips[0].id,'size-waist');
});
test('updated published measurements replace the old reference instead of using fixed X1 numbers',()=>{
  const updated=structuredClone(published);updated.document.sections[0].items[1].body='人体腰围 60–68 cm；参考体重 40–55 kg。';
  const rows=models().publishedSizeGuide(updated,product).rows;assert.equal(rows[0].waistMin,60);assert.equal(rows[0].waistMax,68);
  assert.equal(models().queryPublishedSize(rows,{waistCm:'66',weightKg:'',preference:'regular'}).recommended,'S');
});
test('structured table content takes precedence over paragraph reference',()=>{
  const updated=structuredClone(published);updated.document.sections[0].items.push({table:{headers:['尺码','腰围 cm','体重 kg'],rows:[['M','73–81','56–66']]}});
  const row=models().publishedSizeGuide(updated,product).rows.find(row=>row.size==='M');assert.equal(row.waistMin,73);assert.equal(row.weightMax,66);
});
test('hidden and malformed size rows never become recommendations',()=>{
  const updated=structuredClone(published);updated.document.sections[0].items[1].visible=false;updated.document.sections[0].items[2].body='人体腰围 80–72 cm；参考体重 55–65 kg。';
  const rows=models().publishedSizeGuide(updated,product).rows;assert.equal(rows.length,1);assert.equal(rows[0].size,'L');
});
test('the X1 guide is never applied to another product or unavailable sizes',()=>{
  assert.equal(models().publishedSizeGuide(published,{...product,slug:'different-product'}).rows.length,0);
  assert.deepEqual(Array.from(models().publishedSizeGuide(published,{...product,sizes:['M']}).rows,row=>row.size),['M']);
});
test('query requires waist and rejects nondecimal or out-of-bound fields',()=>{
  const model=models(),rows=model.publishedSizeGuide(published,product).rows;
  assert.throws(()=>model.queryPublishedSize(rows,{waistCm:'',weightKg:'60'}),/WAIST_REQUIRED/);
  for(const waist of ['7e1','0x48','NaN','39','200.1','72.25'])assert.throws(()=>model.queryPublishedSize(rows,{waistCm:waist}),/INVALID_WAIST/);
  for(const weight of ['1e2','19','301','60.25'])assert.throws(()=>model.queryPublishedSize(rows,{waistCm:'76',weightKg:weight}),/INVALID_WEIGHT/);
});
test('normal, boundary and relaxed queries consistently follow the published waist ranges',()=>{
  const model=models(),rows=model.publishedSizeGuide(published,product).rows;
  assert.equal(model.queryPublishedSize(rows,{waistCm:'76',weightKg:'60',preference:'regular'}).recommended,'M');
  assert.equal(model.queryPublishedSize(rows,{waistCm:'72',weightKg:'',preference:'regular'}).recommended,'S');
  assert.equal(model.queryPublishedSize(rows,{waistCm:'72',weightKg:'',preference:'relaxed'}).recommended,'M');
  assert.equal(model.queryPublishedSize(rows,{waistCm:'80',weightKg:'',preference:'relaxed'}).recommended,'L');
});
test('outside measurements and weight mismatches do not claim a guaranteed fit',()=>{
  const model=models(),rows=model.publishedSizeGuide(published,product).rows;
  const outside=model.queryPublishedSize(rows,{waistCm:'90',weightKg:'60'});assert.equal(outside.recommended,'');assert.equal(outside.status,'outside');assert.match(outside.detail,/联系客服/);
  const mismatch=model.queryPublishedSize(rows,{waistCm:'76',weightKg:'100'});assert.equal(mismatch.weightMismatch,true);assert.match(mismatch.detail,/联系客服/);
});
test('care guide produces four actual rules, four steps and the exact merchant label notice',()=>{
  const guide=models().careGuide(product);assert.equal(guide.cards.length,4);assert.equal(guide.steps.length,4);assert.equal(guide.cards[0].label,'30℃');
  assert.deepEqual(Array.from(guide.cards,card=>card.kind),['wash','bleach','dryer','dry']);assert.equal(guide.notice,'具体洗护要求以商品洗标为准');
  assert.equal(guide.steps[3].body,'不可烘干；阴凉处晾干');
});
test('care formatting preserves a changed washing temperature and unknown instructions',()=>{
  const guide=models().careGuide({...product,careInstructions:'20℃以下手洗；不可熨烫。以洗标为准。'});assert.equal(guide.cards[0].label,'20℃');assert.equal(guide.cards[1].text,'不可熨烫');assert.equal(guide.cards[1].kind,'other');
});
test('missing care copy or a label notice alone never invents washing rules',()=>{
  assert.equal(models().careGuide(null),null);assert.equal(models().careGuide({...product,careInstructions:''}),null);assert.equal(models().careGuide({...product,careInstructions:'以洗标为准。'}),null);
});

for(const kind of ['size','care']){
  test(kind+' direct entry requires login and remembers its own destination',async()=>{
    const {page,calls,navigation}=fixture(kind,{signedIn:false});await page.onShow();assert.equal(page.data.authorized,false);assert.equal(calls.products+calls.guides,0);assert.deepEqual(calls.tabs,['/pages/account/index']);assert.equal(navigation.consumeMemberLoginReturn(),'/pages/'+kind+'-guide/index');
  });
  test(kind+' waits for both current privacy consent and server login verification',async()=>{
    const denied=fixture(kind,{consent:false});await denied.page.onShow();assert.equal(denied.calls.products+denied.calls.guides,0);
    let resolve;const {page,calls}=fixture(kind,{verify:()=>new Promise(done=>resolve=done)});const pending=page.onShow();assert.equal(page.data.authorized,false);assert.equal(calls.products,0);resolve({id:'test-service-user'});await pending;assert.equal(page.data.authorized,true);assert.equal(calls.products,1);
  });
  test(kind+' clears data and ignores late content after leaving the page',async()=>{
    let resolve;const {page}=fixture(kind,{fetchProduct:()=>new Promise(done=>resolve=done)});const pending=page.onShow();await tick();page.onHide();resolve(structuredClone(product));await pending;assert.equal(page.data.authorized,false);assert.equal(kind==='size'?page.data.rows.length:page.data.guide,kind==='size'?0:null);
  });
  test(kind+' content failures provide a working retry',async()=>{
    let fail=true;const {page}=fixture(kind,{fetchProduct:()=>{if(fail)throw Error('offline');return structuredClone(product);}});await page.onShow();assert.match(page.data.error,/加载失败/);assert.equal(page.data.loading,false);fail=false;await page.loadGuide();assert.equal(page.data.error,'');assert.equal(kind==='size'?page.data.rows.length:page.data.guide.cards.length,kind==='size'?3:4);
  });
  test(kind+' redirects when the account changes during content loading',async()=>{
    let resolve;const {page,identity,calls}=fixture(kind,{fetchProduct:()=>new Promise(done=>resolve=done)});const pending=page.onShow();await tick();identity.token='different-account';resolve(structuredClone(product));await pending;assert.equal(page.data.authorized,false);assert.deepEqual(calls.tabs,['/pages/account/index']);
  });
}
test('size row selection, waist query and result-table navigation update real page state',async()=>{
  const {page}=fixture();await page.onShow();page.selectSize(tap('size','L'));assert.equal(page.data.selectedSize,'L');page.changeTab(tap('tab','query'));page.input({currentTarget:{dataset:{key:'waistCm'}},detail:{value:'76'}});page.querySize(tap('action','query'));assert.equal(page.data.result.recommended,'M');assert.equal(page.data.selectedSize,'M');page.showResultTable();assert.equal(page.data.activeTab,'table');
});
test('query validation, preference changes and edits clear stale recommendations',async()=>{
  const {page}=fixture();await page.onShow();page.querySize();assert.match(page.data.queryError,/填写腰围/);page.input({currentTarget:{dataset:{key:'waistCm'}},detail:{value:'72'}});page.querySize();assert.equal(page.data.result.recommended,'S');page.choosePreference(tap('preference','relaxed'));assert.equal(page.data.result,null);page.querySize();assert.equal(page.data.result.recommended,'M');page.input({currentTarget:{dataset:{key:'weightKg'}},detail:{value:'1e2'}});page.querySize();assert.match(page.data.queryError,/体重/);assert.equal(page.data.selectedSize,'');
});
test('measurement help can open and close without submitting or saving body measurements',async()=>{
  const {page,calls}=fixture();await page.onShow();page.openMeasure();assert.equal(page.data.measureOpen,true);assert.ok(page.data.tips[0].body);page.closeMeasure();assert.equal(page.data.measureOpen,false);assert.equal(calls.pages.length,0);
});
test('repeated page entry cannot leave an old content request blocking the current one',async()=>{
  const resolves=[];const {page}=fixture('size',{fetchGuide:()=>new Promise(resolve=>resolves.push(resolve))});const first=page.onShow();await tick();const second=page.onShow();await tick();assert.equal(resolves.length,2);resolves[0](structuredClone(published));await first;assert.equal(page.data.rows.length,0);resolves[1](structuredClone(published));await second;assert.equal(page.data.rows.length,3);assert.equal(page.data.loading,false);
});
test('care navigation switches modes and opens the actual product',async()=>{
  const {page,calls}=fixture('care');await page.onShow();page.changeTab(tap('tab','steps'));assert.equal(page.data.activeTab,'steps');page.changeTab(tap('tab','unknown'));assert.equal(page.data.activeTab,'steps');page.openProduct();assert.equal(calls.pages[0],'/pages/product-detail/index?slug=x1-air-white');
});

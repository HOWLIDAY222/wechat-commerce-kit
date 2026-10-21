const test=require('node:test'),assert=require('node:assert/strict');
const {createLoader}=require('./test-loader.cjs');
test('first app onShow uses its instance before getApp is available, then counts later openings',()=>{
 const loader=createLoader({canIUse:()=>false}, {}, null);loader.load('app.js');const app=loader.appDefinition;
 assert.doesNotThrow(()=>app.onShow());assert.equal(app.globalData.miniappVisitId,1);
 app.onShow();assert.equal(app.globalData.miniappVisitId,2);
 const visits=loader.load('utils/miniapp-visit.js');assert.equal(visits.currentMiniappVisit(),0);assert.equal(visits.currentMiniappVisit(app),2);
});
function fixture(overrides={},app={globalData:{}}){
 const l=createLoader({getWindowInfo:()=>({windowWidth:390}),getMenuButtonBoundingClientRect:()=>({left:290,width:90}),...overrides},{},app);
 l.load('components/add-miniapp-hint/index.js');const d=l.component;
 const c={data:structuredClone(d.data),setData(value){Object.assign(this.data,value);}};
 for(const [name,fn]of Object.entries(d.methods))c[name]=fn.bind(c);
 return {c,app,begin:l.load('utils/miniapp-visit.js').beginMiniappVisit,attach:()=>d.lifetimes.attached.call(c),show:()=>d.pageLifetimes.show.call(c),hide:()=>d.pageLifetimes.hide.call(c),detach:()=>d.lifetimes.detached.call(c)};
}
test('hint shows once per app opening, stays closed across page returns, and shows on the next opening',()=>{
 const app={globalData:{}},f=fixture({checkIsAddedToMyMiniProgram:({success})=>success({added:false})},app);
 f.begin();f.attach();assert.equal(f.c.data.visible,true);assert.equal(f.c.data.pointerLeft,312.5);
 f.c.dismiss();f.hide();f.show();assert.equal(f.c.data.visible,false);
 const nextPage=fixture({},app);nextPage.attach();assert.equal(nextPage.c.data.visible,false);
 nextPage.hide();f.begin();nextPage.show();assert.equal(nextPage.c.data.visible,true);
});
test('already added users remain hidden and an unavailable platform check does not break the guide',()=>{
 const added=fixture({checkIsAddedToMyMiniProgram:({success})=>success({added:true})});added.begin();added.attach();assert.equal(added.c.data.visible,false);
 const failed=fixture({checkIsAddedToMyMiniProgram:({fail})=>fail({errMsg:'unsupported'})});failed.begin();failed.attach();assert.equal(failed.c.data.visible,true);
});
test('late callbacks from hidden, closed, detached or previous app visits cannot reopen the hint',()=>{
 for(const state of ['hide','close','detach','nextVisit']){
  let reply;const f=fixture({checkIsAddedToMyMiniProgram:({success})=>reply=success});f.begin();f.attach();
  if(state==='close')f.c.dismiss();else if(state==='nextVisit')f.begin();else f[state]();
  reply({added:false});assert.equal(f.c.data.visible,false);
 }
});
test('old seven-day storage history is ignored and menu pointer stays inside narrow screens',()=>{
 const f=fixture({getStorageSync:()=>({shownAt:Date.now(),dismissedAt:Date.now()}),getWindowInfo:()=>({windowWidth:320}),getMenuButtonBoundingClientRect:()=>({left:310,width:100})});
 f.begin();f.attach();assert.equal(f.c.data.visible,true);assert.equal(f.c.data.pointerLeft,304);
 f.c.dismiss();f.hide();f.show();assert.equal(f.c.data.visible,false);
});

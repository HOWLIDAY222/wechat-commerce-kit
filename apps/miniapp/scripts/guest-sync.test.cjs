const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
function fixture(){
 const storage=new Map(),calls=[];let items=[{productSlug:'x1-air-white',color:'白色',size:'M',quantity:1}],mode='network';
 const wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k)};
 const loader=createLoader(wx,{
  [path.join(root,'stores/session.js')]:{readStoredUser:()=>({id:'user-test'})},
  [path.join(root,'services/guest-cart.js')]:{readGuestItems:()=>items,clearGuestItems:()=>{items=[];}},
  [path.join(root,'services/http.js')]:{request:async o=>{calls.push(o);if(mode==='network')throw new Error('NETWORK');if(mode==='limit'){const e=new Error('PRODUCT_QUANTITY_LIMIT_EXCEEDED');e.statusCode=400;throw e;}return {ok:true,cart:{items:[]}};}},
 });
 return {loader,calls,storage,items:()=>items,mode:v=>{mode=v;}};
}
test('lost response keeps original import id and selections until successful retry',async()=>{
 const f=fixture(),service=f.loader.load('services/guest-sync');
 await assert.rejects(service.syncGuestCart());assert.equal(f.items().length,1);assert.equal(service.hasPendingGuestSync(),true);
 f.mode('success');await service.syncGuestCart();assert.equal(f.calls[0].data.importId,f.calls[1].data.importId);assert.equal(f.items().length,0);assert.equal(service.hasPendingGuestSync(),false);
});
test('definitive validation failure retains selections and unlocks local editing',async()=>{
 const f=fixture();f.mode('limit');const service=f.loader.load('services/guest-sync');
 await assert.rejects(service.syncGuestCart());assert.equal(f.items().length,1);assert.equal(service.hasPendingGuestSync(),false);
});
test('parallel synchronization does not issue duplicate requests',async()=>{
 const f=fixture();f.mode('success');const service=f.loader.load('services/guest-sync');
 await Promise.all([service.syncGuestCart(),service.syncGuestCart()]);assert.equal(f.calls.length,1);
});
test('unconfirmed import locks quantity removal too',async()=>{
 const wx={getStorageSync:k=>k.endsWith('guest-import.v1')?{importId:'pending'}:[]};
 const service=createLoader(wx).load('services/guest-cart');await assert.rejects(service.updateGuestQuantity('item',0),/CART_SYNC_PENDING/);
});

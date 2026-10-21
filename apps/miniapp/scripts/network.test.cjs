const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
function fixture(env='develop', age=0) {
  const storage=new Map();
  const wx={getStorageSync:k=>storage.get(k),setStorageSync:(k,v)=>storage.set(k,v),getAccountInfoSync:()=>({miniProgram:{envVersion:env}})};
  const loader=createLoader(wx,{
    [path.join(root,'services/http.js')]:{request:()=>Promise.reject(new Error('NETWORK_UNAVAILABLE'))},
    [path.join(root,'content/catalog-snapshot.js')]:{snapshot:{capturedAt:new Date(Date.now()-age).toISOString(),products:[]}}
  });
  return {loader,storage,wx};
}
test('development can read a dated public catalog during network failure',async()=>{const {loader}=fixture();assert.equal((await loader.load('services/catalog').fetchProducts()).length,0);});
for (const env of ['trial','release']) test(env+' never falls back to bundled catalog',async()=>{const {loader}=fixture(env);await assert.rejects(loader.load('services/catalog').fetchProducts(),/NETWORK_UNAVAILABLE/);});
test('expired development snapshot fails closed',async()=>{const {loader}=fixture('develop',86400001);await assert.rejects(loader.load('services/catalog').fetchProducts(),/NETWORK_UNAVAILABLE/);});
test('persisted development catalog cannot leak into release',()=>{const {loader,wx}=fixture();const store=loader.load('stores/catalog');store.writeCatalog([],new Date().toISOString());assert.ok(store.readCatalog().snapshotAt);wx.getAccountInfoSync=()=>({miniProgram:{envVersion:'release'}});assert.equal(store.readCatalog(),null);});
test('expired memory catalog is not returned',()=>{const {loader}=fixture();const store=loader.load('stores/catalog');store.writeCatalog([]);const entry=store.readCatalog();entry.savedAt=1;assert.equal(store.readCatalog(),null);});
test('HTML response cannot be mistaken for successful JSON',async()=>{const l=createLoader({request:o=>o.success({statusCode:200,data:'<!DOCTYPE html>'})});await assert.rejects(l.load('services/http').request({path:'/test',auth:'none'}),/INVALID_API_RESPONSE/);});
test('failed writes are not automatically repeated',async()=>{let calls=0;const l=createLoader({request:o=>{calls++;o.fail({errMsg:'connection lost'});}});await assert.rejects(l.load('services/http').request({path:'/test',method:'POST',auth:'none'}));assert.equal(calls,1);});

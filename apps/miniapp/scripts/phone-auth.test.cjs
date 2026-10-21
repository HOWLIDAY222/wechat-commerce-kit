const test=require('node:test');const assert=require('node:assert/strict');const path=require('path');const {createLoader,root}=require('./test-loader.cjs');
function fixture({logged=false,syncError=false,linkError=false,blockedLink=false}={}) {
 const calls=[];let user={id:'wx-user',phone:null};let resolveLink;
 const overrides={};overrides[path.join(root,'services/auth.js')]={
 getCachedUser:()=>user,fetchCurrentUser:async()=>user,
 loginWithWeChat:async()=>{calls.push('login');logged=true;return user;},
 linkWeChatPhone:async code=>{calls.push('link:'+code);if(linkError)throw Error('WECHAT_PHONE_CODE_INVALID');if(blockedLink)await new Promise(r=>{resolveLink=r;});user={id:'merged-user',phone:'13900000002'};return user;},
 };overrides[path.join(root,'stores/session.js')]={hasSession:()=>logged};
 overrides[path.join(root,'services/guest-sync.js')]={syncGuestCart:async()=>{calls.push('sync');if(syncError)throw Error('CART_SYNC_ACCOUNT_CHANGED');}};
 const loader=createLoader({canIUse:()=>true,showToast:()=>calls.push('toast')},overrides);loader.load('pages/account/index.js');const page=loader.page;
 page.setData=function(data){Object.assign(this.data,data)};Object.assign(page.data,{loggedIn:logged,consented:true,crossBorderConsented:true,phoneConsent:true});
 return {page,calls,release:()=>resolveLink()};
}
test('quick or realtime phone code logs in, imports bag then binds account',async()=>{for(const code of ['quick-code','realtime-code']){const f=fixture();await f.page.authorizePhone({detail:{code}});assert.deepEqual(f.calls,['login','sync','link:'+code,'toast']);assert.equal(f.page.data.user.id,'merged-user');assert.equal(f.page.data.phoneAuthorizing,false);}});
test('already logged-in account skips wx.login before phone binding',async()=>{const f=fixture({logged:true});await f.page.authorizePhone({detail:{code:'phone-code'}});assert.deepEqual(f.calls,['sync','link:phone-code','toast']);});
test('denied authorization and exhausted quota never exchange a code',async()=>{for(const detail of [{errMsg:'getPhoneNumber:fail user deny'},{errno:1400001}]){const f=fixture();await f.page.authorizePhone({detail});assert.deepEqual(f.calls,[]);assert.ok(f.page.data.error);}});
test('privacy choice required for both login and existing-account authorization',async()=>{const f=fixture();f.page.data.crossBorderConsented=false;await f.page.authorizePhone({detail:{code:'x'}});assert.deepEqual(f.calls,[]);const g=fixture({logged:true});g.page.data.phoneConsent=false;await g.page.authorizePhone({detail:{code:'x'}});assert.deepEqual(g.calls,[]);});
test('pending guest import blocks identity merge but keeps successful login',async()=>{const f=fixture({syncError:true});await f.page.authorizePhone({detail:{code:'x'}});assert.deepEqual(f.calls,['login','sync']);assert.equal(f.page.data.loggedIn,true);assert.ok(f.page.data.error);});
test('invalid code remains recoverable without auto retry',async()=>{const f=fixture({linkError:true});await f.page.authorizePhone({detail:{code:'x'}});assert.deepEqual(f.calls,['login','sync','link:x']);assert.equal(f.page.data.loggedIn,true);assert.match(f.page.data.error,/重新/);});
test('parallel authorization callbacks only bind once',async()=>{const f=fixture({blockedLink:true});const first=f.page.authorizePhone({detail:{code:'x'}});await new Promise(setImmediate);await f.page.authorizePhone({detail:{code:'y'}});f.release();await first;assert.deepEqual(f.calls,['login','sync','link:x','toast']);});
test('phone API rotates session and disables automatic POST retries',async()=>{const calls=[];const overrides={};overrides[path.join(root,'stores/session.js')]={writeSession:(s,u)=>calls.push({session:s,user:u})};overrides[path.join(root,'services/http.js')]={request:async opts=>{calls.push(opts);return {ok:true,session:{accessToken:'new-session'},user:{id:'merged'}}}};const loader=createLoader({},overrides);const user=await loader.load('services/auth.js').linkWeChatPhone('single-use');assert.equal(user.id,'merged');assert.equal(calls[0].auth,'required');assert.equal(calls[0].retries,0);assert.equal(calls[0].data.code,'single-use');assert.equal(calls[1].session.accessToken,'new-session');});

const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
function fixture(verify=async()=>({ok:true,status:'TEST_VERIFIED',rewardPoints:0,couponsIssued:0}),{guest=false,pagePath='packages/student/entry.js'}={}){
  const storage=new Map([['merchantkit.session',guest?null:{accessToken:'student-qa',expiresAt:'2099-01-01'}],['merchantkit.user',{id:'student-qa'}]]),calls=[],nav=[];
  const overview={ok:true,registered:true,pointsBalance:1000,tasks:[{key:'STUDENT',enabled:true,state:'AVAILABLE',rewardPoints:100}],student:{verification:{provider:'WECHAT',available:true,status:'READY'},valid:false,benefitsEnabled:true,coupons:[{},{}]},lotteries:[],surveys:[],posts:[],myApplications:[]};
  const service={fetchMemberOperations:async()=>structuredClone(overview)};
  const loader=createLoader({getStorageSync:key=>storage.get(key),setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),navigateBack:()=>nav.push('back'),redirectTo:o=>nav.push(o.url)},
    {[path.join(root,'services/member-operations.js')]:service,[path.join(root,'services/member-student.js')]:{verifyStudentIdentity:async(...args)=>{calls.push(args);return verify(...args)},studentVerificationError:e=>e.message}});
  loader.load(pagePath);const page=loader.page;page.data=structuredClone(page.data);page.setData=value=>Object.assign(page.data,value);page.onLoad({start:'1'});
  return{page,storage,calls,nav,service,overview};
}
const settle=()=>new Promise(done=>setImmediate(done));
test('entry opens only after the user navigated and membership loaded, without exchanging a code',async()=>{
  const x=fixture();assert.equal(x.page.data.showStudentVerifyDialog,false);await x.page.loadOperations();assert.equal(x.page.data.showStudentVerifyDialog,true);assert.equal(x.calls.length,0);
});
test('close without auth, reject and a guest never call the verification server',async()=>{
  const x=fixture();await x.page.loadOperations();x.page.onStudentVerifyClose();x.page.onStudentVerifyReject();await settle();assert.equal(x.calls.length,0);
  const guest=fixture(undefined,{guest:true});await guest.page.loadOperations();guest.page.onStudentVerifyAuth({detail:{wx_studentcheck_code:'code'}});await settle();assert.equal(guest.calls.length,0);
});
test('auth and close racing while request is pending coalesce and never write the code to storage',async()=>{
  let resolve;const x=fixture(()=>new Promise(done=>{resolve=done}));await x.page.loadOperations();x.page.onStudentVerifyAuth({detail:{wx_studentcheck_code:'granted-student-code'}});x.page.onStudentVerifyClose();assert.equal(x.calls.length,1);
  resolve({ok:true,status:'TEST_VERIFIED',rewardPoints:0,couponsIssued:0});await settle();assert.equal(x.calls.length,1);assert.equal(x.nav.length,1);assert.equal(x.page.activeCode,'');assert.equal(JSON.stringify([...x.storage.values()]).includes('granted-student-code'),false);
});
test('pending status on auth is queried once again on close and never treated as verified',async()=>{
  const x=fixture(async()=>({ok:true,status:'PENDING',rewardPoints:0,couponsIssued:0}));await x.page.loadOperations();x.page.onStudentVerifyAuth({detail:{wx_studentcheck_code:'pending-code'}});x.page.onStudentVerifyClose();await settle();await settle();assert.equal(x.calls.length,2);assert.equal(x.nav.length,0);assert.match(x.page.data.notice,/微信正在审核/);
});
test('a close racing an initially unbound result still queries the newer verified result once',async()=>{
  let count=0;const x=fixture(async()=>({ok:true,status:++count===1?'UNBOUND':'VERIFIED',rewardPoints:0,couponsIssued:0}));await x.page.loadOperations();x.page.onStudentVerifyAuth({detail:{wx_studentcheck_code:'newly-bound-code'}});x.page.onStudentVerifyClose();await settle();await settle();assert.equal(x.calls.length,2);assert.equal(x.nav.length,1);
});
test('a nonstudent result lets the user reopen WeChat verification instead of polling a failed code forever',async()=>{
  const x=fixture(async()=>({ok:true,status:'NOT_STUDENT',rewardPoints:0,couponsIssued:0}));await x.page.loadOperations();x.page.onStudentVerifyAuth({detail:{wx_studentcheck_code:'not-yet-student-code'}});await settle();assert.equal(x.page.data.hasCode,false);x.page.startVerification();assert.equal(x.page.activeCode,'');assert.equal(x.page.data.showStudentVerifyDialog,true);assert.equal(x.calls.length,1);
});
test('late account switch prevents navigation and clears the temporary code on reload',async()=>{
  let resolve;const x=fixture(()=>new Promise(done=>{resolve=done}));await x.page.loadOperations();x.page.onStudentVerifyAuth({detail:{wx_studentcheck_code:'account-one-code'}});x.storage.set('merchantkit.user',{id:'another-account'});resolve({ok:true,status:'VERIFIED',rewardPoints:100,couponsIssued:2});await settle();assert.equal(x.nav.length,0);await x.page.loadOperations();assert.equal(x.page.activeCode,'');
});
test('expired query code is removed and retry returns to authorization',async()=>{
  const x=fixture(async()=>{throw Error('WECHAT_STUDENT_CODE_INVALID')});await x.page.loadOperations();x.page.onStudentVerifyAuth({detail:{wx_studentcheck_code:'expired-code'}});await settle();assert.equal(x.page.activeCode,'');assert.equal(x.page.data.hasCode,false);x.page.startVerification();assert.equal(x.page.data.showStudentVerifyDialog,true);
});
test('the two-step server verification gets a bounded 24 second timeout and never an automatic write retry',async()=>{
  let options;const loader=createLoader({}, {[path.join(root,'services/http.js')]:{request:async value=>{options=value;return{ok:true,status:'PENDING',rewardPoints:0,couponsIssued:0}}}});
  await loader.load('services/member-student.js').verifyStudentIdentity('granted-code','request-id-test');assert.equal(options.timeout,24000);assert.equal(options.retries,0);assert.equal(options.auth,'required');assert.equal(options.data.openid,undefined);
});
test('switching accounts clears the previous student certificate before any new account response arrives',async()=>{
  const x=fixture(undefined,{pagePath:'pages/member-student/index.js'});x.overview.student.valid=true;x.overview.student.certification={validUntil:'2027-04-17T00:00:00Z'};await x.page.loadOperations();assert.equal(x.page.data.studentValid,true);
  x.storage.set('merchantkit.user',{id:'new-student-account'});let resolve;x.service.fetchMemberOperations=()=>new Promise(done=>{resolve=done});const pending=x.page.loadOperations();
  assert.equal(x.page.data.studentValid,false);assert.equal(x.page.data.validUntilLabel,'');assert.equal(x.page.data.benefitsVisible,false);resolve({...x.overview,student:{...x.overview.student,valid:false}});await pending;assert.equal(x.page.data.studentValid,false);
});

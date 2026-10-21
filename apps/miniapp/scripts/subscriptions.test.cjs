const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
const plain=x=>JSON.parse(JSON.stringify(x));
const channelKeys=['new_product','restock','campaign','order_shipped','after_sales'];
function dto(patch={}){return {ok:true,settingsRevision:2,preferenceRevision:4,canSubscribe:true,authenticated:true,channels:channelKeys.map((key,index)=>({key,group:index<3?'brand':'order',title:key,description:'test',available:true,templateId:'template_'+key+'_1234567890',enabled:false,remaining:0})),...patch};}
function fixture(options={}){const calls=[],reads=[],toasts=[],settingsCalls=[],settingsReads=[],settingsOpens=[],clipboard=[],storage=options.storage||new Map();let owner=options.owner===undefined?'account-A':options.owner;let nextRead=dto(options.dtoPatch),nextSettings=options.settings===undefined?{mainSwitch:true}:options.settings,privacyAccepted=options.privacyAccepted!==false,runtimeInfo=options.runtimeInfo===undefined?{miniProgram:{envVersion:'trial',appId:'wx0000000000000000'}}:options.runtimeInfo;let nativeResolve,nativeReject,receiptAttempts=0;const overrides={};
 overrides[path.join(root,'stores/session.js')]={hasSession:()=>true,readAccessToken:()=> 'account-session'};
 overrides[path.join(root,'services/auth.js')]={getCachedUser:()=>({id:'account-A',phone:'13900000002'})};
 overrides[path.join(root,'stores/navigation.js')]={rememberMemberLoginReturn:route=>calls.push({remember:route})};
 overrides[path.join(root,'services/subscriptions.js')]={fetchSubscriptions:async()=>{reads.push('read');return nextRead;},subscriptionAccountId:()=>owner,loadPendingSubscriptionReceipt:id=>storage.get(id)||null,persistPendingSubscriptionReceipt:(id,receipt)=>{storage.set(id,plain(receipt));return true;},clearPendingSubscriptionReceipt:(id,nonce)=>{if(storage.get(id)?.requestId===nonce)storage.delete(id);},subscriptionRequestId:()=> 'subscribe_independent_nonce_123456789',requestNativeSubscriptions:ids=>{calls.push({native:plain(ids)});return new Promise((resolve,reject)=>{nativeResolve=resolve;nativeReject=reject;});},saveSubscriptionReceipt:async receipt=>{receiptAttempts++;calls.push({receipt:plain(receipt)});if(options.failFirstReceipt&&receiptAttempts===1)throw Error('NETWORK_REQUEST_FAILED');return options.receiptResult||dto({preferenceRevision:5});},saveSubscriptionPreferences:async (enabled,rev)=>{calls.push({preferences:plain(enabled),rev});return options.preferenceResult||dto({preferenceRevision:5});}};
 overrides[path.join(root,'stores/subscription-phone-return.js')]={rememberSubscriptionPhoneReturn:()=>calls.push({phoneReturn:true})};
 overrides[path.join(root,'stores/privacy-consent.js')]={isPrivacyAccepted:()=>privacyAccepted};
 const loader=createLoader({getAccountInfoSync:()=>{if(options.accountInfoThrows)throw Error('ACCOUNT_INFO_FAILED');return runtimeInfo;},getSystemInfoSync:()=>options.systemInfo||{platform:'ios',SDKVersion:'3.17.2',version:'8.0.64'},setClipboardData:options=>clipboard.push(options.data),getSetting:options.unsupportedSettings?undefined:nativeOptions=>{settingsCalls.push({read:nativeOptions.withSubscriptions});settingsReads.push(nativeOptions);if(options.settingsFail)nativeOptions.fail({errMsg:'PRIVATE_SETTING_FAIL'});else if(!options.deferSettings)nativeOptions.success({subscriptionsSetting:nextSettings});},openSetting:nativeOptions=>{settingsCalls.push({open:nativeOptions.withSubscriptions});settingsOpens.push(nativeOptions);if(options.openThrows)throw Error('OPEN_SETTING_FAILED');},showToast:value=>toasts.push(value.title),stopPullDownRefresh:()=>{},switchTab:value=>calls.push({switchTab:value.url}),navigateTo:value=>calls.push({navigateTo:value.url}),getStorageSync:()=>null,setStorageSync:()=>{},removeStorageSync:()=>{}},overrides);
 loader.load('pages/subscriptions/index.js');const page=loader.page;page.data=plain(page.data);page.setData=patch=>Object.assign(page.data,patch);page.onLoad();
 return {page,calls,reads,toasts,settingsCalls,settingsReads,settingsOpens,clipboard,storage,setOwner:value=>{owner=value;},setPrivacy:value=>{privacyAccepted=value;},setRuntime:value=>{runtimeInfo=value;},settingsNext:value=>{nextSettings=value;},readNext:value=>{nextRead=value;},resolveNative:results=>nativeResolve(results),rejectNative:error=>nativeReject(error)};
}
const settle=async()=>{await new Promise(setImmediate);await new Promise(setImmediate);};
test('subscriptions read and lifecycle never request native authorization',async()=>{const f=fixture();await f.page.load();assert.equal(f.calls.length,0);assert.equal(f.page.data.channels.length,5);});
test('native authorization begins synchronously from an explicit button gesture, maximum three brand templates',async()=>{const f=fixture();await f.page.load();f.page.subscribeBrand();assert.equal(f.calls.length,1);assert.equal(f.calls[0].native.length,3);f.resolveNative({[f.page.data.channels[0].templateId]:'accept'});await settle();assert.equal(f.calls.filter(x=>x.receipt).length,1);});

test('actual authorization markup uses one static gesture handler and a validated group dataset',()=>{const fs=require('node:fs'),xml=fs.readFileSync(path.join(root,'pages/subscriptions/index.wxml'),'utf8'),button=xml.match(/<button[^>]*class="primary-button subscriptions-authorize"[^>]*>/)?.[0];assert.ok(button);assert.match(button,/bindtap="subscribeSelectedGroup"/);assert.match(button,/data-group="\{\{group\.key\}\}"/);assert.match(button,/disabled="\{\{busy \|\| loading \|\| pendingReceipt \|\| !group\.ready\}\}"/);});

test('static group gesture synchronously reaches only its selected brand or order templates',async()=>{for(const [group,expected] of [['brand',channelKeys.slice(0,3)],['order',channelKeys.slice(3)]]){const f=fixture();await f.page.load();f.page.subscribeSelectedGroup({currentTarget:{dataset:{group}}});assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].native,expected.map(key=>'template_'+key+'_1234567890'));f.rejectNative({errMsg:'requestSubscribeMessage:fail cancel'});await settle();assert.equal(f.page.data.busy,false);assert.equal(f.calls.some(row=>row.receipt||row.preferences),false);}});

test('static gesture respects invalid group, disabled selection, loading, busy and pending receipt guards',async()=>{for(const mode of ['invalid','unselected','loading','busy','pending']){const f=fixture();await f.page.load();if(mode==='unselected')for(const key of channelKeys.slice(0,3))f.page.selectChannel({currentTarget:{dataset:{key}}});if(mode==='pending')f.page.pending={requestId:'already-pending'};if(['loading','busy'].includes(mode))f.page.data[mode]=true;f.page.subscribeSelectedGroup({currentTarget:{dataset:{group:mode==='invalid'?'injected':'brand'}}});assert.equal(f.calls.filter(row=>row.native).length,0,mode);}});
test('parallel subscription taps cannot request a second native grant',async()=>{const f=fixture();await f.page.load();f.page.subscribeBrand();f.page.subscribeBrand();assert.equal(f.calls.length,1);f.rejectNative({errMsg:'requestSubscribeMessage:fail cancel'});await settle();assert.equal(f.page.data.busy,false);});
test('native result cannot create a receipt for an unselected or unknown template',async()=>{const f=fixture();await f.page.load();f.page.subscribeBrand();f.resolveNative({unknown_template:'accept'});await settle();assert.equal(f.calls.some(x=>x.receipt),false);assert.match(f.page.data.notice,/本次未开启/);});
test('native cancel does not write a subscription receipt or preference',async()=>{const f=fixture();await f.page.load();f.page.subscribeBrand();f.rejectNative({errMsg:'requestSubscribeMessage:fail user cancel'});await settle();assert.equal(f.calls.some(x=>x.receipt||x.preferences),false);assert.equal(f.page.data.busy,false);});

test('short success feedback requires an accepted type with a server-confirmed usable grant',async()=>{for(const remaining of [0,1]){const result=dto({preferenceRevision:5});Object.assign(result.channels[0],{enabled:true,remaining});const f=fixture({receiptResult:result});await f.page.load();f.page.subscribeBrand();f.resolveNative({[f.page.data.channels[0].templateId]:'accept'});await settle();assert.deepEqual(f.toasts,[remaining?'提醒已开启':'未开启提醒']);assert.equal(f.page.data.pendingReceipt,false);}});

test('all rejected types report not enabled even when an older active preference is preserved',async()=>{const result=dto({preferenceRevision:5});Object.assign(result.channels[0],{enabled:true,remaining:1});const f=fixture({receiptResult:result});await f.page.load();f.page.subscribeBrand();f.resolveNative(Object.fromEntries(f.page.data.brandChannels.map(row=>[row.templateId,'reject'])));await settle();assert.deepEqual(f.toasts,['未开启提醒']);assert.equal(f.page.data.receivingCount,1);});

test('accepted permission awaiting receipt sync has a distinct short result and no automatic new authorization',async()=>{const f=fixture({failFirstReceipt:true});await f.page.load();f.page.subscribeBrand();f.resolveNative({[f.page.data.channels[0].templateId]:'accept'});await settle();assert.deepEqual(f.toasts,['授权待同步']);assert.equal(f.page.data.pendingReceipt,true);assert.equal(f.calls.filter(row=>row.native).length,1);});

test('native failure feedback includes only a finite bounded integer code and never raw payload text',async()=>{for(const [errCode,title] of [[20004,'授权未完成（20004）'],[-1,'授权未完成（-1）'],[Infinity,'授权未完成'],[1.5,'授权未完成'],[1000000,'授权未完成'],['PRIVATE_NATIVE_VALUE','授权未完成']]){const f=fixture();await f.page.load();f.page.subscribeBrand();f.rejectNative({errCode,errMsg:'PRIVATE_NATIVE_PAYLOAD'});await settle();assert.deepEqual(f.toasts,[title]);assert.doesNotMatch(f.toasts.join(''),/PRIVATE/);assert.equal(f.calls.some(row=>row.receipt),false);}});

test('late native feedback cannot toast on an unloaded page or a different account',async()=>{for(const change of [f=>f.page.onUnload(),f=>f.setOwner('account-B')]){const f=fixture();await f.page.load();f.page.subscribeBrand();change(f);f.rejectNative({errCode:20004,errMsg:'native failure'});await settle();assert.deepEqual(f.toasts,[]);assert.equal(f.calls.some(row=>row.receipt),false);}});
test('uncertain receipt retry keeps the original native nonce and never reopens authorization',async()=>{const f=fixture({failFirstReceipt:true});await f.page.load();f.page.subscribeBrand();f.resolveNative({[f.page.data.channels[0].templateId]:'accept'});await settle();assert.equal(f.page.data.pendingReceipt,true);await f.page.retryReceipt();assert.equal(f.calls.filter(x=>x.native).length,1);const receipts=f.calls.filter(x=>x.receipt);assert.equal(receipts.length,2);assert.equal(receipts[0].receipt.requestId,receipts[1].receipt.requestId);assert.equal(f.page.data.pendingReceipt,false);});
test('leaving during native authorization never writes a late receipt',async()=>{const f=fixture();await f.page.load();f.page.subscribeBrand();f.page.onUnload();f.resolveNative({[f.page.data.channels[0].templateId]:'accept'});await settle();assert.equal(f.calls.filter(x=>x.receipt).length,0);});
test('a switch without an available grant asks for native authorization without inventing a preference',async()=>{const f=fixture();await f.page.load();await f.page.changeEnabled({currentTarget:{dataset:{key:'new_product'}},detail:{value:true}});assert.equal(f.calls.length,0);assert.match(f.page.data.notice,/微信弹窗/);});
test('privacy link points to the existing miniprogram policy key',()=>{const f=fixture();f.page.openPrivacy();assert.equal(f.calls[0].navigateTo,'/pages/content/index?pageKey=miniprogram-privacy');});
test('all subscription service responses reject negative or missing revisions and boolean type drift',async()=>{const receipt={requestId:'subscribe_valid_independent_123456',expectedRevision:4,results:[{channel:'new_product',templateId:'template_new_product_1234567890',status:'accept'}]};for(const bad of [dto({preferenceRevision:-1}),dto({preferenceRevision:undefined}),dto({authenticated:'true'}),dto({canSubscribe:'true'})]){const overrides={};overrides[path.join(root,'services/http.js')]={request:async()=>bad};const service=createLoader({},overrides).load('services/subscriptions.js');await assert.rejects(()=>service.fetchSubscriptions());await assert.rejects(()=>service.saveSubscriptionReceipt(receipt));await assert.rejects(()=>service.saveSubscriptionPreferences([],4));}});
test('pending receipt survives page exit under the original account only',async()=>{const f=fixture({failFirstReceipt:true});await f.page.load();f.page.subscribeBrand();f.resolveNative({[f.page.data.channels[0].templateId]:'accept'});await settle();const original=f.storage.get('account-A');assert.ok(original);f.page.onUnload();const other=fixture({owner:'account-B',storage:f.storage});await other.page.load();assert.equal(other.page.data.pendingReceipt,false);assert.equal(other.calls.length,0);const resumed=fixture({storage:f.storage});await resumed.page.load();assert.equal(resumed.page.data.pendingReceipt,true);await resumed.page.retryReceipt();assert.equal(resumed.calls.filter(x=>x.native).length,0);assert.equal(resumed.calls.find(x=>x.receipt).receipt.requestId,original.requestId);assert.equal(f.storage.has('account-A'),false);});
test('a native result resolving after page exit is retained locally without a server write',async()=>{const f=fixture();await f.page.load();f.page.subscribeBrand();f.page.onUnload();f.resolveNative({[f.page.data.channels[0].templateId]:'accept'});await settle();assert.ok(f.storage.get('account-A'));assert.equal(f.calls.some(x=>x.receipt),false);});
test('account change during native permission cannot submit the old receipt to the new account',async()=>{const f=fixture();await f.page.load();f.page.subscribeBrand();f.setOwner('account-B');f.resolveNative({[f.page.data.channels[0].templateId]:'accept'});await settle();assert.ok(f.storage.get('account-A'));assert.equal(f.calls.some(x=>x.receipt),false);assert.equal(f.page.data.loggedIn,false);assert.equal(f.page.data.channels.length,0);});
test('customers can turn off an existing preference while the channel is temporarily unavailable',async()=>{const data=dto();data.channels[0]={...data.channels[0],available:false,templateId:null,enabled:true,remaining:1};const f=fixture({dtoPatch:data});await f.page.load();await f.page.changeEnabled({currentTarget:{dataset:{key:'new_product'}},detail:{value:false}});assert.deepEqual(f.calls.find(x=>x.preferences).preferences,[]);});
test('a signed-in account can withdraw an existing preference after phone or identity eligibility changes',async()=>{const data=dto({canSubscribe:false});data.channels[0]={...data.channels[0],enabled:true,remaining:1};const f=fixture({dtoPatch:data});await f.page.load();await f.page.changeEnabled({currentTarget:{dataset:{key:'new_product'}},detail:{value:false}});assert.deepEqual(f.calls.find(x=>x.preferences).preferences,[]);assert.equal(f.calls.some(x=>x.phoneReturn||x.native),false);});
test('phone-binding navigation has a dedicated one-shot intent instead of an immediate login-return loop',()=>{const f=fixture();f.page.bindPhone();assert.deepEqual(f.calls,[{phoneReturn:true},{switchTab:'/pages/account/index'}]);});

test('strict response validation rejects duplicate templates, wrong groups and invalid grant counts',()=>{
 const model=createLoader().load('models/subscriptions.js');
 for(const mutate of [value=>value.channels[1].templateId=value.channels[0].templateId,value=>value.channels[0].group='order',value=>value.channels[0].remaining=-1,value=>value.channels[0].remaining=1.5,value=>value.channels[0].enabled='false',value=>value.channels[0].available='true',value=>value.channels[0].templateId=null,value=>value.channels.pop(),value=>value.settingsRevision=Infinity]){const value=dto();mutate(value);assert.throws(()=>model.readSubscriptionResponse(value),/SUBSCRIPTION_RESPONSE_INVALID/);}
 const guest=dto({authenticated:false,canSubscribe:false});assert.equal(model.readSubscriptionResponse(guest).authenticated,false);
});

test('persistent receipts are scoped to one account and clearing cannot remove a newer nonce',()=>{
 const storage=new Map(),overrides={};let id='account-A';
 overrides[path.join(root,'stores/session.js')]={readAccessToken:()=> 'private-token-never-in-key',readStoredUser:()=>({id})};
 const loader=createLoader({getStorageSync:key=>storage.get(key),setStorageSync:(key,value)=>storage.set(key,plain(value)),removeStorageSync:key=>storage.delete(key)},overrides);
 const service=loader.load('services/subscriptions.js'),receipt={requestId:'subscribe_storage_nonce_12345678',expectedRevision:4,results:[{channel:'new_product',templateId:'template_new_product_1234567890',status:'accept'}]};
 assert.equal(service.subscriptionAccountId(),'account-A');assert.equal(service.persistPendingSubscriptionReceipt('account-A',receipt),true);
 assert.equal(service.loadPendingSubscriptionReceipt('account-B'),null);assert.equal(service.loadPendingSubscriptionReceipt('account-A').requestId,receipt.requestId);
 assert.equal([...storage.keys()].some(key=>key.includes('private-token')),false);
 service.clearPendingSubscriptionReceipt('account-A','subscribe_unrelated_nonce_123456');assert.ok(service.loadPendingSubscriptionReceipt('account-A'));
 const newer={...receipt,requestId:'subscribe_storage_newer_12345678'};service.persistPendingSubscriptionReceipt('account-A',newer);service.clearPendingSubscriptionReceipt('account-A',receipt.requestId);assert.equal(service.loadPendingSubscriptionReceipt('account-A').requestId,newer.requestId);
 service.clearPendingSubscriptionReceipt('account-A',newer.requestId);assert.equal(service.loadPendingSubscriptionReceipt('account-A'),null);
 id='account-B';assert.equal(service.subscriptionAccountId(),'account-B');
});

test('corrupt pending data and local storage failure do not become an accepted grant',()=>{
 const storage=new Map(),loader=createLoader({getStorageSync:key=>storage.get(key),setStorageSync:()=>{throw Error('quota');},removeStorageSync:key=>storage.delete(key)}),service=loader.load('services/subscriptions.js');
 assert.equal(service.persistPendingSubscriptionReceipt('account-A',{requestId:'short'}),false);
 storage.set('merchantkit.subscriptions.pending.v1.account-A',{ownerId:'account-B',receipt:{requestId:'forged'}});
 assert.equal(service.loadPendingSubscriptionReceipt('account-A'),null);assert.equal(storage.size,0);
 const receipt={requestId:'subscribe_storage_nonce_12345678',expectedRevision:4,results:[{channel:'new_product',templateId:'template_new_product_1234567890',status:'accept'}]};
 assert.equal(service.persistPendingSubscriptionReceipt('account-A',receipt),false);
});

test('native request rejects more than three or duplicate templates before calling WeChat',async()=>{
 let invoked=0;const service=createLoader({requestSubscribeMessage:opts=>{invoked++;opts.success({});}}).load('services/subscriptions.js');
 for(const templates of [[],['template_valid_1234','template_valid_1234'],['template_valid_1','template_valid_2','template_valid_3','template_valid_4'],['bad']])await assert.rejects(()=>service.requestNativeSubscriptions(templates),/SUBSCRIPTION_SELECTION_INVALID/);
 assert.equal(invoked,0);await service.requestNativeSubscriptions(['template_valid_1234']);assert.equal(invoked,1);
});

function phoneAccountFixture({guest=false,linkFails=false}={}){
 const calls=[];let logged=!guest,user=guest?null:{id:'account-A',phone:null};const overrides={};
 overrides[path.join(root,'stores/session.js')]={hasSession:()=>logged,readAccessToken:()=>logged?'same-account-token':'',readStoredUser:()=>user};
 overrides[path.join(root,'services/auth.js')]={getCachedUser:()=>user,fetchCurrentUser:async()=>user,loginWithWeChat:async()=>{logged=true;user={id:'account-A',phone:null};calls.push('login');return user;},linkWeChatPhone:async()=>{if(linkFails)throw Error('WECHAT_PHONE_CODE_INVALID');user={id:'merged-account',phone:'13900000002'};calls.push('bind');return user;},linkPhoneToAccount:async()=>{if(linkFails)throw Error('SMS_CODE_MISMATCH');user={id:'merged-account',phone:'13900000002'};calls.push('bind');return user;},logout:async()=>{logged=false;user=null;}};
 overrides[path.join(root,'services/guest-sync.js')]={syncGuestCart:async()=>calls.push('sync')};
 overrides[path.join(root,'services/member.js')]={fetchMemberPromotions:async()=>({}),fetchMember:async()=>({})};
 overrides[path.join(root,'services/member-profile.js')]={consumeProfileAccountReturn:()=>'',fetchMemberProfile:async()=>({profile:{displayName:''}})};
 overrides[path.join(root,'services/member-operations.js')]={fetchMemberOperations:async()=>({})};
 const loader=createLoader({pageScrollTo:()=>{},stopPullDownRefresh:()=>{},showToast:()=>{},showModal:async()=>({confirm:true}),navigateTo:value=>calls.push({url:value.url})},overrides);
 const intent=loader.load('stores/subscription-phone-return.js');intent.rememberSubscriptionPhoneReturn();
 loader.load('pages/account/index.js');const page=loader.page;page.setData=patch=>Object.assign(page.data,patch);
 return {page,calls,intent,setUser:value=>{user=value;},setLogged:value=>{logged=value;}};
}

test('logged-in unbound phone return opens existing panel and cancel or failure never loops back',async()=>{
 const f=phoneAccountFixture({linkFails:true});f.page.onShow();await settle();assert.equal(f.page.data.phoneLinkOpen,true);assert.equal(f.calls.some(x=>x.url),false);
 f.page.data.phoneConsent=true;await f.page.authorizePhone({detail:{errMsg:'getPhoneNumber:fail user deny'}});assert.equal(f.calls.some(x=>x.url),false);
 f.page.setData({phone:'13900000002',smsCode:'123456',smsSent:true});await f.page.verifyPhoneLink();assert.equal(f.calls.some(x=>x.url),false);assert.ok(f.page.data.error);
 f.page.closePhoneLink();assert.equal(f.page.loginReturnRoute,'');assert.equal(f.page.profileReturnAfterPhone,false);
});

test('guest subscription phone return waits through ordinary login until verified binding succeeds',async()=>{
 const f=phoneAccountFixture({guest:true});f.page.onShow();assert.equal(f.page.data.loginOpen,true);f.page.setData({consented:true,crossBorderConsented:true});await f.page.signIn();assert.equal(f.calls.some(x=>x.url),false);assert.equal(f.page.data.phoneLinkOpen,true);
 f.page.data.phoneConsent=true;await f.page.authorizePhone({detail:{code:'local-test-only'}});assert.equal(f.calls.filter(x=>x.url).length,1);assert.equal(f.calls.find(x=>x.url).url,'/pages/subscriptions/index');assert.equal(f.page.profileReturnAfterPhone,false);
});

test('phone return intent is cleared by account switch and explicit logout',async()=>{
 const changed=phoneAccountFixture();changed.setUser({id:'account-B',phone:'13900000002'});changed.page.onShow();await settle();assert.equal(changed.calls.some(x=>x.url),false);assert.equal(changed.page.loginReturnRoute,undefined);
 const consumed=phoneAccountFixture();consumed.page.onShow();await settle();consumed.setUser({id:'account-B',phone:'13900000002'});consumed.page.onShow();await settle();assert.equal(consumed.calls.some(x=>x.url),false);assert.equal(consumed.page.loginReturnRoute,'');
 const signedOut=phoneAccountFixture();signedOut.page.onShow();await settle();await signedOut.page.signOut();assert.equal(signedOut.page.loginReturnRoute,'');assert.equal(signedOut.intent.consumeSubscriptionPhoneReturn(),null);
});

test('presentation counts only currently receivable reminders while preserving withdrawal and restore controls',()=>{
 const model=createLoader().load('models/subscriptions.js'),value=dto();
 Object.assign(value.channels[0],{enabled:true,remaining:1});
 Object.assign(value.channels[1],{enabled:true,remaining:0});
 Object.assign(value.channels[2],{available:false,templateId:null,enabled:true,remaining:10});
 Object.assign(value.channels[3],{enabled:false,remaining:2});
 const presentation=model.subscriptionPresentation(value);
 assert.equal(presentation.availableCount,4);assert.equal(presentation.receivingCount,1);assert.equal(presentation.needsPermissionCount,1);
 assert.equal(presentation.summaryLabel,'4类可选 · 已开启1类');
 assert.deepEqual(plain(presentation.managementChannels.map(row=>row.key)),channelKeys.slice(0,4));
 assert.equal(presentation.channels[1].stateLabel,'未开启');assert.equal(presentation.channels[2].stateLabel,'暂未开放');assert.equal(presentation.channels[3].stateLabel,'未开启');
 assert.deepEqual(plain(presentation.managementChannels.map(row=>row.canManageSwitch)),[true,false,false,true]);
 assert.deepEqual(plain(presentation.managementChannels.map(row=>row.canDisablePreference)),[false,true,true,false]);
});

test('guest presentation describes availability without inventing account grants',()=>{
 const model=createLoader().load('models/subscriptions.js'),presentation=model.subscriptionPresentation(dto({authenticated:false,canSubscribe:false}));
 assert.equal(presentation.summaryLabel,'当前开放5类提醒');assert.equal(presentation.receivingCount,0);assert.equal(presentation.needsPermissionCount,0);assert.equal(presentation.managementChannels.length,0);
 assert.equal(presentation.channels.every(row=>row.stateLabel==='未开启'),true);
});

test('presentation describes merchant-published brand messages and leaves the validated DTO intact',()=>{
 const model=createLoader().load('models/subscriptions.js'),value=dto();
 value.channels[0].description='新品与系列上架时提醒';value.channels[2].description='活动开始时提醒';
 const parsed=model.readSubscriptionResponse(value),presentation=model.subscriptionPresentation(value);
 assert.equal(parsed.channels[0].description,'新品与系列上架时提醒');assert.equal(parsed.channels[2].description,'活动开始时提醒');
 assert.deepEqual(plain(presentation.brandChannels.map(row=>row.description)),['品牌发布新品与系列消息时提醒','品牌发布商品补货消息时提醒','品牌发布活动消息时提醒']);
 assert.equal(presentation.valueIntro,'新品上架、商品补货、品牌活动，选择你想知道的消息。');
 Object.assign(value.channels[1],{available:false,templateId:null});assert.equal(model.subscriptionPresentation(value).valueIntro,'新品上架、品牌活动，选择你想知道的消息。');
 for(const row of value.channels)Object.assign(row,{available:false,templateId:null});
 assert.equal(model.subscriptionPresentation(value).valueIntro,'当前暂无开放的提醒，可以稍后回来查看。');
});

test('local selection updates the selected count and confirmation label without requesting permission',async()=>{
 const f=fixture();await f.page.load();
 assert.equal(f.page.data.channelGroups[0].buttonLabel,'开启品牌提醒（3项）');
 f.page.selectChannel({currentTarget:{dataset:{key:'campaign'}}});
 assert.equal(f.page.data.brandSelectedCount,2);assert.equal(f.page.data.channelGroups[0].buttonLabel,'开启品牌提醒（2项）');
 for(const key of ['new_product','restock'])f.page.selectChannel({currentTarget:{dataset:{key}}});
 assert.equal(f.page.data.brandReady,false);assert.equal(f.page.data.channelGroups[0].buttonLabel,'开启品牌提醒（0项）');assert.equal(f.calls.length,0);
});

test('reminder management expansion stays local and is blocked during loading or pending authorization',async()=>{
 const f=fixture();await f.page.load();const selection=plain(f.page.data.channels.map(row=>row.selected));
 f.page.toggleManagement();assert.equal(f.page.data.managementOpen,true);f.page.toggleManagement();assert.equal(f.page.data.managementOpen,false);
 for(const flag of ['loading','busy']){f.page.data[flag]=true;f.page.toggleManagement();assert.equal(f.page.data.managementOpen,false);f.page.data[flag]=false;}
 f.page.pending={requestId:'local-pending'};f.page.toggleManagement();assert.equal(f.page.data.managementOpen,false);
 assert.deepEqual(plain(f.page.data.channels.map(row=>row.selected)),selection);assert.equal(f.calls.length,0);
});

function feedbackReceipt(statuses){return {requestId:'subscribe_feedback_nonce_12345678',expectedRevision:4,results:statuses.map((status,index)=>({channel:channelKeys[index],templateId:'template_'+channelKeys[index]+'_1234567890',status}))};}

test('receipt feedback names actual active types even when a new grant is declined',()=>{
 const model=createLoader().load('models/subscriptions.js'),value=dto();
 Object.assign(value.channels[0],{enabled:true,remaining:1});Object.assign(value.channels[1],{enabled:true,remaining:1});
 const feedback=model.subscriptionReceiptFeedback(feedbackReceipt(['accept','reject']),value);
 assert.equal(feedback,'已开启：上新、补货。');assert.doesNotMatch(feedback,/未开启|已关闭|永久|积分/);
});

test('all rejected receipt feedback preserves existing settings and claims no new grant',()=>{
 const model=createLoader().load('models/subscriptions.js'),value=dto();Object.assign(value.channels[0],{enabled:true,remaining:1});
 const feedback=model.subscriptionReceiptFeedback(feedbackReceipt(['reject','ban']),value);
 assert.equal(feedback,'已开启：上新。\n未开启：补货。');assert.doesNotMatch(feedback,/已关闭/);
});

test('an accepted receipt with no returned grant reports inactive reminders while preserving its saved receipt',async()=>{
 const model=createLoader().load('models/subscriptions.js'),value=dto();Object.assign(value.channels[0],{enabled:true,remaining:0});
 const feedback=model.subscriptionReceiptFeedback(feedbackReceipt(['accept']),value);assert.equal(feedback,'未开启：上新。');assert.doesNotMatch(feedback,/已开启：/);
 const f=fixture();await f.page.load();f.page.subscribeBrand();f.resolveNative({[f.page.data.channels[0].templateId]:'accept',[f.page.data.channels[1].templateId]:'reject'});await settle();
 assert.equal(f.page.data.notice,'未开启：上新、补货。');assert.equal(f.page.data.receivingCount,0);assert.equal(f.page.data.pendingReceipt,false);assert.equal(f.calls.filter(row=>row.receipt).length,1);
});

test('removing an unusable reminder preference uses the existing withdrawal path and removes its management row',async()=>{
 const data=dto({canSubscribe:false});Object.assign(data.channels[0],{enabled:true,available:false,templateId:null,remaining:1});
 const f=fixture({dtoPatch:data});await f.page.load();assert.equal(f.page.data.managementChannels[0].canDisablePreference,true);
 await f.page.disableReminder({currentTarget:{dataset:{key:'new_product'}}});
 assert.deepEqual(f.calls.find(row=>row.preferences).preferences,[]);assert.equal(f.page.data.managementChannels.some(row=>row.key==='new_product'),false);assert.equal(f.page.data.notice,'已移除：上新。');assert.equal(f.calls.some(row=>row.native),false);
});

test('native setting reads keep only the main switch and known template states in page memory',async()=>{
 const f=fixture({deferSettings:true});await f.page.load();
 const known=f.page.data.channels[0].templateId,unknown='UNRELATED_TEMPLATE_PRIVATE';
 const response={subscriptionsSetting:{mainSwitch:false,itemSettings:{[known]:'reject',[unknown]:'accept'}}};
 Object.defineProperty(response,'authSetting',{get(){throw Error('UNRELATED_SCOPE_READ');}});
 f.settingsReads[0].success(response);
 assert.deepEqual(plain(f.page.nativeSettings),{mainSwitch:false,items:{[known]:'reject'}});
 assert.equal(f.page.data.channelGroups[0].actionLabel,'微信接收设置');assert.equal(f.calls.length,0);assert.equal(f.storage.size,0);
 assert.doesNotMatch(JSON.stringify(f.page.data),/UNRELATED_TEMPLATE_PRIVATE|authSetting|mainSwitch|itemSettings/);
 f.page.onShow();await settle();assert.equal(f.settingsReads.length,2);assert.equal(f.calls.length,0);
});

test('a confirmed closed main switch sends each group gesture synchronously to settings only',async()=>{
 for(const group of ['brand','order']){
  const f=fixture({settings:{mainSwitch:false}});await f.page.load();
  assert.equal(f.page.data.channelGroups.find(row=>row.key===group).actionLabel,'微信接收设置');
  f.page.subscribeSelectedGroup({currentTarget:{dataset:{group}}});
  assert.equal(f.settingsOpens.length,1);assert.equal(f.settingsOpens[0].withSubscriptions,true);assert.equal(f.page.data.busy,true);assert.equal(f.calls.length,0);
 }
});

test('only a selected known remembered reject changes its group action and selection can remove it',async()=>{
 const f=fixture({settings:{mainSwitch:true,itemSettings:{template_campaign_1234567890:'reject',template_order_shipped_1234567890:'ban',unknown:'reject'}}});await f.page.load();
 assert.equal(f.page.data.channelGroups[0].actionLabel,'微信接收设置');assert.equal(f.page.data.channelGroups[1].actionLabel,'开启订单提醒（2项）');
 f.page.selectChannel({currentTarget:{dataset:{key:'campaign'}}});
 assert.equal(f.page.data.channelGroups[0].actionLabel,'开启品牌提醒（2项）');
 f.page.subscribeSelectedGroup({currentTarget:{dataset:{group:'brand'}}});
 assert.equal(f.calls.filter(row=>row.native).length,1);assert.equal(f.settingsOpens.length,0);assert.equal(f.calls[0].native.length,2);
});

test('missing, accepted and banned remembered states do not invent a settings block or server grant',async()=>{
 for(const settings of [undefined,{}, {mainSwitch:true},{mainSwitch:'false'}, ...['accept','ban','filter','unexpected'].map(value=>({mainSwitch:true,itemSettings:{template_new_product_1234567890:value}}))]){
  const f=fixture({settings});await f.page.load();assert.equal(f.page.data.channelGroups[0].actionLabel,'开启品牌提醒（3项）');
  assert.equal(f.page.data.receivingCount,0);assert.equal(f.page.data.channels.every(row=>row.stateLabel==='未开启'),true);assert.equal(f.calls.length,0);
  f.page.subscribeSelectedGroup({currentTarget:{dataset:{group:'brand'}}});assert.equal(f.calls.filter(row=>row.native).length,1);assert.equal(f.settingsOpens.length,0);
 }
});

test('all rejected group results with unknown settings retain a fresh explicit authorization gesture',async()=>{
 for(const group of ['brand','order']){
  const f=fixture({settings:{mainSwitch:true}});await f.page.load();f.page.subscribeSelectedGroup({currentTarget:{dataset:{group}}});
  const channels=f.page.data.channels.filter(row=>row.group===group);
  f.resolveNative(Object.fromEntries(channels.map(row=>[row.templateId,'reject'])));await settle();
  assert.deepEqual(f.toasts,['未开启提醒']);assert.equal(f.settingsOpens.length,0);assert.equal(f.page.data.receivingCount,0);
  assert.equal(f.page.data.channelGroups.find(row=>row.key===group).actionLabel,group==='brand'?'开启品牌提醒（3项）':'开启订单提醒（2项）');
  assert.equal(f.calls.filter(row=>row.receipt).length,1);assert.equal(f.calls.filter(row=>row.native).length,1);
  f.page.subscribeSelectedGroup({currentTarget:{dataset:{group}}});assert.equal(f.calls.filter(row=>row.native).length,2);
 }
});

test('a mixture of rejection, filtered or banned results is not reclassified as a whole rejected group',async()=>{
 for(const other of ['accept','ban','filter',undefined]){
  const f=fixture();await f.page.load();f.page.subscribeBrand();
  f.resolveNative({[f.page.data.channels[0].templateId]:'reject',[f.page.data.channels[1].templateId]:other,[f.page.data.channels[2].templateId]:'reject'});await settle();
  assert.equal(f.page.data.channelGroups[0].actionLabel,'开启品牌提醒（3项）');assert.equal(f.settingsOpens.length,0);
 }
});

test('settings return refreshes native and server state without treating an accepted setting as authorization',async()=>{
 for(const stillBlocked of [false,true]){
  const f=fixture({settings:{mainSwitch:false}});await f.page.load();f.page.subscribeBrand();
  const before=f.reads.length;f.page.onShow();assert.equal(f.reads.length,before);assert.equal(f.page.data.busy,true);
  f.settingsNext(stillBlocked?{mainSwitch:false}:{mainSwitch:true,itemSettings:{template_new_product_1234567890:'accept'}});
  f.settingsOpens[0].success({subscriptionsSetting:{mainSwitch:true,itemSettings:{template_new_product_1234567890:'accept'}}});await settle();f.page.onShow();await settle();
  assert.equal(f.page.data.channelGroups[0].actionLabel,stillBlocked?'微信接收设置':'开启品牌提醒（3项）');
  assert.equal(f.page.data.receivingCount,0);assert.equal(f.calls.length,0);assert.equal(f.storage.size,0);assert.equal(f.page.data.busy,false);
 }
});

test('settings action retains loading, busy, pending, empty-selection and invalid-group guards',async()=>{
 for(const mode of ['loading','busy','pending','empty','invalid']){
  const f=fixture({settings:{mainSwitch:false}});await f.page.load();
  if(mode==='pending'){f.page.pending={requestId:'existing-pending'};f.page.setData({pendingReceipt:true});}
  if(mode==='loading'||mode==='busy')f.page.data[mode]=true;
  if(mode==='empty')for(const key of channelKeys.slice(0,3))f.page.selectChannel({currentTarget:{dataset:{key}}});
  f.page.subscribeSelectedGroup({currentTarget:{dataset:{group:mode==='invalid'?'untrusted':'brand'}}});assert.equal(f.settingsOpens.length,0,mode);assert.equal(f.calls.length,0,mode);
 }
});

test('settings API failure and synchronous exceptions release busy state and retain an explicit retry path',async()=>{
 for(const throws of [false,true]){
  const f=fixture({settings:{mainSwitch:false},openThrows:throws});await f.page.load();f.page.subscribeBrand();
  if(!throws)f.settingsOpens[0].fail({errMsg:'PRIVATE_NATIVE_FAILURE'});await settle();
  assert.equal(f.page.data.busy,false);assert.equal(f.page.data.loading,false);assert.equal(f.page.data.channelGroups[0].actionLabel,'微信接收设置');assert.equal(f.calls.length,0);
  assert.deepEqual(f.toasts,['设置未打开，请重试']);assert.doesNotMatch(JSON.stringify(f.page.data),/PRIVATE_NATIVE_FAILURE/);
 }
});

test('unloaded or changed accounts cannot receive late native setting results or a settings-return refresh',async()=>{
 for(const kind of ['unload','account']){
  const f=fixture({deferSettings:true});await f.page.load();const initial=f.settingsReads[0];
  if(kind==='unload')f.page.onUnload();else f.setOwner('account-B');initial.success({subscriptionsSetting:{mainSwitch:false}});
  assert.equal(f.page.nativeSettings,null);
  const g=fixture({settings:{mainSwitch:false}});await g.page.load();g.page.subscribeBrand();const before=g.reads.length;
  if(kind==='unload')g.page.onUnload();else g.setOwner('account-B');g.settingsOpens[0].success({});await settle();
  assert.equal(g.reads.length,before);assert.equal(g.calls.length,0);assert.equal(g.storage.size,0);
 }
});

test('a new account shown while settings is open resets the old operation and ignores its eventual completion',async()=>{
 const f=fixture({settings:{mainSwitch:false}});await f.page.load();f.page.subscribeBrand();f.setOwner('account-B');f.settingsNext({mainSwitch:true});f.page.onShow();await settle();
 assert.equal(f.page.scopeOwner,'account-B');assert.equal(f.page.data.busy,false);assert.equal(f.page.data.channelGroups[0].actionLabel,'开启品牌提醒（3项）');
 const reads=f.reads.length;f.settingsOpens[0].success({subscriptionsSetting:{mainSwitch:false}});await settle();assert.equal(f.reads.length,reads);assert.equal(f.page.data.busy,false);assert.equal(f.calls.length,0);
});

test('older or changed-template native reads are ignored and a pending gesture invalidates earlier setting snapshots',async()=>{
 const f=fixture({deferSettings:true});await f.page.load();const old=f.settingsReads[0];
 const next=dto();next.channels[0].templateId='new_template_new_product_9876543210';f.readNext(next);await f.page.load();
 old.success({subscriptionsSetting:{mainSwitch:false}});assert.equal(f.page.nativeSettings,null);
 const newer=f.settingsReads.at(-1);newer.success({subscriptionsSetting:{mainSwitch:true,itemSettings:{template_new_product_1234567890:'reject'}}});assert.deepEqual(plain(f.page.nativeSettings.items),{});
 f.page.readReceiveSettings();const beforeGesture=f.settingsReads.at(-1);f.page.subscribeBrand();beforeGesture.success({subscriptionsSetting:{mainSwitch:false}});
 assert.equal(f.page.nativeSettings.mainSwitch,true);assert.equal(f.calls.filter(row=>row.native).length,1);assert.equal(f.settingsOpens.length,0);
});

test('privacy consent and a current authenticated account are required before reading or opening native receive settings',async()=>{
 const f=fixture({privacyAccepted:false,settings:{mainSwitch:false}});await f.page.load();assert.equal(f.settingsCalls.length,0);f.page.openReceiveSettings();assert.equal(f.settingsCalls.length,0);
 f.setPrivacy(true);f.page.readReceiveSettings();assert.equal(f.settingsReads.length,1);f.setPrivacy(false);f.page.openReceiveSettings();assert.equal(f.settingsOpens.length,0);
 const late=fixture({deferSettings:true});await late.page.load();late.setPrivacy(false);late.settingsReads[0].success({subscriptionsSetting:{mainSwitch:false}});assert.equal(late.page.nativeSettings,null);
 const guest=fixture({owner:'',dtoPatch:{authenticated:false,canSubscribe:false}});await guest.page.load();guest.page.openReceiveSettings();assert.equal(guest.settingsCalls.length,0);
});

test('diagnostic is unavailable before an attempt and hard-disabled for release or unconfirmed runtime identity',async()=>{
 for(const options of [{runtimeInfo:{miniProgram:{envVersion:'release',appId:'wx0000000000000000'}}},{runtimeInfo:null},{runtimeInfo:{miniProgram:{envVersion:'trial'}}},{runtimeInfo:{miniProgram:{envVersion:'trial',appId:'malformed'}}},{accountInfoThrows:true}]){
  const f=fixture(options);await f.page.load();assert.equal(f.page.data.diagnosticAvailable,false);f.page.copyDiagnostic();assert.equal(f.clipboard.length,0);
  f.page.subscribeBrand();f.rejectNative({errCode:20004,errMsg:'PRIVATE_NATIVE_FAIL'});await settle();f.page.copyDiagnostic();assert.equal(f.page.data.diagnosticAvailable,false);assert.equal(f.clipboard.length,0);assert.equal(f.page.diagnostic,null);assert.equal(f.calls.some(row=>row.receipt),false);
 }
});

test('trial diagnostics copy only safe native and settings projections after a user attempt',async()=>{
 const f=fixture({settings:{mainSwitch:true,itemSettings:{template_new_product_1234567890:'accept',template_order_shipped_1234567890:'ban',PRIVATE_TEMPLATE:'accept'}}});await f.page.load();f.page.subscribeBrand();
 const [a,b,c]=f.page.data.brandChannels;
 f.resolveNative({errMsg:'requestSubscribeMessage:ok',[a.templateId]:'reject',[b.templateId]:'filter',[c.templateId]:'ban',PRIVATE_TEMPLATE:'accept',authSetting:{PRIVATE_SCOPE:true},openid:'PRIVATE_USER',access_token:'PRIVATE_TOKEN'});await settle();
 assert.equal(f.page.data.diagnosticAvailable,true);assert.equal(f.clipboard.length,0);f.page.copyDiagnostic();assert.equal(f.clipboard.length,1);
 const value=JSON.parse(f.clipboard[0]);assert.deepEqual(Object.keys(value).sort(),['appVersion','platform','SDKVersion','wechatVersion','runtimeAppIdMatches','settings','native'].sort());
 assert.equal(value.appVersion,require('../package.json').version);assert.equal(value.platform,'ios');assert.equal(value.SDKVersion,'3.17.2');assert.equal(value.wechatVersion,'8.0.64');assert.equal(value.runtimeAppIdMatches,true);
 assert.deepEqual(value.settings,{status:'success',settingPhase:'success_with_subscriptions',mainSwitch:true,items:{new_product:'accept',restock:'unknown',campaign:'unknown',order_shipped:'ban',after_sales:'unknown'}});
 assert.deepEqual(value.native,{phase:'success',channels:{new_product:'reject',restock:'filter',campaign:'ban'},errCode:null,ok:true});
 assert.doesNotMatch(f.clipboard[0],/PRIVATE|template_|wx0b|account-A|authSetting|openid|access_token/);assert.equal(f.page.data.receivingCount,0);assert.equal(f.calls.filter(row=>row.receipt).length,1);
 assert.equal(f.storage.size,0);assert.equal(f.settingsOpens.length,0);assert.equal(f.calls.filter(row=>row.native).length,1);
});

test('diagnostics limit platform, version and native error values without exposing raw failures',async()=>{
 for(const [errCode,expected] of [[20004,20004],[-1,-1],[Infinity,null],[1.5,null],[1000000,null],['20004',null]]){
  const f=fixture({runtimeInfo:{miniProgram:{envVersion:'develop',appId:'wx2222222222222222'}},systemInfo:{platform:'PRIVATE_PLATFORM',SDKVersion:'3.17.2 PRIVATE',version:'9'.repeat(33)}});await f.page.load();f.page.subscribeOrder();f.rejectNative({errCode,errMsg:'PRIVATE_NATIVE_FAIL'});await settle();f.page.copyDiagnostic();
  const value=JSON.parse(f.clipboard[0]);assert.equal(value.platform,'unknown');assert.equal(value.SDKVersion,null);assert.equal(value.wechatVersion,null);assert.equal(value.runtimeAppIdMatches,false);
  assert.deepEqual(value.native,{phase:'fail',channels:{order_shipped:'unknown',after_sales:'unknown'},errCode:expected,ok:false});assert.doesNotMatch(f.clipboard[0],/PRIVATE|template_|account-A/);assert.equal(f.calls.some(row=>row.receipt),false);
 }
});

test('diagnostics distinguish missing subscription data, failed or unsupported native reads and unresolved reads',async()=>{
 for(const [options,status,settingPhase] of [[{settings:null},'success','success_without_subscriptions'],[{settingsFail:true},'fail','fail'],[{unsupportedSettings:true},'unsupported','unsupported'],[{deferSettings:true},null,'pending']]){
  const f=fixture(options);await f.page.load();f.page.subscribeBrand();f.rejectNative({errCode:20004,errMsg:'PRIVATE_NATIVE_FAIL'});await settle();f.page.copyDiagnostic();
  const value=JSON.parse(f.clipboard[0]);assert.equal(value.settings.status,status);assert.equal(value.settings.settingPhase,settingPhase);assert.equal(value.settings.mainSwitch,null);assert.equal(Object.values(value.settings.items).every(value=>value==='unknown'),true);assert.equal(f.page.data.channelGroups[0].actionLabel,'开启品牌提醒（3项）');
 }
});

test('late native diagnostic results cannot appear after hide, unload, account change or a template replacement',async()=>{
 for(const mutate of [f=>f.page.onHide(),f=>f.page.onUnload(),f=>f.setOwner('account-B'),f=>{f.page.current.channels[0].templateId='replaced_template_1234567890';}]){
  const f=fixture();await f.page.load();f.page.subscribeBrand();mutate(f);f.rejectNative({errCode:20004,errMsg:'PRIVATE_NATIVE_FAIL'});await settle();f.page.copyDiagnostic();assert.equal(f.page.data.diagnosticAvailable,false);assert.equal(f.page.diagnostic,null);assert.equal(f.clipboard.length,0);
 }
});

test('copy rechecks release, privacy, visibility and account and never changes subscription state',async()=>{
 for(const mutate of [f=>f.setRuntime({miniProgram:{envVersion:'release',appId:'wx0000000000000000'}}),f=>f.setPrivacy(false),f=>f.setOwner('account-B'),f=>f.page.onHide(),f=>f.page.onUnload()]){
  const f=fixture();await f.page.load();f.page.subscribeBrand();f.rejectNative({errCode:20004});await settle();assert.equal(f.page.data.diagnosticAvailable,true);const calls=f.calls.length;
  mutate(f);f.page.copyDiagnostic();assert.equal(f.clipboard.length,0);assert.equal(f.page.data.diagnosticAvailable,false);assert.equal(f.calls.length,calls);assert.equal(f.storage.size,0);
 }
});

test('diagnostic copy honors disabled UI while busy or loading and is rendered only behind the attempt flag',async()=>{
 const f=fixture();await f.page.load();f.page.subscribeBrand();f.rejectNative({errCode:20004});await settle();
 for(const flag of ['busy','loading']){f.page.data[flag]=true;f.page.copyDiagnostic();assert.equal(f.clipboard.length,0);f.page.data[flag]=false;}f.page.copyDiagnostic();assert.equal(f.clipboard.length,1);
 const xml=require('node:fs').readFileSync(path.join(root,'pages/subscriptions/index.wxml'),'utf8');assert.match(xml,/wx:if="\{\{diagnosticAvailable\}\}"[^>]*><button[^>]*disabled="\{\{busy \|\| loading\}\}"[^>]*bindtap="copyDiagnostic"/);
});

test('receipt and preference DTO template replacements invalidate captured diagnostic and copy rechecks its private fingerprint',async()=>{
 const replaced=dto({preferenceRevision:5});replaced.channels[0].templateId='new_template_new_product_9876543210';
 for(const operation of ['receipt','preference','copy']){
  const f=fixture({receiptResult:operation==='receipt'?replaced:undefined,preferenceResult:replaced});await f.page.load();f.page.subscribeBrand();
  if(operation==='receipt')f.resolveNative({[f.page.data.channels[0].templateId]:'accept',errMsg:'requestSubscribeMessage:ok'});else f.rejectNative({errCode:20004});await settle();
  if(operation==='preference'){assert.equal(f.page.data.diagnosticAvailable,true);await f.page.changeEnabled({currentTarget:{dataset:{key:'new_product'}},detail:{value:false}});}
  if(operation==='copy'){assert.equal(f.page.data.diagnosticAvailable,true);f.page.current.channels[0].templateId=replaced.channels[0].templateId;}
  f.page.copyDiagnostic();assert.equal(f.page.data.diagnosticAvailable,false,operation);assert.equal(f.page.diagnostic,null,operation);assert.equal(f.page.diagnosticTemplateFingerprint,'',operation);assert.equal(f.clipboard.length,0,operation);assert.equal(f.calls.filter(row=>row.native).length,1);
 }
});

test('a finished attempt replaces its cancelled settings read once without another authorization or receipt',async()=>{
 const f=fixture({deferSettings:true});await f.page.load();assert.equal(f.settingsReads.length,1);f.page.subscribeBrand();f.rejectNative({errCode:20004});await settle();
 assert.equal(f.page.data.busy,false);assert.equal(f.settingsReads.length,2);assert.equal(f.page.diagnostic.settings.settingPhase,'pending');
 f.settingsReads[0].success({subscriptionsSetting:{mainSwitch:false}});assert.equal(f.page.nativeSettings,null);
 f.settingsReads[1].success({subscriptionsSetting:{mainSwitch:true}});
 assert.equal(f.page.diagnostic.settings.settingPhase,'success_with_subscriptions');assert.equal(f.page.diagnostic.settings.status,'success');assert.equal(f.page.diagnostic.settings.mainSwitch,true);
 assert.equal(f.calls.filter(row=>row.native).length,1);assert.equal(f.calls.some(row=>row.receipt||row.preferences),false);assert.equal(f.reads.length,1);assert.equal(f.settingsOpens.length,0);
});

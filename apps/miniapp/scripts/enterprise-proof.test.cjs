const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {createLoader,root}=require('./test-loader.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
const proof=letter=>({id:'msu_'+letter.repeat(32),url:'/api/miniprogram/member-operations/proofs/msu_'+letter.repeat(32)});
const event=dataset=>({currentTarget:{dataset}});
const item=(letter='a',uploaded=false)=>({localId:'local_'+letter,localPath:'wxfile://tmp/'+letter+'.jpg',uploadRequestId:'request_'+letter.repeat(10),...(uploaded?proof(letter):{id:'',url:''}),existing:false});
function overview(patch={}){return {ok:true,registered:true,pointsBalance:0,tasks:[{key:'ENTERPRISE',title:'添加品牌企微',enabled:true,state:'AVAILABLE',rewardPoints:50}],shoppingRule:{},enterpriseContact:{enabled:true,name:'品牌顾问',qrImageUrl:''},myApplications:[],posts:[],myPosts:[],myComments:[],lotteries:[],surveys:[],...patch};}
function fixture(options={}){
 let value=options.value||overview(),selection;const calls=[],uploads=[],removals=[],downloads=[],previews=[];
 const store=options.store||new Map([['merchantkit.session',{accessToken:'local-only',expiresAt:'2099-01-01'}],['merchantkit.user',{id:'A'}]]);
 const wx={getStorageSync:key=>store.get(key),setStorageSync:(key,v)=>store.set(key,plain(v)),removeStorageSync:key=>store.delete(key),chooseMedia:input=>{selection=input;},previewImage:input=>previews.push(plain(input)),pageScrollTo(){},switchTab(){},navigateTo(){}};
 const service={fetchMemberOperations:async()=>plain(value),memberOperation:async(action,payload)=>{calls.push({action,payload:plain(payload)});if(options.action)return options.action(action,payload);const application={id:'APP1',taskKey:'ENTERPRISE',status:'PENDING',revision:(payload.expectedRevision||0)+1,note:'',proofs:payload.detail.proofKeys.map(id=>({id,url:'/api/miniprogram/member-operations/proofs/'+id}))};value={...value,myApplications:[application]};return {ok:true,application};}};
 const proofService={uploadSocialProof:async(...args)=>{uploads.push(args);return options.upload?options.upload(...args):proof(String.fromCharCode(96+uploads.length));},downloadSocialProof:async input=>{downloads.push(plain(input));return options.download?options.download(input):'wxfile://tmp/private.jpg';},removeUnusedSocialProof:async input=>{removals.push(plain(input));if(options.remove)return options.remove(input);}};
 const loader=createLoader(wx,{[path.join(root,'services/member-operations.js')]:service,[path.join(root,'services/member-social.js')]:proofService});loader.load('pages/member-earn/index.js');const page=loader.page;page.data=plain(page.data);page.setData=patch=>Object.assign(page.data,patch);page.onLoad({contact:'ENTERPRISE'});
 return {page,calls,uploads,removals,downloads,previews,store,loader,get selection(){return selection;},setValue:next=>{value=next;}};
}

test('an enabled official enterprise plugin supports the task without a redundant QR configuration',async()=>{
 const f=fixture();await f.page.loadOperations();assert.equal(f.page.data.contactAvailable,true);assert.equal(f.page.data.contactQrAvailable,false);assert.equal(f.page.data.contactCanSubmit,true);assert.equal(f.calls.length,0);
 for(const value of [overview({enterpriseContact:{enabled:false,qrImageUrl:''}}),overview({tasks:[{key:'ENTERPRISE',enabled:false,state:'DISABLED'}]}),overview({registered:false})]){const disabled=fixture({value});await disabled.page.loadOperations();disabled.page.setData({contactProofItems:[item()]});await disabled.page.submitContact();assert.equal(disabled.calls.length,0);assert.equal(disabled.uploads.length,0);}
});

test('enterprise verification requires one to three actual screenshots before submission',async()=>{
 const f=fixture();await f.page.loadOperations();await f.page.submitContact();assert.match(f.page.data.error,/1—3张/);f.page.setData({contactProofItems:['a','b','c','d'].map(letter=>item(letter))});await f.page.submitContact();assert.equal(f.calls.length,0);assert.equal(f.uploads.length,0);
});

test('selecting and removing a local screenshot never submits or awards the task',async()=>{
 const f=fixture();await f.page.loadOperations();f.page.chooseContactProof();assert.equal(f.selection.count,3);f.selection.success({tempFiles:[{tempFilePath:'wxfile://tmp/a.jpg',size:1000}]});assert.equal(f.page.data.contactProofItems.length,1);assert.equal(f.uploads.length,0);assert.equal(f.calls.length,0);
 await f.page.removeContactProof(event({index:0}));assert.equal(f.page.data.contactProofItems.length,0);assert.equal(f.removals.length,0);
 f.page.chooseContactProof();f.selection.success({tempFiles:[{tempFilePath:'wxfile://tmp/large.jpg',size:4*1024*1024}]});assert.equal(f.page.data.contactProofItems.length,0);assert.match(f.page.data.error,/3MB/);
});

test('valid enterprise evidence uploads privately under ENTERPRISE and submits real keys for manual review',async()=>{
 const f=fixture();await f.page.loadOperations();f.page.setData({contactNote:' 我的昵称 ',contactProofItems:[item()]});await f.page.submitContact();
 assert.equal(f.uploads.length,1);assert.equal(f.uploads[0][2],'ENTERPRISE');assert.deepEqual(f.calls,[{action:'submit_application',payload:{taskKey:'ENTERPRISE',detail:{note:'我的昵称',proofKeys:[proof('a').id]}}}]);
 assert.equal(f.page.data.contactProofItems.length,0);assert.equal(f.page.data.contactApplication.status,'PENDING');assert.match(f.page.data.notice,/人工核验/);assert.equal(f.page.data.overview.pointsBalance,0);assert.equal(f.page.data.busy,false);
});

test('pending and approved enterprise applications cannot be submitted again',async()=>{
 for(const status of ['PENDING','APPROVED']){const f=fixture({value:overview({myApplications:[{id:'APP1',taskKey:'ENTERPRISE',status,revision:1,proofs:[proof('a')]}]})});await f.page.loadOperations();f.page.setData({contactProofItems:[item()]});f.page.chooseContactProof();await f.page.submitContact();assert.equal(f.calls.length,0);assert.equal(f.uploads.length,0);assert.equal(f.selection,undefined);}
});

test('rejected enterprise applications retain revision and private historical proof access',async()=>{
 const f=fixture({value:overview({myApplications:[{id:'APP1',taskKey:'ENTERPRISE',status:'REJECTED',revision:4,proofs:[proof('b')],note:'请补充截图'}]})});await f.page.loadOperations();await f.page.previewContactProof(event({id:proof('b').id}));assert.deepEqual(f.downloads,[proof('b')]);assert.deepEqual(f.previews,[{current:'wxfile://tmp/private.jpg',urls:['wxfile://tmp/private.jpg']}]);
 f.page.setData({contactProofItems:[item('a',true)]});await f.page.submitContact();assert.equal(f.calls[0].payload.expectedRevision,4);assert.equal(f.uploads.length,0);
});

test('a failed partial upload preserves the first proof and retries only the unfinished image',async()=>{
 let attempt=0;const f=fixture({upload:async()=>{attempt++;if(attempt===2)throw Error('SOCIAL_PROOF_UPLOAD_FAILED');return proof(attempt===1?'a':'b');}});await f.page.loadOperations();f.page.setData({contactProofItems:[item('a'),item('b')]});await f.page.submitContact();assert.equal(f.calls.length,0);assert.equal(f.page.data.contactProofItems[0].id,proof('a').id);assert.equal(f.page.data.contactUploading,false);
 await f.page.submitContact();assert.equal(f.uploads.length,3);assert.equal(f.uploads[1][1],f.uploads[2][1]);assert.deepEqual(f.calls[0].payload.detail.proofKeys,[proof('a').id,proof('b').id]);
});

test('double taps and edits are locked while a screenshot upload is running',async()=>{
 let finish;const f=fixture({upload:()=>new Promise(resolve=>{finish=resolve;})});await f.page.loadOperations();f.page.setData({contactProofItems:[item()],contactNote:'原昵称',overview:{...f.page.data.overview,profileClaimable:true}});const first=f.page.submitContact();await f.page.submitContact();await f.page.claimProfile();f.page.changeContactNote({detail:{value:'被阻止'}});assert.equal(f.page.data.contactNote,'原昵称');assert.equal(f.uploads.length,1);finish(proof('a'));await first;assert.equal(f.calls.length,1);
});

test('an ambiguous enterprise result keeps the exact payload across reopen and isolates another account',async()=>{
 const f=fixture({action:async()=>{throw Error('NETWORK_REQUEST_FAILED');}});await f.page.loadOperations();f.page.setData({contactProofItems:[item('a',true)]});await f.page.submitContact();assert.equal(f.page.data.contactPendingReady,true);const original=plain(f.calls[0].payload);
 const other=fixture({store:f.store});other.store.set('merchantkit.user',{id:'B'});await other.page.loadOperations();assert.equal(other.page.data.contactPendingReady,false);assert.equal(other.calls.length,0);
 other.store.set('merchantkit.user',{id:'A'});const resumed=fixture({store:f.store});await resumed.page.loadOperations();await resumed.page.retryContactSubmission();assert.deepEqual(resumed.calls[0].payload,original);assert.equal(resumed.uploads.length,0);assert.equal(resumed.page.data.contactPendingReady,false);
});

test('a confirmed enterprise receipt clears ambiguity without creating another application',async()=>{
 const f=fixture({action:async()=>{throw Error('NETWORK_REQUEST_FAILED');}});await f.page.loadOperations();f.page.setData({contactProofItems:[item('a',true)]});await f.page.submitContact();f.setValue(overview({myApplications:[{id:'APP1',taskKey:'ENTERPRISE',status:'PENDING',revision:1,proofs:[proof('a')]}]}));await f.page.loadOperations();assert.equal(f.page.data.contactPendingReady,false);assert.equal(f.page.pendingContact,null);assert.equal(f.calls.length,1);
});

test('a definitive server rejection unlocks material changes while an invalid response never claims success',async()=>{
 const denied=fixture({action:async()=>{throw Error('INVALID_MEMBER_OPERATION');}});await denied.page.loadOperations();denied.page.setData({contactProofItems:[item('a',true)]});await denied.page.submitContact();assert.equal(denied.page.data.contactPendingReady,false);denied.page.changeContactNote({detail:{value:'可修改'}});assert.equal(denied.page.data.contactNote,'可修改');
 const invalid=fixture({action:async()=>({ok:true})});await invalid.page.loadOperations();invalid.page.setData({contactProofItems:[item('a',true)]});await invalid.page.submitContact();assert.equal(invalid.page.data.contactPendingReady,true);assert.equal(invalid.page.data.notice,'');assert.equal(invalid.page.data.overview.pointsBalance,0);
});

test('late selection and upload callbacks cannot move another account evidence into the current account',async()=>{
 const selected=fixture();await selected.page.loadOperations();selected.page.chooseContactProof();selected.store.set('merchantkit.user',{id:'B'});await selected.page.loadOperations();selected.selection.success({tempFiles:[{tempFilePath:'wxfile://tmp/A.jpg',size:1000}]});assert.equal(selected.page.data.contactProofItems.length,0);
 let finish;const upload=fixture({upload:()=>new Promise(resolve=>{finish=resolve;})});await upload.page.loadOperations();upload.page.setData({contactProofItems:[item()]});const pending=upload.page.submitContact();upload.store.set('merchantkit.user',{id:'B'});await upload.page.loadOperations();finish(proof('a'));await pending;assert.equal(upload.calls.length,0);assert.equal(upload.page.data.contactProofItems.length,0);assert.equal(upload.page.data.contactUploading,false);
});

test('a late private preview after account switching never displays the previous account screenshot',async()=>{
 let finish;const f=fixture({value:overview({myApplications:[{id:'APP1',taskKey:'ENTERPRISE',status:'PENDING',proofs:[proof('a')]}]}),download:()=>new Promise(resolve=>{finish=resolve;})});await f.page.loadOperations();const preview=f.page.previewContactProof(event({id:proof('a').id}));f.store.set('merchantkit.user',{id:'B'});await f.page.loadOperations();finish('wxfile://tmp/A-private.jpg');await preview;assert.equal(f.previews.length,0);
});

test('unused uploaded proof deletion is explicit and failure preserves the editable image',async()=>{
 const f=fixture({remove:async()=>{throw Error('NETWORK_REQUEST_FAILED');}});await f.page.loadOperations();f.page.setData({contactProofItems:[item('a',true)]});await f.page.removeContactProof(event({index:0}));assert.equal(f.removals.length,1);assert.equal(f.page.data.contactProofItems.length,1);assert.equal(f.page.data.contactUploading,false);
});

test('enterprise markup offers real upload controls without binding a private remote image URL',()=>{
 const xml=fs.readFileSync(path.join(root,'pages/member-earn/index.wxml'),'utf8');assert.match(xml,/添加截图/);assert.match(xml,/提交核验/);assert.match(xml,/contactQrAvailable/);assert.doesNotMatch(xml,/src="\{\{(?:item|proof)\.url\}\}"|提交昵称供人工核验/);
 const f=fixture();for(const match of xml.matchAll(/(?:bind|catch)(?::)?[\w-]+="([A-Za-z][\w]*)"/g))assert.equal(typeof f.page[match[1]],'function',match[1]);
});

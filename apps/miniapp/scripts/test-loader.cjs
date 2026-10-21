const fs=require('fs'),path=require('path'),vm=require('vm');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
// Historical domain suites model an already-consenting customer. Privacy suites
// pass privacyAccepted:false and exercise the real undecided/browse storage.
function createLoader(wx={},overrides={},app={globalData:{}},testOptions={}){const suppliedWx=wx;const fixtureStorage=key=>{let value;try{value=suppliedWx.getStorageSync?.(key);}catch(error){if(key!=='merchantkit.privacy.choice.v1'||testOptions.privacyAccepted===false)throw error;}if(key==='merchantkit.privacy.choice.v1'&&!['accepted','browse'].includes(value?.choice)&&testOptions.privacyAccepted!==false)return {version:'privacy-v1.0-demo-2026-10-21',miniProgramVersion:'community-miniapp-privacy-v1',choice:'accepted',decidedAt:'2026-10-18T00:00:00.000Z'};return value;};wx=new Proxy(suppliedWx,{get(target,key){return key==='getStorageSync'?fixtureStorage:target[key];}});const cache=new Map();let page,component,appDefinition;
 function load(file){let full=path.resolve(root,file);if(!path.extname(full))full+='.js';if(overrides[full]){const overridden=overrides[full];return full===path.join(root,'config','index.js')&&overridden.config?{...overridden,config:{privacyNoticeVersion:'privacy-v1.0-demo-2026-10-21',miniProgramPrivacyVersion:'community-miniapp-privacy-v1',...overridden.config}}:overridden;}if(cache.has(full))return cache.get(full).exports;
 if(!testOptions.communityDefault&&full===path.join(root,'config','enterprise-contact.js'))return {enterpriseContact:{enabled:true,configId:'a'.repeat(32)}};
 const mod={exports:{}};cache.set(full,mod);const source=fs.readFileSync(full,'utf8');const parsed=ts.createSourceFile(full,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);if(parsed.parseDiagnostics.length)throw new SyntaxError(full+': '+parsed.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join('; '));const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 const context={exports:mod.exports,module:mod,require:s=>load(path.resolve(path.dirname(full),s)),wx,getApp:()=>app,getCurrentPages:()=>testOptions.pages||[],Page:d=>{page=d;},Component:d=>{component=d;},App:d=>{appDefinition=d;},console,setTimeout,clearTimeout,Promise,Date,Map,Set};
 vm.runInNewContext(code,context,{filename:full});if(!testOptions.communityDefault&&full===path.join(root,'config','index.js'))mod.exports={...mod.exports,config:{...mod.exports.config,paymentEnabled:true}};return mod.exports;}
 return {load,get page(){return page;},get component(){return component;},get appDefinition(){return appDefinition;}};
}
module.exports={createLoader,root};

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {values}=parseArgs({options:{api:{type:'string'},appid:{type:'string'},plugins:{type:'boolean',default:false}}});
if(!/^wx[0-9a-f]{16}$/.test(values.appid||''))throw Error('Provide your own public WeChat AppID, never an AppSecret');
const origin=new URL(values.api||'');
if(origin.username||origin.password||origin.search||origin.hash||origin.pathname!=='/'||!['https:','http:'].includes(origin.protocol))throw Error('Use an origin without credentials, path, query or fragment');
if(origin.protocol==='http:'&&!['127.0.0.1','localhost'].includes(origin.hostname))throw Error('Plain HTTP is allowed only for local developer-tool testing');
const dir=path.join(root,'apps/miniapp');
const projectFile=path.join(dir,'project.config.json'),project=JSON.parse(fs.readFileSync(projectFile,'utf8'));project.appid=values.appid;
fs.writeFileSync(projectFile,JSON.stringify(project,null,2)+'\n');
const config=path.join(dir,'config/index.js');let source=fs.readFileSync(config,'utf8');source=source.replace(/apiBaseUrl:\s*'[^']*', websiteBaseUrl:\s*'[^']*'/,`apiBaseUrl: '${origin.origin}', websiteBaseUrl: '${origin.origin}'`);fs.writeFileSync(config,source);
for(const relative of ['pages/subscriptions/index.js','scripts/check.cjs']){const f=path.join(dir,relative);fs.writeFileSync(f,fs.readFileSync(f,'utf8').replaceAll('wx0000000000000000',values.appid));}
if(values.plugins){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'examples/wechat-plugins.json'),'utf8'));
  const appFile=path.join(dir,'app.json'),app=JSON.parse(fs.readFileSync(appFile,'utf8'));app.plugins=manifest.plugins;app.subpackages=manifest.subpackages;fs.writeFileSync(appFile,JSON.stringify(app,null,2)+'\n');
  for(const [file,name,value]of [['components/enterprise-contact/index.json','contact-cell','plugin://contactPlugin/cell'],['packages/student/entry.json','student-verify','plugin://studentVerify/verify']]){const full=path.join(dir,file),j=JSON.parse(fs.readFileSync(full,'utf8'));j.usingComponents[name]=value;fs.writeFileSync(full,JSON.stringify(j,null,2)+'\n');}
}
console.log('Updated this community client only. No server credentials or production settings were read.');

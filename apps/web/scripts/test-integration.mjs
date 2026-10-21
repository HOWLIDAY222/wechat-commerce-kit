import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { requireLocalDemoDatabase } from './demo-guard.mjs';
const url=requireLocalDemoDatabase(process.env.DATABASE_URL,'test');
const controlUrl=new URL(url);controlUrl.pathname='/postgres';
const client=new pg.Client({connectionString:controlUrl.href});await client.connect();
const run=crypto.randomBytes(6).toString('hex'),template='merchantkit_test_tpl_'+run;
const folder=path.resolve('.data/integration/'+run);fs.mkdirSync(folder,{recursive:true});
const suites=fs.readdirSync('scripts/smoke').filter(f=>/(?:regression|integration)\.test\.tsx?$/.test(f));
const results=[];const databases=[];
function execute(args,env){const r=spawnSync(process.execPath,args,{env,cwd:process.cwd(),encoding:'utf8',timeout:180000,maxBuffer:8e6});return {status:r.status,log:(r.stdout||'')+(r.stderr||'')};}
const basic={...process.env,NODE_ENV:'test',APP_BASE_URL:'http://127.0.0.1:3000',SMS_PROVIDER:'mock',PAYMENT_PROVIDER:'mock',EMAIL_PROVIDER:'disabled',ENABLE_MOCK_ADMIN_LOGIN:'false',WECHAT_API_BASE_URL:'http://127.0.0.1:18998',WECHAT_PAY_API_BASE_URL:'http://127.0.0.1:18998',WECHAT_MINIPROGRAM_APP_ID:'qa-student-app',WECHAT_MINIPROGRAM_APP_SECRET:'fake-only',WECHAT_PAY_MCH_ID:'qa-merchant',SESSION_SECRET:'community-integration-tests-only-secret',COMMERCE_STORAGE:'prisma',NEXT_TELEMETRY_DISABLED:'1'};
try{
  await client.query('CREATE DATABASE '+template);databases.push(template);
  const templateUrl=new URL(url);templateUrl.pathname='/'+template;
  const migration=execute(['node_modules/prisma/build/index.js','migrate','deploy'],{...basic,DATABASE_URL:templateUrl.href});
  fs.writeFileSync(path.join(folder,'migrations.log'),migration.log);if(migration.status!==0)throw Error('Test migrations failed; inspect ignored local integration logs');
  for(let i=0;i<suites.length;i++){
    const file=suites[i],name='merchantkit_test_'+run+'_'+i;await client.query('CREATE DATABASE '+name+' TEMPLATE '+template);databases.push(name);
    const original=fs.readFileSync('scripts/smoke/'+file,'utf8');const expected=original.match(/\.pathname,\s*["']\/([^"']+)/)?.[1];
    const uploads=path.join(folder,file.replace(/\W/g,'_'),'community-fixtures','qa-uploads','uploads');fs.mkdirSync(uploads,{recursive:true});
    let text=expected?original.replaceAll(expected,name):original;
    text=text.replace(/(['"])(?:\/opt\/|\/tmp\/)[^'"\n]*qa-uploads\/uploads\1/g,JSON.stringify(uploads.replaceAll('\\','/')));
    const generated=path.join(folder,file);fs.writeFileSync(generated,text);
    const testUrl=new URL(url);testUrl.pathname='/'+name;
    const env={...basic,DATABASE_URL:testUrl.href,UPLOAD_DIR:uploads.replaceAll('\\','/')};
    if(file.includes('logistics'))Object.assign(env,{WECHAT_API_BASE_URL:'http://127.0.0.1:18998',WECHAT_MINIPROGRAM_APP_ID:'qa-logistics-app',WECHAT_PAY_MCH_ID:'qa-logistics-merchant'});
    if(/shipping|pickup/.test(file))Object.assign(env,{WECHAT_API_BASE_URL:'http://127.0.0.1:18997',WECHAT_MINIPROGRAM_APP_ID:'qa-shipping-app',WECHAT_PAY_MCH_ID:'qa-shipping-merchant'});
    if(file.includes('subscriptions'))Object.assign(env,{WECHAT_API_BASE_URL:'http://127.0.0.1:18998',WECHAT_MINIPROGRAM_APP_ID:'qa-subscription-app',WECHAT_MINIPROGRAM_APP_SECRET:'qa-subscription-secret'});
    const result=execute(['--import','./scripts/network-guard.mjs','--import','tsx',generated],env);fs.writeFileSync(path.join(folder,file+'.log'),result.log);
    const row={file,exitCode:result.status,tests:Number(result.log.match(/(?:^# tests |^ℹ tests )(\d+)/m)?.[1]||0)};results.push(row);console.log(JSON.stringify(row));
    if(result.status!==0)console.log(result.log.slice(-1500));
    await client.query('DROP DATABASE '+name+' WITH (FORCE)');databases.splice(databases.indexOf(name),1);
  }
}finally{
  for(const name of databases.reverse()){if(!/^merchantkit_test_(?:tpl_)?[a-f0-9_]+$/.test(name))throw Error('Unexpected test resource name');await client.query('DROP DATABASE IF EXISTS '+name+' WITH (FORCE)');}
  await client.end();fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify(results,null,2));
}
if(results.length!==suites.length||results.some(r=>r.exitCode!==0||r.tests===0))process.exitCode=1;

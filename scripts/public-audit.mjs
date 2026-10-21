import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
export function inspect(file,content){
  const findings=[];
  if(/(?:^|\/)(?:project\.private\.config\.json|\.env(?:\..*)?)$/.test(file)&&!file.endsWith('.env.example'))findings.push('private-configuration');
  if(/\.(?:pem|key|p12|pfx|dump|sqlite3?|db|log|zip|gz|tar)$/i.test(file))findings.push('private-or-generated-file');
  const rules=[
    ['private-key-material',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]{40,}?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
    ['access-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|sk-(?:proj-)?[A-Za-z0-9_-]{35,}|AKIA[0-9A-Z]{16})\b/],
    ['private-machine-path',/(?:[CD]:[\\/]Users[\\/]|D:[\\/]codex[\\/]|\/opt\/[a-z0-9_-]+\/(?:shared|sources|releases)\/)/i],
    ['unexpected-phone',/\b1[3-9]\d{9}\b/g],
  ];
  for(const [type,regex]of rules){if(type==='unexpected-phone'){if([...content.matchAll(regex)].some(m=>!/^1390{4}\d{4}$/.test(m[0])&&!/^1380{7}\d$/.test(m[0])))findings.push(type);}else if(regex.test(content))findings.push(type);}
  return findings;
}
export function audit(root){
  let files;
  try{files=[...new Set(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean))];}catch{}
  if(!files?.length){files=[];function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.next','.git','.data'].includes(e.name))continue;const full=path.join(dir,e.name);if(e.isDirectory())walk(full);else files.push(path.relative(root,full).replaceAll('\\','/'));}}walk(root);files=files.filter(f=>!/(^|\/)\.env(?:\..*)?$/.test(f)||f.endsWith('.env.example'));}
  const findings=[];
  for(const file of files){const full=path.join(root,file);if(!fs.existsSync(full)){findings.push({file,types:['missing-tracked-file']});continue;}const bytes=fs.readFileSync(full);const text=/\.(?:png|jpe?g|webp)$/i.test(file)?'':bytes.toString('utf8');const types=inspect(file,text);if(types.length)findings.push({file,types});}
  return {files:files.length,findings};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=audit(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));console.log(JSON.stringify(result,null,2));if(result.findings.length)process.exitCode=1;
}

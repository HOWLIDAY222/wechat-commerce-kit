import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pnpm=process.platform==='win32'?'pnpm.cmd':'pnpm';
const steps=[
  [process.execPath,['scripts/public-audit.mjs'],root],
  [process.execPath,['--test','tests/*.test.mjs'],root],
  [pnpm,['test'],path.join(root,'apps/miniapp')],
  [pnpm,['test'],path.join(root,'apps/web')],
];
if(process.argv[2]==='all')steps.push([pnpm,['check'],path.join(root,'apps/miniapp')],[pnpm,['lint'],path.join(root,'apps/web')],[pnpm,['typecheck'],path.join(root,'apps/web')],[pnpm,['build'],path.join(root,'apps/web')]);
for(const [command,args,cwd]of steps){const r=spawnSync(command,args,{cwd,stdio:'inherit',shell:process.platform==='win32'&&command.endsWith('.cmd')});if(r.status!==0)process.exit(r.status||1);}

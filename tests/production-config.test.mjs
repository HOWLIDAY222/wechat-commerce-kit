import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd=fileURLToPath(new URL('../apps/web/',import.meta.url));
function check(values){return spawnSync(process.execPath,['--import','tsx','-e','import("./lib/config.ts").then(()=>console.log("configured"))'],{cwd,encoding:'utf8',env:{...process.env,NODE_ENV:'production',COMMUNITY_BUILD_ONLY:'false',SESSION_SECRET:'',ENABLE_MOCK_ADMIN_LOGIN:'false',...values}});}
test('production refuses missing or example session credentials',()=>{
  for(const secret of ['', 'GENERATE_A_LOCAL_SECRET', 'merchantkit-local-session-secret'])assert.notEqual(check({SESSION_SECRET:secret}).status,0);
});
test('production refuses the mock administrator endpoint even with an independent secret',()=>{
  assert.notEqual(check({SESSION_SECRET:'synthetic-test-session-'.repeat(3),ENABLE_MOCK_ADMIN_LOGIN:'true'}).status,0);
});
test('a properly configured runtime can load without exposing its secret',()=>{
  const secret='synthetic-test-session-'.repeat(3),result=check({SESSION_SECRET:secret});assert.equal(result.status,0);assert(!result.stdout.includes(secret));
});

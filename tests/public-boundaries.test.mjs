import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from '../scripts/public-audit.mjs';
test('private configuration and key files cannot enter the public payload',()=>{
  assert(inspect('apps/miniapp/project.private.config.json','{}').includes('private-configuration'));
  assert(inspect('apps/web/.env.local','').includes('private-configuration'));
  assert(inspect('payment.key','').includes('private-or-generated-file'));
  assert.deepEqual(inspect('apps/web/.env.example','SESSION_SECRET=GENERATE_A_LOCAL_SECRET'),[]);
});
test('credential patterns are detected without reporting their value',()=>{
  const token='gh'+'p_'+'a'.repeat(36);const result=inspect('sample.ts',token);assert.deepEqual(result,['access-token']);assert(!JSON.stringify(result).includes(token));
});
test('synthetic contacts are accepted and unexpected phone values fail',()=>{
  assert.deepEqual(inspect('fixture.ts','13900000001'),[]);
  const digits=['1','8','6','9','9','7','1','1','8','7','6'].join('');assert(inspect('fixture.ts',digits).includes('unexpected-phone'));
});

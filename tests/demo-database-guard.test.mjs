import test from 'node:test';
import assert from 'node:assert/strict';
import { requireLocalDemoDatabase } from '../apps/web/scripts/demo-guard.mjs';
test('demo commands accept only dedicated loopback databases',()=>{
  assert.equal(requireLocalDemoDatabase('postgresql://local:local@127.0.0.1:55439/merchantkit_demo').pathname,'/merchantkit_demo');
  for(const u of ['postgresql://user:pass@db.example.com/merchantkit_demo','postgresql://local:local@localhost/shop_prod','postgresql://local:local@localhost/postgres','https://localhost/merchantkit_demo'])assert.throws(()=>requireLocalDemoDatabase(u));
});
test('integration runner requires its dedicated test database name',()=>{
  assert.throws(()=>requireLocalDemoDatabase('postgresql://local:local@localhost/merchantkit_demo','test'));
  assert(requireLocalDemoDatabase('postgresql://local:local@localhost/merchantkit_test','test'));
});

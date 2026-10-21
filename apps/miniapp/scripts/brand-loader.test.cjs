const test=require('node:test');
const assert=require('node:assert/strict');
const {createLoader}=require('./test-loader.cjs');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function loader(timeout=0){
  const runtime=createLoader();runtime.load('components/brand-loader/index.js');const definition=runtime.component;
  const events=[];const instance={...definition.methods,properties:{timeout},triggerEvent:event=>events.push(event)};
  return {definition,instance,events};
}

test('brand loader has no forced waiting period and times out only when requested',async()=>{
  const normal=loader();normal.definition.lifetimes.attached.call(normal.instance);
  assert.equal(normal.instance.loadingTimer,undefined);assert.equal(normal.events.length,0);
  normal.definition.lifetimes.detached.call(normal.instance);
  const bounded=loader(5);bounded.definition.lifetimes.attached.call(bounded.instance);
  await delay(20);assert.deepEqual(bounded.events,['timeout']);
  await delay(10);assert.deepEqual(bounded.events,['timeout']);bounded.definition.lifetimes.detached.call(bounded.instance);
});

test('ready or navigation removes the loader and cancels a pending timeout',async()=>{
  const bounded=loader(10);bounded.definition.lifetimes.attached.call(bounded.instance);
  bounded.definition.lifetimes.detached.call(bounded.instance);
  await delay(25);assert.deepEqual(bounded.events,[]);
});

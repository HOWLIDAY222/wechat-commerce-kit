import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {createLoader}=require('../apps/miniapp/scripts/test-loader.cjs');
test('community startup has no merchant identity or mandatory platform plugins',()=>{
  const project=JSON.parse(fs.readFileSync(new URL('../apps/miniapp/project.config.json',import.meta.url)));
  const app=JSON.parse(fs.readFileSync(new URL('../apps/miniapp/app.json',import.meta.url)));
  assert.equal(project.appid,'touristappid');assert.equal(app.plugins,undefined);
  assert(app.subpackages.every(pkg=>!pkg.plugins));
  const loader=createLoader({}, {}, {globalData:{}}, {communityDefault:true});
  assert.equal(loader.load('config/enterprise-contact.js').enterpriseContact.enabled,false);
  assert.equal(loader.load('config/index.js').config.paymentEnabled,false);
});
test('sample policy and optional video use explicit demo boundaries',()=>{
  const loader=createLoader();const docs=loader.load('content/documents.js').documents;
  assert.match(docs['privacy-policy'].nodes,/社区演示/);
  const gallery=loader.load('models/product-gallery.js');
  assert.equal(gallery.productGallery({slug:'x1-air-white',images:['demo.png']}).productFilm,null);
  assert.equal(gallery.productGallery({videoUrl:'javascript:alert(1)',images:[]}).productFilm,null);
});

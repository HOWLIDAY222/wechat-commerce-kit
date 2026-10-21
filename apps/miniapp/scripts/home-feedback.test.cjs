const test=require('node:test'),assert=require('node:assert/strict');
const {createLoader}=require('./test-loader.cjs');
function productPage(wx={}){const l=createLoader({nextTick:fn=>fn(),...wx});l.load('pages/product-detail/index.js');const p=l.page;p.data=structuredClone(p.data);p.setData=value=>Object.assign(p.data,value);return p;}

test('size guide returns to size options with the complete selection unchanged',async()=>{
 const p=productPage();p.setData({selectedStyle:'upgraded',selectedSize:'L',selectedColor:'白色',quantity:5,guideNodes:[{name:'p'}]});
 p.openSpecs();assert.equal(p.data.specScrollTarget,'spec-selection-start');
 await p.openGuide();assert.equal(p.data.guideOpen,true);assert.equal(p.data.specScrollTarget,'spec-guide-start');
 p.closeGuide();assert.equal(p.data.guideOpen,false);assert.equal(p.data.specOpen,true);assert.equal(p.data.specScrollTarget,'spec-size-options');
 assert.equal(p.data.selectedStyle,'upgraded');assert.equal(p.data.selectedSize,'L');assert.equal(p.data.selectedColor,'白色');assert.equal(p.data.quantity,5);p.onUnload();
});

test('viewing product details and returning preserves the complete purchase selection',()=>{
 const p=productPage();p.setData({product:{slug:'x1-air-white'},selectedStyle:'upgraded',selectedSize:'L',selectedColor:'白色',quantity:5});
 p.openSpecs();p.openProductDetails();assert.equal(p.data.specOpen,false);assert.equal(p.data.detailSheetOpen,true);
 p.onResize();p.closeProductDetails();assert.equal(p.data.specOpen,true);assert.equal(p.data.detailSheetOpen,false);
 assert.equal(p.data.selectedStyle,'upgraded');assert.equal(p.data.selectedSize,'L');assert.equal(p.data.selectedColor,'白色');assert.equal(p.data.quantity,5);p.onUnload();
});

test('home uses current product photograph with full composition and preserves published campaign art',()=>{
 const render=createLoader().load('models/home-presentation.js').homePresentation;
 const sections=[{id:'hero',type:'hero'},{id:'intro',type:'contentGrid',layout:'fitPair',items:[{id:'front'}]},{id:'purchase',type:'productGrid',productIds:['x']}];
 const products=[{id:'x',slug:'x1-air-white',image:'https://example.test/current-garment.jpg'}];
 const before=JSON.stringify(sections),view=render(sections,products);
 assert.equal(view.sections[0].heroImage,products[0].image);assert.equal(view.sections[0].heroImageMode,'aspectFit');assert.equal(view.introductionAnchor,'home-section-1');assert.equal(view.sections[2].products[0].id,'x');assert.equal(JSON.stringify(sections),before);
 sections[0].imageUrl='https://example.test/new-campaign.jpg';assert.equal(render(sections,products).sections[0].heroImage,sections[0].imageUrl);assert.equal(render(sections,products).sections[0].heroImageMode,'widthFix');
 assert.equal(render([{id:'hero',type:'hero'}],[]).sections[0].heroImage,'');
});

test('home introduction scroll accounts for the brand header without opening another page',()=>{
 const calls=[];const l=createLoader({pageScrollTo:v=>calls.push(v),navigateTo:()=>assert.fail('Introduction must stay on home'),createSelectorQuery:()=>{const selected=[];return {select:s=>({boundingClientRect:()=>selected.push(s)}),selectViewport:()=>({scrollOffset:()=>selected.push('viewport')}),exec:cb=>cb([{top:600},{scrollTop:100}])};}});
 l.load('pages/home/home.js');const p=l.page;p.selectComponent=()=>({data:{statusBarHeight:44,navigationBarHeight:44}});p.data.introductionAnchor='home-section-1';p.openIntroduction();assert.equal(calls[0].scrollTop,600);assert.equal(calls[0].duration,260);
});

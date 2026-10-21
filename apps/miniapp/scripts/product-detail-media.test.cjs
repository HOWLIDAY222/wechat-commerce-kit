const test=require('node:test'),assert=require('node:assert/strict');
const {createLoader}=require('./test-loader.cjs');
const event=dataset=>({currentTarget:{dataset}});
const media=[
 {id:'construction',title:'立体前片结构',style:'all',url:'/assets/catalog/detail-1080.webp',mobileUrl:'/assets/catalog/detail-750.webp',width:1080,height:1440,mobileWidth:750,mobileHeight:1000},
 {id:'gusset',title:'升级款裆部',style:'upgraded',url:'/assets/catalog/gusset-1080.webp',mobileUrl:'/assets/catalog/gusset-750.webp',width:1080,height:1440,mobileWidth:750,mobileHeight:1000},
];

test('switching product styles cannot display upgraded gusset artwork on regular',()=>{
 const l=createLoader();const normalize=l.load('models/product.js').normalizeProduct;
 const product=normalize({slug:'x1-air-white',image:'/assets/catalog/main.jpg',images:['/assets/catalog/main.jpg'],sizes:['L'],colors:['白色'],variants:[{size:'L',color:'白色',availableQuantity:20,priceCents:4900}],quantityPricing:{maxQuantity:99,repeatBundles:true,styles:[{key:'regular',label:'常规款',unitPriceCents:4900,tiers:[]},{key:'upgraded',label:'升级款',unitPriceCents:6900,tiers:[]}]},detailMedia:media});
 l.load('pages/product-detail/index.js');const p=l.page;p.data=structuredClone(p.data);p.setData=x=>Object.assign(p.data,x);p.setData({product,selectedStyle:'regular',selectedSize:'L',selectedColor:'白色',quantity:5});p.refreshSelection();
 assert.equal(p.data.commonDetailMedia.length,1);assert.equal(p.data.styleDetailMedia.length,0);
 p.chooseStyle(event({style:'upgraded'}));assert.equal(p.data.styleDetailMedia[0].id,'gusset');assert.equal(p.data.quantity,5);assert.equal(p.data.selectedSize,'L');
 p.chooseStyle(event({style:'regular'}));assert.equal(p.data.styleDetailMedia.length,0);assert.equal(p.data.quantity,5);assert.equal(product.images.length,1);p.onUnload();
});

test('detail preview uses the selected style only and no second image optimizer request',()=>{
 let preview;const l=createLoader({previewImage:v=>preview=v,showToast(){}});const model=l.load('models/product-detail-media.js');const normalized=model.normalizeDetailMedia(media);
 assert.equal(normalized[0].imageUrl,'https://example.invalid/assets/catalog/detail-750.webp');assert.ok(Math.abs(normalized[0].aspectPercent-133.3333)<0.001);
 assert.equal(model.normalizeDetailMedia([{...media[0],mobileWidth:0}]).length,0);
 l.load('pages/product-detail/index.js');const p=l.page;p.data=structuredClone(p.data);p.setData=x=>Object.assign(p.data,x);p.setData(model.detailMediaForStyle({detailMedia:normalized},'regular'));
 p.previewDetailImage(event({src:normalized[1].previewUrl}));assert.equal(preview,undefined);
 p.previewDetailImage(event({src:normalized[0].previewUrl}));assert.equal(preview.urls.length,1);assert.equal(preview.current,normalized[0].previewUrl);
 p.data.isTimelinePreview=true;preview=undefined;p.previewDetailImage(event({src:normalized[0].previewUrl}));assert.equal(preview,undefined);p.onUnload();
});


test('numbered descriptions follow the selected style without losing the product artwork',()=>{
 const l=createLoader(),model=l.load('models/product-detail-media.js');
 const images=model.normalizeDetailMedia([
  {...media[0],detail:{number:'01',title:'宽版弹力腰头',body:'腰头说明'}},
  {...media[1],detail:{number:'06',title:'柔软混纺面料 · 升级款裆部',body:'升级款裆部采用莫代尔与新疆柔棉材质。'}},
 ]);
 const regular=model.detailMediaForStyle({detailMedia:images},'regular');
 assert.equal(regular.commonDetailMedia[0].detail.number,'01');assert.equal(regular.styleDetailMedia.length,0);
 const upgraded=model.detailMediaForStyle({detailMedia:images},'upgraded');
 assert.equal(upgraded.styleDetailMedia[0].detail.number,'06');assert.match(upgraded.styleDetailMedia[0].detail.body,/升级款裆部/);
 assert.equal(upgraded.commonDetailMedia[0].previewUrl,regular.commonDetailMedia[0].previewUrl);
});

const test=require('node:test'),assert=require('node:assert/strict');
const {createLoader}=require('./test-loader.cjs');
test('personal fit handles shared boundaries and leaves out-of-range waists unselected',()=>{
 const {recommendX1Fit,parseFitFields}=createLoader().load('utils/fit-guide.js');
 for(const [waist,preference,expected]of [[72,'regular','S'],[72,'relaxed','M'],[80,'regular','M'],[80,'relaxed','L'],[89,'relaxed',null]])assert.equal(recommendX1Fit(parseFitFields({waistCm:waist,preference})).recommended,expected);
 assert.equal(recommendX1Fit(parseFitFields({weightKg:58})).recommended,null);
 assert.throws(()=>parseFitFields({waistCm:'76.55'}));
});
test('applying a reference size preserves style and quantity and rejects unavailable sizes',()=>{
 const loader=createLoader();loader.load('pages/product-detail/index.js');const p=loader.page;
 p.data={...p.data,selectedStyle:'upgraded',selectedSize:'S',quantity:8,sizes:[{size:'M',disabled:false},{size:'L',disabled:true}]};p.setData=v=>Object.assign(p.data,v);let refreshed=0,closed=0;p.refreshSelection=()=>refreshed++;p.closeGuide=()=>closed++;
 p.applyFitSize({detail:{size:'M'}});assert.equal(p.data.selectedSize,'M');assert.equal(p.data.quantity,8);assert.equal(p.data.selectedStyle,'upgraded');assert.equal(refreshed,1);assert.equal(closed,1);
 p.applyFitSize({detail:{size:'L'}});assert.equal(p.data.selectedSize,'M');assert.equal(refreshed,1);
 p.data.isTimelinePreview=true;p.applyFitSize({detail:{size:'M'}});assert.equal(refreshed,1);
});
test('fit component derives highlighted rows and applies only an available reference',()=>{
 const loader=createLoader();loader.load('components/fit-assistant/index.js');const definition=loader.component;
 let selection;const c={data:structuredClone(definition.data),properties:{sizes:[{size:'M',disabled:false}],selectable:true},setData(v){Object.assign(this.data,v)},triggerEvent(name,value){selection={name,value}}};for(const [k,v]of Object.entries(definition.methods))c[k]=v.bind(c);
 c.input({currentTarget:{dataset:{key:'waistCm'}},detail:{value:'76'}});assert.equal(c.data.recommended,'M');assert.equal(c.data.rows.filter(row=>row.selected).length,1);c.useSize();assert.equal(selection.value.size,'M');
 selection=null;c.properties.sizes=[{size:'M',disabled:true}];c.updateReference();c.useSize();assert.equal(selection,null);
});

const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {createLoader,root}=require('./test-loader.cjs');
const model=()=>createLoader().load('models/pickup.js');
test('pickup availability requires a complete verified point and fails closed',()=>{
  const m=model();assert.throws(()=>m.normalizePickupAvailability({eligible:true}),/INVALID/);
  assert.throws(()=>m.normalizePickupAvailability({enabled:false,eligible:true,point:{}}),/INVALID/);
  const result=m.normalizePickupAvailability({enabled:true,eligible:false,reason:'PICKUP_AREA_UNAVAILABLE',point:{address:'hidden'}});
  assert.equal(result.point,null);assert.equal(m.pickupUnavailableLabel(result,{id:'address'}),'当前区域无法使用自提服务');
});
test('only ready paid orders display the eight-digit pickup code',()=>{
  const m=model(),order={status:'CONFIRMED',paymentStatus:'PAID',pickup:{status:'READY',code:'00123456'}};
  assert.equal(m.pickupOrderPresentation(order).codeLabel,'0012 3456');
  for(const patch of [{paymentStatus:'REFUNDED'},{status:'CLOSED'},{pickup:{...order.pickup,blocked:true}},{pickup:{...order.pickup,status:'COLLECTED'}},{pickup:{...order.pickup,status:'WAITING'}}])assert.equal(!!m.pickupOrderPresentation({...order,...patch}).showCode,false);
});

test('pickup remains selectable while business details are pending without inventing a contact phone',()=>{
  const m=model(),point={name:'MerchantKit 自提点',address:'自提地点待公布',hours:'',phone:'',detailsPending:true,version:'a'.repeat(64)};
  const result=m.normalizePickupAvailability({enabled:true,eligible:true,point});
  assert.equal(result.point.detailsPending,true);assert.equal(result.point.phone,'');
  assert.match(m.pickupOrderPresentation({status:'CONFIRMED',paymentStatus:'PAID',pickup:{...result.point,status:'READY',code:'00123456'}}).copy,/取货地点公布后/);
});
test('pickup orders hide courier tracking and customer confirmation bypasses',()=>{
  const {normalizeOrder}=createLoader().load('models/order.js');
  const o=normalizeOrder({status:'CONFIRMED',paymentStatus:'PAID',fulfillmentStatus:'PENDING',pickup:{status:'READY',code:'00123456'},items:[]});
  assert.equal(o.delivery.title,'待自提');assert.equal(o.fulfillmentStatusLabel,'待自提');assert.equal(o.canConfirmReceipt,false);assert.equal(o.canViewLogistics,false);
});
function checkoutFixture(){
  const calls=[],address={id:'a',name:'测试取货人',phone:'13900000006',province:'山东省',city:'青岛市',district:'市北区'},cart={items:[{id:'i'}],itemCount:1};
  let eligibility=true;
  const orders={fetchDirectCheckout:async()=>({cart,quote:{payableAmountCents:4900}}),fetchPickupAvailability:async id=>({enabled:true,eligible:eligibility,reason:eligibility?'':'PICKUP_AREA_UNAVAILABLE',point:eligibility?{name:'测试点',address:'测试地址',hours:'10–18',phone:'13900000006',version:'a'.repeat(64)}:null}),fetchOrderQuote:async(id,delivery)=>{calls.push({quote:delivery});return {payableAmountCents:delivery?.deliveryMethod==='PICKUP'?4900:5400};},createOrder:async(...args)=>{calls.push({create:args});return {orderNo:'qa-order'};}};
  const loader=createLoader({getStorageSync:()=>null,removeStorageSync(){},redirectTo(){}},{[path.join(root,'config/index.js')]:{config:{checkoutEnabled:true,paymentEnabled:true,paymentProvider:'wechat'}},[path.join(root,'services/addresses.js')]:{fetchAddresses:async()=>[address]},[path.join(root,'services/cart.js')]:{fetchCart:async()=>cart},[path.join(root,'services/orders.js')]:orders,[path.join(root,'utils/tap-feedback.js')]:{withTapFeedback:x=>x}});
  loader.load('pages/checkout/index.js');const p=loader.page;p.data=JSON.parse(JSON.stringify(p.data));p.setData=function(patch){Object.assign(this.data,patch);};
  return {p,calls,setEligibility:value=>eligibility=value};
}
test('checkout re-quotes eligible pickup at zero delivery cost and sends the selected point version',async()=>{
  const {p,calls}=checkoutFixture();await p.loadCheckout();p.setData({deliveryMethod:'PICKUP'});await p.loadCheckout();assert.equal(calls.at(-1).quote.deliveryMethod,'PICKUP');
  await p.submitOrder();const create=calls.find(c=>c.create).create;assert.equal(create[0],'a');assert.equal(create[2].pickupPointVersion,'a'.repeat(64));
});
test('changing to an unsupported region clears a prior pickup choice before quoting',async()=>{
  const {p,calls,setEligibility}=checkoutFixture();await p.loadCheckout();p.setData({deliveryMethod:'PICKUP'});setEligibility(false);await p.loadCheckout();
  assert.equal(p.data.deliveryMethod,'DELIVERY');assert.equal(p.data.pickupLabel,'当前区域无法使用自提服务');assert.equal(calls.at(-1).quote,undefined);
});
test('repeated pickup-mode taps are blocked while loading or submitting',async()=>{
  const {p}=checkoutFixture();await p.loadCheckout();p.setData({submitting:true});p.chooseDelivery({currentTarget:{dataset:{method:'PICKUP'}}});assert.equal(p.data.deliveryMethod,'DELIVERY');
});

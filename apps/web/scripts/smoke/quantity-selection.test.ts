import assert from 'node:assert/strict';
import {test} from 'node:test';
import {quantityTotal,calculateCartPricing,parseQuantityPricing,getQuantityPriceOptions} from '../../lib/commerce/quantity-pricing';
import {X1_AIR_WHITE_QUANTITY_PRICING as plan} from '../../lib/commerce/x1-air-white-pricing';
import {chooseCouponPricing} from '../../lib/commerce/coupon-pricing';
import {quantityPricingForClient} from '../../lib/commerce/client-quantity-pricing';
const line=(id:string,quantity:number,style='regular')=>({id,productId:'x1',quantity,style,unitPriceCents:style==='regular'?4900:6900,product:{quantityPricing:plan}});
test('older visitor clients retain exact-tier range while updated clients can select more',()=>{
 assert.equal(quantityPricingForClient(plan,'wechat-miniprogram',null)?.maxQuantity,4);
 assert.equal(quantityPricingForClient(plan,'wechat-miniprogram',null)?.repeatBundles,false);
 assert.equal(quantityPricingForClient(plan,'wechat-miniprogram','repeat-bundles-v1')?.maxQuantity,99);
 assert.equal(quantityPricingForClient(plan,null,null)?.maxQuantity,99);
});
test('existing prices stay exact, fifth and later pieces repeat the cheapest combination',()=>{
 const prices={regular:[4900,8900,12900,16900,21800,25800,29800,33800],upgraded:[6900,12900,18900,24900,31800,37800,43800,49800]};
 for(const [style,totals] of Object.entries(prices))for(let q=1;q<=8;q++)assert.equal(quantityTotal(4900,q,plan,style),totals[q-1]);
 assert.equal(quantityTotal(4900,21,plan,'regular'),89400);
 assert.equal(quantityTotal(4900,99,plan,'regular'),418500);
 assert.throws(()=>quantityTotal(4900,100,plan),/INVALID_QUANTITY/);
 assert.equal(getQuantityPriceOptions(4900,plan).length,3,'Purchase limit is not a grid of 99 bundles');
});
test('custom tiers choose the optimal exact partition instead of greedy biggest bundle',()=>{
 const custom={maxQuantity:99,repeatBundles:true,tiers:[{quantity:2,totalPriceCents:150},{quantity:3,totalPriceCents:260}]};
 assert.equal(quantityTotal(100,6,custom),450);
 assert.equal(quantityTotal(100,5,custom),400);
});
test('mixed sizes combine within style and allocated discounts reconcile exactly',()=>{
 for(let q=5;q<=99;q++){
  const items=[line('S',1),line('M',q-1),line('upgraded-L',5,'upgraded')],p=calculateCartPricing(items);
  assert.equal(p.payableAmountCents,quantityTotal(4900,q,plan,'regular')+31800);
  assert.equal(Object.values(p.itemDiscountShares).reduce((a,b)=>a+b,0),p.discountCents);
  for(const i of items)assert(p.itemDiscountShares[i.id]>=0&&p.itemDiscountShares[i.id]<=i.unitPriceCents*i.quantity);
 }
});
test('coupon and repeated combinations choose the best price without stacking',()=>{
 const items=[line('M',5)],coupon=(amount:number)=>({id:'c',title:'QA',amountCents:amount,minimumCents:0,productIds:[],endsAt:new Date('2030-01-01')});
 assert.equal(chooseCouponPricing(items,[coupon(500)]).payableAmountCents,21800);
 assert.equal(chooseCouponPricing(items,[coupon(2700)]).couponClaimId,null);
 assert.equal(chooseCouponPricing(items,[coupon(3000)]).payableAmountCents,21500);
});
test('old exact-tier schemes preserve intentional limits and validation rejects invalid repeat flags',()=>{
 const old={maxQuantity:4,tiers:plan.tiers};
 assert.equal(quantityTotal(4900,5,old),24500);
 assert.throws(()=>calculateCartPricing([{...line('M',5),style:undefined,product:{quantityPricing:old}}]),/PRODUCT_QUANTITY_LIMIT_EXCEEDED/);
 assert.throws(()=>parseQuantityPricing({...plan,maxQuantity:100}),/INVALID_QUANTITY_PRICING/);
 assert.throws(()=>parseQuantityPricing({...plan,repeatBundles:'true'}),/INVALID_QUANTITY_PRICING/);
});

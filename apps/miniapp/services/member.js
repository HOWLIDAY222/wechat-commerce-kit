import { request } from './http';

export async function fetchMember() {
  const response = await request({ path: '/api/miniprogram/member', auth: 'required' });
  if (!response?.ok || !Array.isArray(response.wallet) || !Array.isArray(response.available)) throw new Error('INVALID_MEMBER_RESPONSE');
  return { ...response,promotions:formatPromotions(response.promotions), newcomer:formatNewcomerOffer(response.newcomer), wallet: response.wallet.map(formatCoupon), available: response.available.map(formatCoupon), rewards: (response.rewards || []).map(formatCoupon),
    availableCount: response.wallet.filter(c => c.status === 'AVAILABLE').length,
    joinedLabel: response.member?.joinedAt ? response.member.joinedAt.slice(0, 10) : '',
    memberNo: response.member?.memberNo?.slice(-8).toUpperCase() || '',
  };
}

export async function memberAction(action, templateId, requestId) {
  const response = await request({ path: '/api/miniprogram/member', auth: 'required', method: 'POST', data: { action, ...(templateId ? { templateId } : {}), ...(requestId ? { requestId } : {}) } });
  if (!response?.ok) throw new Error('MEMBER_ACTION_FAILED');
  return response;
}

function formatCoupon(coupon) {
  const labels = { AVAILABLE: '可使用', HELD: '订单占用', USED: '已使用', EXPIRED: '已过期', VOID: '已失效', INELIGIBLE: '不再符合首购条件' };
  return { ...coupon, amount: (coupon.amountCents / 100).toFixed(2).replace(/\.00$/, ''),
    validityLabel:coupon.longTerm?'长期有效':'有效期至 '+(coupon.endsAt?new Date(new Date(coupon.endsAt).getTime()+8*3600000).toISOString().slice(0,16).replace('T',' '):'以券规则为准'),
    threshold: coupon.minimumCents ? `适用商品满 ¥${(coupon.minimumCents / 100).toFixed(2)} 可用` : '无额外满减门槛',
    expiry: coupon.endsAt ? new Date(new Date(coupon.endsAt).getTime() + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '', statusLabel: labels[coupon.status] || '',
    scope: coupon.productIds?.length ? `指定商品：${coupon.productNames?.join('、') || '以商品页及结算结果为准'}` : '全部商品',
    redeemLabel: coupon.claimed ? '已兑换' : coupon.soldOut ? '已兑完' : !coupon.eligible ? '暂不符合条件' : !coupon.canAfford ? '积分不足' : '兑换优惠券',
    claimLabel: coupon.claimed ? '已领取' : !coupon.eligible ? '仅限首购会员' : coupon.soldOut ? '已领完' : '领取',
  };
}

export async function fetchNewcomerOffer(){
  const response=await request({path:'/api/miniprogram/newcomer',auth:'optional'});
  if(!response?.ok||!response.offer)throw Error('INVALID_NEWCOMER_RESPONSE');
  return formatNewcomerOffer(response.offer);
}
function formatNewcomerOffer(offer){
  if(!offer?.enabled||!offer.visible)return null;
  const money=value=>(Number(value||0)/100).toFixed(2).replace(/\.00$/,'');
  return {...offer,couponText:`满${money(offer.minimumCents)}减${money(offer.amountCents)}`,claimed:offer.status==='CLAIMED',claimable:offer.status==='CLAIMABLE'};
}

export async function fetchMemberPromotions(){
  const response=await request({path:'/api/miniprogram/newcomer',auth:'optional'});
  if(!response?.ok||!response.offer)throw Error('INVALID_NEWCOMER_RESPONSE');
  return {newcomer:formatNewcomerOffer(response.offer),promotions:formatPromotions(response.promotions)};
}
function formatPromotions(value){
  if(!value?.campaign||!value?.exchange)return null;
  const money=n=>(Number(n||0)/100).toFixed(2).replace(/\.00$/,'');
  const day=iso=>iso?new Date(new Date(iso).getTime()+8*3600000).toISOString().slice(0,10).replace(/-/g,'/') : '';
  const campaign={...value.campaign,tiersText:(value.campaign.tiers||[]).filter(t=>t.active).map(t=>`满${money(t.minimumCents)}减${money(t.amountCents)}`).join(' · '),periodLabel:value.campaign.startsAt&&value.campaign.endsAt?`${day(value.campaign.startsAt)}—${day(value.campaign.endsAt)}`:''};
  return {...value,campaign,homeTitle:campaign.visible?'限时会员礼遇':'积分常享',homeDetail:campaign.visible?campaign.tiersText:'100积分兑换1元 · 5—50元长期券',homePeriod:campaign.visible?campaign.periodLabel:'积分足够可重复兑换，不受限时活动结束影响',homeAction:campaign.visible?'领活动券':'积分兑换'};
}

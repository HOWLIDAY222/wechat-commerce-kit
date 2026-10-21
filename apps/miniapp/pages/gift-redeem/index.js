import { withTapFeedback } from '../../utils/tap-feedback';
import {giftAction,giftError,giftRequestId,formatGift} from '../../services/gifts';
import {fetchAddresses} from '../../services/addresses';
import {payOrderWithWeChat} from '../../services/payments';
import {cancelOrder} from '../../services/orders';
import {hasSession} from '../../stores/session';
import {rememberGiftLoginReturn} from '../../stores/navigation';
Page(withTapFeedback({
  data:{id:'',card:null,loading:true,busy:false,error:'',sizes:[],size:'',address:null,shippingFeeCents:null,shippingFee:'',showRules:false},
  onLoad(options={}){this.setData({id:options.id||''});this.requestId=giftRequestId();},
  onShow(){wx.hideShareMenu?.({menus:['shareAppMessage','shareTimeline']});this.load();},
  onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh());},
  async load(){if(!hasSession()){rememberGiftLoginReturn(`/pages/gift-redeem/index?id=${this.data.id}`);wx.switchTab({url:'/pages/account/index'});return;}
    const run=(this.loadId||0)+1;this.loadId=run;this.setData({loading:true,error:''});
    try{const addresses=await fetchAddresses(),selected=wx.getStorageSync(`merchantkit.giftAddress.${this.data.id}`),address=addresses.find(a=>a.id===selected?.id)||addresses.find(a=>a.id===this.data.address?.id)||addresses.find(a=>a.isDefault)||addresses[0]||null;
      const result=await giftAction('selection',{id:this.data.id,...(address?{addressId:address.id}:{})});if(run!==this.loadId)return;
      this.setData({card:formatGift(result.card),sizes:result.sizes,address,shippingFeeCents:result.shippingFeeCents,shippingFee:result.shippingFeeCents===null?'待选择地址':(result.shippingFeeCents/100).toFixed(2).replace(/\.00$/,''),size:result.sizes.some(s=>s.size===this.data.size&&s.canRedeem)?this.data.size:''});
    }catch(e){if(run===this.loadId)this.setData({error:giftError(e?.message)});}finally{if(run===this.loadId)this.setData({loading:false});}
  },
  selectSize(e){if(this.data.busy)return;const size=e.currentTarget.dataset.size;if(this.data.sizes.some(s=>s.size===size&&s.canRedeem))this.setData({size});},
  chooseAddress(){if(!this.data.busy)wx.navigateTo({url:`/pages/addresses/index?select=1&gift=${this.data.id}`});},
  sizeGuide(){wx.navigateTo({url:'/pages/fit-profile/index'});},
  async submit(){if(this.data.busy||this.data.loading||!this.data.card)return;
    if(this.data.card.status==='REDEEMED'){this.viewOrder();return;}
    this.setData({busy:true,error:''});
    try{if(this.data.card.status==='REDEEMING'){await payOrderWithWeChat(this.data.card.redemptionOrderNo);await this.load();return;}
      if(!this.data.size||!this.data.address||this.data.shippingFeeCents===null){this.setData({error:'请选择可兑换尺码和收货地址。'});return;}
      const answer=await new Promise(resolve=>wx.showModal({title:'确认兑换礼品',content:`${this.data.card.description}，尺码 ${this.data.size}。商品已由礼品卡包含，本次运费 ¥${this.data.shippingFee}。确认后创建配送订单，卡片将用于本次兑换。`,confirmText:'确认兑换',success:resolve}));if(!answer.confirm)return;
      const result=await giftAction('redeem',{id:this.data.id,size:this.data.size,addressId:this.data.address.id,requestId:this.requestId,expectedShippingCents:this.data.shippingFeeCents});
      wx.removeStorageSync(`merchantkit.giftAddress.${this.data.id}`);
      if(result.needsPayment){await payOrderWithWeChat(result.orderNo);await this.load();}
      else wx.redirectTo({url:`/pages/order-detail/index?orderNo=${result.orderNo}`});
    }catch(e){this.setData({error:giftError(e?.message)});}finally{this.setData({busy:false});}
  },
  viewOrder(){const orderNo=this.data.card?.redemptionOrderNo;if(orderNo)wx.navigateTo({url:`/pages/order-detail/index?orderNo=${orderNo}`});},
  async cancelDelivery(){if(this.data.busy||this.data.card?.status!=='REDEEMING')return;const answer=await new Promise(resolve=>wx.showModal({title:'重新选择尺码与地址',content:'取消未付款的配送订单，释放库存，礼品卡会恢复待兑换。',success:resolve}));if(!answer.confirm)return;this.setData({busy:true,error:''});try{await cancelOrder(this.data.card.redemptionOrderNo);this.requestId=giftRequestId();await this.load();}catch(e){this.setData({error:giftError(e?.message)});}finally{this.setData({busy:false});}},
  goService(){wx.navigateTo({url:'/pages/contact/index'});},
}, ["load","selectSize","sizeGuide","chooseAddress","submit","cancelDelivery","goService"]));

import { withTapFeedback } from '../../utils/tap-feedback';
import {fetchGifts,giftAction,giftError,giftRequestId} from '../../services/gifts';
import {payOrderWithWeChat,queryWeChatPayment} from '../../services/payments';
import {cancelOrder} from '../../services/orders';
import {hasSession,readStoredUser} from '../../stores/session';
import {rememberGiftLoginReturn} from '../../stores/navigation';
Page(withTapFeedback({
  data:{loading:true,busy:false,error:'',notice:'',tab:'received',cards:[],visibleCards:[],offers:[],rules:'',showRules:false,message:'',preparedId:'',uncertain:false},
  onLoad(){this.shareById={};},
  onShow(){wx.hideShareMenu?.({menus:['shareTimeline']});this.load();},
  onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh());},
  async load(){
    if(!hasSession()){rememberGiftLoginReturn('/pages/gifts/index');wx.switchTab({url:'/pages/account/index'});return;}
    const run=(this.loadId||0)+1;this.loadId=run;this.setData({loading:true,error:''});
    try{const result=await fetchGifts();if(run!==this.loadId)return;this.setData({...result,preparedId:'',loading:false});this.filterCards();}
    catch(e){if(run===this.loadId)this.setData({error:giftError(e?.message),loading:false});}
  },
  filterCards(){this.setData({visibleCards:this.data.cards.filter(c=>this.data.tab==='sent'?c.sent:c.received)});},
  selectTab(e){if(this.data.busy)return;this.setData({tab:e.currentTarget.dataset.tab,preparedId:''});this.filterCards();},
  inputMessage(e){this.setData({message:e.detail.value});},toggleRules(){this.setData({showRules:!this.data.showRules});},
  async purchase(e){
    if(this.data.busy||this.data.loading)return;const offer=this.data.offers.find(o=>o.id===e.currentTarget.dataset.id);if(!offer)return;
    const storageKey=`merchantkit.giftPurchase.${readStoredUser()?.id||'current'}`;
    const previous=wx.getStorageSync(storageKey),message=this.data.message.trim();
    if(previous&&(previous.templateId!==offer.id||previous.message!==message)){this.setData({error:'上一次购买结果尚未核对，请先查看“我送出的”，或使用原选项重试。'});return;}
    this.setData({busy:true,error:'',notice:''});
    try{const confirmed=await new Promise(resolve=>wx.showModal({title:'购买固定商品礼品卡',content:`${offer.productName} · ${offer.description}，商品金额 ¥${offer.price}。收礼人选尺码，运费按地址另计，不使用优惠券或积分。`,confirmText:'确认购买',success:resolve}));if(!confirmed.confirm)return;
      const input=previous||{templateId:offer.id,requestId:giftRequestId(),expectedAmountCents:offer.goodsPriceCents,message};wx.setStorageSync(storageKey,input);
      const result=await giftAction('purchase',input);wx.removeStorageSync(storageKey);this.setData({tab:'sent',uncertain:false});
      const payment=await payOrderWithWeChat(result.card.purchaseOrderNo);this.setData({notice:payment.paid?'付款成功，礼品卡已放入卡包。':'尚未付款，可在卡片上继续支付。'});await this.load();
    }catch(e){this.setData({error:giftError(e?.message),uncertain:!!wx.getStorageSync(storageKey)});}
    finally{this.setData({busy:false});}
  },
  async pay(e){if(this.data.busy)return;const card=this.data.cards.find(c=>c.id===e.currentTarget.dataset.id);if(!card?.purchaseOrderNo)return;this.setData({busy:true,error:''});try{const checked=await queryWeChatPayment(card.purchaseOrderNo).catch(()=>null);if(!checked?.paid)await payOrderWithWeChat(card.purchaseOrderNo);await this.load();}catch(e){this.setData({error:giftError(e?.message)});}finally{this.setData({busy:false});}},
  async prepareShare(e){if(this.data.busy)return;const id=e.currentTarget.dataset.id;this.setData({busy:true,error:''});try{const result=await giftAction('share',{id});this.shareById[id]=result.share;this.setData({preparedId:id});}catch(e){this.setData({error:giftError(e?.message)});}finally{this.setData({busy:false});}},
  onShareAppMessage(e){const share=this.shareById?.[e?.target?.dataset?.id];return share||{title:'MerchantKit 商品礼品卡',path:'/pages/gifts/index'};},
  useOwn(e){const share=this.shareById[e.currentTarget.dataset.id];if(share)wx.navigateTo({url:share.path});},
  redeem(e){wx.navigateTo({url:`/pages/gift-redeem/index?id=${e.currentTarget.dataset.id}`});},
  viewOrder(e){const card=this.data.cards.find(c=>c.id===e.currentTarget.dataset.id);if(card?.redemptionOrderNo)wx.navigateTo({url:`/pages/order-detail/index?orderNo=${card.redemptionOrderNo}`});},
  async cancel(e){if(this.data.busy)return;const card=this.data.cards.find(c=>c.id===e.currentTarget.dataset.id);if(!card?.purchaseOrderNo)return;
    const answer=await new Promise(resolve=>wx.showModal({title:'取消未付款礼品卡',content:'确认取消这笔购买？已付款的礼品卡请使用退款申请。',success:resolve}));if(!answer.confirm)return;
    this.setData({busy:true,error:''});try{await cancelOrder(card.purchaseOrderNo);await this.load();}catch(e){this.setData({error:giftError(e?.message)});}finally{this.setData({busy:false});}},
  async refund(e){if(this.data.busy)return;const id=e.currentTarget.dataset.id;
    const answer=await new Promise(resolve=>wx.showModal({title:'申请礼品卡退款',content:'提交后礼品卡会冻结，收礼人无法再兑换。审核后退回原付款渠道。',editable:true,placeholderText:'请填写退款原因',confirmText:'提交申请',success:resolve}));if(!answer.confirm)return;
    if(!answer.content?.trim()||answer.content.trim().length<2){this.setData({error:'请填写至少两个字的退款原因。'});return;}
    this.setData({busy:true,error:''});try{await giftAction('refund',{id,reason:answer.content.trim()});this.setData({notice:'退款申请已提交，礼品卡已冻结。'});await this.load();}catch(e){this.setData({error:giftError(e?.message)});}finally{this.setData({busy:false});}
  },
  goService(){wx.navigateTo({url:'/pages/contact/index'});},
}, ["selectTab","load","prepareShare","useOwn","redeem","viewOrder","pay","cancel","refund","purchase","toggleRules","goService"]));

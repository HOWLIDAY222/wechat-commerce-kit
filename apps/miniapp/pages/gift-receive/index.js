import { withTapFeedback } from '../../utils/tap-feedback';
import {giftAction,giftError,formatGift} from '../../services/gifts';
import {hasSession} from '../../stores/session';
import {rememberGiftLoginReturn} from '../../stores/navigation';
Page(withTapFeedback({
  data:{loading:true,busy:false,error:'',gift:null,loggedIn:false,id:'',token:''},
  onLoad(options={}){this.setData({id:options.id||'',token:options.token||''});},
  onShow(){wx.hideShareMenu?.({menus:['shareAppMessage','shareTimeline']});this.load();},
  async load(){this.setData({loading:true,error:'',loggedIn:hasSession()});
    try{if(!/^[A-Za-z0-9_-]{1,100}$/.test(this.data.id)||!/^[A-Za-z0-9_-]{43}$/.test(this.data.token))throw Error('GIFT_LINK_INVALID');
      const result=await giftAction('preview',{id:this.data.id,token:this.data.token});this.setData({gift:formatGift(result.gift)});
    }catch(e){this.setData({error:giftError(e?.message),gift:null});}finally{this.setData({loading:false});}
  },
  login(){rememberGiftLoginReturn(`/pages/gift-receive/index?id=${this.data.id}&token=${this.data.token}`);wx.switchTab({url:'/pages/account/index'});},
  async claim(){if(this.data.busy||this.data.loading)return;if(!hasSession()){this.login();return;}this.setData({busy:true,error:''});
    try{await giftAction('claim',{id:this.data.id,token:this.data.token});wx.redirectTo({url:`/pages/gift-redeem/index?id=${this.data.id}`});}
    catch(e){this.setData({error:giftError(e?.message)});}finally{this.setData({busy:false});}
  },
  openGift(){wx.redirectTo({url:`/pages/gift-redeem/index?id=${this.data.id}`});},
  goWallet(){wx.redirectTo({url:'/pages/gifts/index'});},goService(){wx.navigateTo({url:'/pages/contact/index'});},
}, ["load","openGift","claim","goWallet","goService"]));

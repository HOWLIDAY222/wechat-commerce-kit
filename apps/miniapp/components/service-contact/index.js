import { withTapFeedback } from '../../utils/tap-feedback';
import { customerServiceContext } from '../../utils/customer-service';
import { isPrivacyAccepted } from '../../stores/privacy-consent';
import { openPrivacyPage, observePrivacyDecision } from '../../utils/privacy-flow';
Component(withTapFeedback({
  properties:{mode:{type:String,value:'primary'},scene:{type:String,value:'general'},slug:String,styleKey:String,productName:String,image:String,orderNo:String},
  data:{context:customerServiceContext(),unavailable:false,supported:true,privacyAccepted:false},
  observers:{'scene, slug, styleKey, productName, image, orderNo':function(){this.updateContext();}},
  lifetimes:{attached(){this.updateContext();this.updatePrivacy();this.removePrivacyObserver=observePrivacyDecision(()=>this.updatePrivacy());this.setData({supported:typeof wx.canIUse!=='function'||wx.canIUse('button.open-type.contact')});},detached(){this.removePrivacyObserver?.();}},
  pageLifetimes:{show(){this.updatePrivacy();}},
  methods:{
    updatePrivacy(){this.setData({privacyAccepted:isPrivacyAccepted()});},
    acceptPrivacy(){openPrivacyPage();},
    updateContext(){this.setData({context:customerServiceContext(this.properties)});},
    contactError(){this.setData({unavailable:true});this.triggerEvent('unavailable');if(this.properties.mode!=='primary')wx.navigateTo({url:'/pages/contact/index?email=1'});wx.showToast({title:'微信客服暂时无法打开，可通过邮箱联系。',icon:'none',duration:3000});},
    openHelp(){if(this.properties.mode==='primary'){this.setData({unavailable:true});this.triggerEvent('unavailable');}else wx.navigateTo({url:'/pages/contact/index?email=1'});},
  },
}, ["acceptPrivacy","openHelp"], {"component":true}));

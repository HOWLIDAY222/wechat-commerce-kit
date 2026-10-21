import { withTapFeedback } from '../../utils/tap-feedback';
import { hasSession } from '../../stores/session';
import { rememberServiceLoginReturn } from '../../stores/navigation';
import { feedbackDiagnostics, testFeedback } from '../../utils/haptics';
Page(withTapFeedback({
  data:{version:'0.1.0',moreOpen:false,serviceUnavailable:false,hapticTestOpen:false,hapticBusy:false,hapticStatus:'',emails:[{label:'客服与售后',address:'support@example.invalid'},{label:'一般咨询',address:'info@example.invalid'}],topics:[
    {key:'size-guide',title:'尺码与穿着',copy:'测量方法、尺码参考与穿着建议'},
    {key:'shipping-policy',title:'发货与配送',copy:'预售发货安排、运费与物流'},
    {key:'after-sales-policy',title:'退换与售后',copy:'申请条件与处理流程'},
    {key:'faq',title:'优惠券与积分',copy:'领取、使用及兑换说明'},
  ]},
  onLoad(options={}){this.disposed=false;if(options.email==='1')this.setData({moreOpen:true,serviceUnavailable:true});if(options.haptics==='1')this.setData({hapticTestOpen:true});},
  onReady(){if(this.data.hapticTestOpen)this.scrollToHaptics();},
  onUnload(){this.disposed=true;},
  scrollToHaptics(){wx.pageScrollTo?.({selector:'#haptic-test',duration:160});},
  openHapticTest(){this.setData({hapticTestOpen:true});if(wx.nextTick)wx.nextTick(()=>this.scrollToHaptics());else this.scrollToHaptics();},
  runHapticTest(event){
    if(this.data.hapticBusy)return;
    const kind=event?.currentTarget?.dataset?.kind==='long'?'long':'short';
    this.setData({hapticBusy:true,hapticStatus:''});
    testFeedback(kind,result=>{if(this.disposed)return;const label=kind==='long'?'长震动':'短震动';const messages={accepted:label+'已调用，请感受手机反馈',unsupported:'当前微信不支持此震动',failed:'震动调用失败，请复制检测信息',timeout:'微信未返回结果，请复制检测信息',throttled:'请稍等片刻再试'};this.setData({hapticBusy:false,hapticStatus:messages[result.status]||'请复制检测信息'});});
  },
  copyHapticDiagnostic(){
    let device={},base={},runtime={};
    try{device=wx.getDeviceInfo?.()||{};base=wx.getAppBaseInfo?.()||{};runtime=wx.getAccountInfoSync?.().miniProgram||{};}catch{}
    const data={version:this.data.version,platform:device.platform||'',model:device.model||'',system:device.system||'',wechatVersion:base.version||'',sdkVersion:base.SDKVersion||'',runtimeVersion:runtime.version||'',environment:runtime.envVersion||'',feedback:feedbackDiagnostics()};
    wx.setClipboardData({data:JSON.stringify(data)});
  },
  openTopic(event){const key=event.currentTarget.dataset.key;if(this.data.topics.some(topic=>topic.key===key))wx.navigateTo({url:'/pages/content/index?pageKey='+key});},
  openOrders(){this.openAccountService('orders');},
  openAfterSales(){this.openAccountService('after-sales');},
  openAccountService(destination){const route=destination==='after-sales'?'/pages/after-sales/index':'/pages/orders/index';if(hasSession())wx.navigateTo({url:route});else{rememberServiceLoginReturn(destination);wx.switchTab({url:'/pages/account/index'});}},
  toggleMore(){this.setData({moreOpen:!this.data.moreOpen});},
  serviceError(){this.setData({serviceUnavailable:true,moreOpen:true});},
  copyEmail(event){const email=this.data.emails.find(item=>item.address===event.currentTarget.dataset.email);if(email)wx.setClipboardData({data:email.address});},
  openPrivacy(){wx.navigateTo({url:'/pages/content/index?pageKey=privacy-policy'});},
}, ["openOrders","openAfterSales","openTopic","toggleMore","copyEmail","openHapticTest","openPrivacy"]));

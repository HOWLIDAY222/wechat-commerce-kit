import { withTapFeedback } from '../../utils/tap-feedback';
import {isTimelinePreview,enablePublicSharing,requireFullMiniProgram,publicShareContent,shareCoverEvents} from '../../utils/sharing';
import {mediaFeedback} from '../../utils/media-feedback';
import {fetchProductBySlug} from '../../services/catalog';
import {fetchPublishedPage} from '../../services/content';
import {documentNodes} from '../../models/document-nodes';
import {addCartItem,replaceCartItemVariant} from '../../services/cart';
import {writeGuestItem} from '../../services/guest-cart';
import {hasSession,readAccessToken} from '../../stores/session';
import {fetchMember} from '../../services/member';
import {productPriceView} from '../../models/product-price';
import {beginDirectCheckout} from '../../stores/direct-checkout';
import {maxQuantity} from '../../utils/pricing';
import {selectionState} from '../../utils/selection';
import {sizeGuideView} from '../../models/size-guide';
import {productSections,activeProductSection,sectionScrollTop} from '../../utils/product-navigation';
import {detailMediaForStyle} from '../../models/product-detail-media';
import {productGallery,galleryImageHeight} from '../../models/product-gallery';

const GALLERY_IMAGE_TIMEOUT=12000,PRODUCT_VIDEO_TIMEOUT=15000;
const PRODUCT_SECTION_NAV_HEIGHT=48;

Page(withTapFeedback({...mediaFeedback,...shareCoverEvents,
  data:{mediaLoaded:{},mediaFailed:{},mediaRetrying:{},galleryImageLoading:'',galleryImageHeights:{},galleryHeight:750,product:null,loading:true,error:'',selectedSize:'',selectedColor:'',quantity:1,totalLabel:'',sizes:[],packs:[],adding:false,editingCartItem:false,detailsOpen:true,detailSheetOpen:false,detailSections:[],careOpen:false,galleryIndex:0,galleryMedia:[],productFilm:null,activeVideoId:'',videoLoadingId:'',videoFailures:{},specOpen:false,specClosing:false,specScrollTarget:'',added:false,selectionLabel:'',unitLabel:'',savingLabel:'',addedLabel:'',guideOpen:false,guideLoading:false,guideError:'',guideNodes:[],guideTips:[],sizeMeasurements:[],commonDetailMedia:[],styleDetailMedia:[],activeSection:'overview',headerHeight:64,backTop:20,sectionNavVisible:false,priceSheetOpen:false,priceRulesOpen:false,priceView:null,priceWalletStatus:'guest'},
  onLoad(options){
    this.unloaded=false;this.pageVisible=true;this.videoVisibility={gallery:false,details:false};this.setData({isTimelinePreview:isTimelinePreview()});enablePublicSharing();
    this.updateHeaderHeight();
    this.entrySection=['details','purchase'].includes(options.section)?options.section:'';
    this.initialPurchaseIntent=options.purchaseAction==='buy'?'buy':'bag';
    this.localEditing=options.guest==='1';this.slug=options.slug;this.cartItemId=options.cartItemId||'';
    this.initialStyle=decodeOption(options.style);this.initialSize=decodeOption(options.size);this.initialColor=decodeOption(options.color);this.initialQuantity=Number(options.quantity)||1;
    this.setData({editingCartItem:!!this.cartItemId});this.load();
  },
  onShow(){this.pageVisible=true;this.updateStatusBar();this.loadPriceWallet(true);this.afterLayout(()=>{this.setupProductVideoObservers();this.syncProductVideoPlayback();});},
  onHide(){this.pageVisible=false;this.setStatusBarColor('#000000');this.pauseProductVideo();},
  async load(force=false){
    if(this.loadingProduct)return;
    this.loadingProduct=true;this.setData({loading:true,error:''});
    try{
      const product=await fetchProductBySlug(this.slug,{force});
      if(this.unloaded)return;
      if(!product)throw new Error('NOT_FOUND');
      const variant=product.variants.find(v=>v.size===this.initialSize&&v.color===this.initialColor&&!v.soldOut)||product.variants.find(v=>v.size==='M'&&!v.soldOut)||product.variants.find(v=>!v.soldOut)||product.variants[0];
      this.pauseProductVideo();
      this.setData({product,...productGallery(product),galleryIndex:0,videoFailures:{},selectedStyle:this.initialStyle||product.quantityPricing?.styles?.[0]?.key||'',selectedSize:variant?.size||'',selectedColor:variant?.color||'',quantity:Math.max(1,Math.min(maxQuantity(product),this.initialQuantity))});
      this.updateStatusBar();this.startGalleryImageLoading();this.refreshSelection();this.loadGuide();
    }catch(error){if(!this.unloaded)this.setData({error:error.message==='NOT_FOUND'?'该商品暂未上架。':'商品暂时无法加载，请稍后重试。'});}
    finally{this.loadingProduct=false;if(!this.unloaded){this.setData({loading:false,catalogNotice:getApp().globalData.catalogNotice||''});this.afterLayout(()=>{this.measureSections();this.applyEntry();this.setupProductVideoObservers();this.syncProductVideoPlayback();});}}
  },
  afterLayout(callback){if(wx.nextTick)wx.nextTick(()=>{if(!this.unloaded)callback();});else if(!this.unloaded)callback();},
  updateHeaderHeight(){if(this.data.isTimelinePreview){this.setData({headerHeight:0});return;}try{const info=wx.getWindowInfo(),capsule=wx.getMenuButtonBoundingClientRect(),status=Number(info.statusBarHeight||20),bar=Math.max(44,Math.max(0,Number(capsule.top||status)-status)*2+Number(capsule.height||32));this.setData({headerHeight:status+bar,backTop:status+(bar-44)/2});}catch{}this.updateStatusBar();},
  setStatusBarColor(frontColor){if(this.data.isTimelinePreview||this.statusFrontColor===frontColor||!wx.setNavigationBarColor)return;try{wx.setNavigationBarColor({frontColor,backgroundColor:'#ffffff'});this.statusFrontColor=frontColor;}catch{}},
  updateStatusBar(){this.setStatusBarColor(this.data.product&&!this.data.sectionNavVisible&&this.data.galleryMedia[this.data.galleryIndex]?.type==='video'?'#ffffff':'#000000');},
  goBack(){if(this.data.isTimelinePreview)return;wx.navigateBack({fail:()=>wx.switchTab({url:'/pages/home/home'})});},
  onReady(){this.afterLayout(()=>{this.measureSections();this.setupProductVideoObservers();});},
  onResize(){this.updateHeaderHeight();this.afterLayout(()=>this.measureSections());},
  measureSections(){
    if(!wx.createSelectorQuery||!this.data.product)return;
    const query=wx.createSelectorQuery();query.select('.product-nav').boundingClientRect();
    productSections.forEach(key=>query.select('#product-'+key).boundingClientRect());query.select('#product-intro').boundingClientRect();query.selectViewport().scrollOffset();
    query.exec(results=>{if(this.unloaded)return;const scroll=results[5]?.scrollTop||0;this.scrollTop=scroll;this.sectionNavHeight=results[0]?.height||PRODUCT_SECTION_NAV_HEIGHT;this.sectionPositions={};productSections.forEach((key,index)=>{if(results[index+1])this.sectionPositions[key]=results[index+1].top+scroll;});if(Number.isFinite(results[4]?.top))this.introTop=results[4].top+scroll;this.syncActiveSection();});
  },
  syncSectionNavigation(){if(!Number.isFinite(this.introTop))return;const visible=(this.scrollTop||0)>=Math.max(0,this.introTop-this.data.headerHeight);if(visible!==this.data.sectionNavVisible)this.setData({sectionNavVisible:visible});this.stickyHeight=visible?this.data.headerHeight+(this.sectionNavHeight||PRODUCT_SECTION_NAV_HEIGHT):0;this.updateStatusBar();},
  syncActiveSection(){this.syncSectionNavigation();if(this.navScrolling)return;const active=activeProductSection(this.sectionPositions,this.scrollTop||0,this.stickyHeight||0);if(active!==this.data.activeSection)this.setData({activeSection:active});},
  onPageScroll(event){this.scrollTop=event.scrollTop;this.syncActiveSection();},
  jumpToSection(event){
    const key=event.currentTarget.dataset.section;if(!productSections.includes(key))return;
    if(key==='details')this.setData({detailsOpen:true});
    if(key==='overview'){this.setData({sectionNavVisible:false,activeSection:'overview'});this.updateStatusBar();wx.pageScrollTo({scrollTop:0,duration:260});return;}
    if(!wx.createSelectorQuery){wx.pageScrollTo({selector:'#product-'+key,duration:0});return;}
    this.afterLayout(()=>{const query=wx.createSelectorQuery();query.select('#product-'+key).boundingClientRect();query.select('.product-nav').boundingClientRect();query.selectViewport().scrollOffset();query.exec(results=>{if(this.unloaded||!results[0])return;clearTimeout(this.navTimer);this.navScrolling=true;this.setData({activeSection:key});wx.pageScrollTo({scrollTop:sectionScrollTop(results[0].top,results[2]?.scrollTop||0,this.data.headerHeight+(results[1]?.height||PRODUCT_SECTION_NAV_HEIGHT)),duration:260});this.navTimer=setTimeout(()=>{this.navScrolling=false;this.measureSections();},320);});});
  },
  retry(){this.load(true);},
  applyEntry(){
    const section=this.entrySection;this.entrySection='';
    if(section==='purchase')this.openSpecs(this.initialPurchaseIntent);
    else if(section==='details'){
      this.jumpToSection({currentTarget:{dataset:{section:'details'}}});
    }
  },
  refreshSelection(){const selection=selectionState(this.data.product,this.data.selectedSize,this.data.selectedColor,this.data.quantity,this.data.selectedStyle);this.setData({...selection,...detailMediaForStyle(this.data.product,selection.selectedStyle),...(this.guidePage?sizeGuideView(this.guidePage,this.data.selectedSize):{})});this.refreshPriceView();this.afterLayout(()=>this.measureSections());},
  refreshPriceView(){
    if(!this.data.product)return;
    const currentSession=this.priceWalletSession?readAccessToken():'';
    const matches=currentSession&&this.priceWalletSession===currentSession&&!this.data.isTimelinePreview;
    const status=this.data.isTimelinePreview||!currentSession?'guest':matches?this.data.priceWalletStatus:'guest';
    this.setData({priceView:productPriceView(this.data.product,this.data,matches?this.priceWallet||[]:[],status)});
  },
  async loadPriceWallet(force=false){
    const session=this.data.isTimelinePreview?'':readAccessToken();
    if(!session){this.priceWallet=[];this.priceWalletSession='';this.priceWalletLoadId=(this.priceWalletLoadId||0)+1;this.setData({priceWalletStatus:'guest'});this.refreshPriceView();return;}
    if(this.priceWalletRequestSession===session)return;
    const age=Date.now()-(this.priceWalletLoadedAt||0);
    if(force!==true&&this.priceWalletSession===session&&this.data.priceWalletStatus==='ready'&&age>=0&&age<60000){this.refreshPriceView();return;}
    const loadId=this.priceWalletLoadId=(this.priceWalletLoadId||0)+1;
    this.priceWalletRequestSession=session;this.priceWalletSession=session;this.priceWallet=[];this.setData({priceWalletStatus:'loading'});this.refreshPriceView();
    try{
      const overview=await fetchMember();
      if(this.unloaded||loadId!==this.priceWalletLoadId||readAccessToken()!==session)return;
      this.priceWallet=overview.wallet;this.priceWalletLoadedAt=Date.now();this.setData({priceWalletStatus:'ready'});this.refreshPriceView();
    }catch{
      if(!this.unloaded&&loadId===this.priceWalletLoadId&&readAccessToken()===session){this.priceWallet=[];this.setData({priceWalletStatus:'error'});this.refreshPriceView();}
    }finally{if(this.priceWalletRequestSession===session)this.priceWalletRequestSession='';}
  },
  openPriceDetails(){if(!this.data.product?.showPrice||this.data.adding)return;this.pauseProductVideo();this.setData({priceSheetOpen:true,priceRulesOpen:false});this.refreshPriceView();this.loadPriceWallet();},
  closePriceDetails(){this.setData({priceSheetOpen:false});this.syncProductVideoPlayback();},
  togglePriceRules(){this.setData({priceRulesOpen:!this.data.priceRulesOpen});},
  selectFromPriceDetails(){this.closePriceDetails();if(!this.data.specOpen)this.openSpecs();},
  openPriceWallet(){if(!requireFullMiniProgram(this.data.isTimelinePreview))return;this.closePriceDetails();wx.navigateTo({url:'/pages/member/index?section=wallet'});},
  chooseStyle(event){if(this.data.adding)return;const key=event.currentTarget.dataset.style;if(!this.data.product.quantityPricing?.styles?.some(s=>s.key===key))return;this.setData({selectedStyle:key,added:false});this.refreshSelection();},
  chooseSize(event){if(event.currentTarget.dataset.disabled||this.data.adding)return;this.setData({selectedSize:event.currentTarget.dataset.size});this.refreshSelection();},
  applyFitSize(event){if(this.data.adding||this.data.isTimelinePreview)return;const size=event.detail.size;if(!this.data.sizes.some(row=>row.size===size&&!row.disabled))return;this.setData({selectedSize:size});this.refreshSelection();this.closeGuide();},
  choosePack(event){if(event.currentTarget.dataset.disabled||this.data.adding)return;this.setData({quantity:Number(event.currentTarget.dataset.quantity)});this.refreshSelection();},
  changeQuantity(event){if(this.data.adding)return;this.setData({quantity:Math.max(1,Math.min(this.data.quantityLimit||1,this.data.quantity+Number(event.currentTarget.dataset.delta))),added:false});this.refreshSelection();},
  inputQuantity(event){if(this.data.adding)return;const q=Number(event.detail.value);this.setData({quantity:Number.isInteger(q)?Math.max(1,Math.min(this.data.quantityLimit||1,q)):1,added:false});this.refreshSelection();},
  onGalleryChange(event){this.selectGalleryMedia(event.detail.current);},
  chooseImage(event){this.selectGalleryMedia(Number(event.currentTarget.dataset.index));},
  selectGalleryMedia(index){
    if(!Number.isInteger(index)||index<0||index>=this.data.galleryMedia.length||index===this.data.galleryIndex)return;
    this.pauseProductVideo();const item=this.data.galleryMedia[index];
    this.setData({galleryIndex:index,galleryHeight:item.type==='video'?562.5:(this.data.galleryImageHeights[item.source]||750)});
    this.updateStatusBar();this.startGalleryImageLoading();this.syncProductVideoPlayback();this.afterLayout(()=>this.measureSections());
  },
  startGalleryImageLoading(){
    clearTimeout(this.galleryImageTimer);const item=this.data.galleryMedia[this.data.galleryIndex];
    if(item?.type==='image'&&this.data.galleryImageHeights[item.source])this.setData({galleryHeight:this.data.galleryImageHeights[item.source]});
    if(item?.type!=='image'||this.data.mediaLoaded[item.source]||this.data.mediaFailed[item.source]){this.setData({galleryImageLoading:''});return;}
    const source=item.source;this.setData({galleryImageLoading:source});
    this.galleryImageTimer=setTimeout(()=>{if(!this.unloaded&&this.data.galleryImageLoading===source)this.onMediaError({currentTarget:{dataset:{source}}});},GALLERY_IMAGE_TIMEOUT);
  },
  onMediaLoad(event){
    mediaFeedback.onMediaLoad.call(this,event);const source=event.currentTarget.dataset.source;
    if(source===this.data.galleryImageLoading){clearTimeout(this.galleryImageTimer);this.setData({galleryImageLoading:''});}
    if(!this.data.galleryMedia.some(item=>item.type==='image'&&item.source===source))return;
    const height=galleryImageHeight(event.detail?.width,event.detail?.height);
    this.setData({galleryImageHeights:{...this.data.galleryImageHeights,[source]:height}});
    if(this.data.galleryMedia[this.data.galleryIndex]?.source===source){this.setData({galleryHeight:height});this.afterLayout(()=>this.measureSections());}
  },
  onMediaError(event){
    mediaFeedback.onMediaError.call(this,event);
    if(event.currentTarget.dataset.source===this.data.galleryImageLoading){clearTimeout(this.galleryImageTimer);this.setData({galleryImageLoading:''});}
  },
  onMediaRetry(event){
    mediaFeedback.onMediaRetry.call(this,event);
    if(this.data.galleryMedia[this.data.galleryIndex]?.source===event.currentTarget.dataset.source)this.startGalleryImageLoading();
  },
  pauseProductVideo(){
    clearTimeout(this.productVideoTimer);const id=this.data.activeVideoId;
    if(!id){if(this.data.videoLoadingId)this.setData({videoLoadingId:''});return;}
    try{wx.createVideoContext(id,this).pause();}catch{}
    this.setData({activeVideoId:'',videoLoadingId:''});
  },
  setupProductVideoObservers(){
    if(!this.data.productFilm||!wx.createIntersectionObserver||this.productVideoObservers?.length)return;
    this.videoVisibility={gallery:false,details:false};this.productVideoObservers=[];
    [['gallery','#product-gallery-frame'],['details','#product-detail-film']].forEach(([key,selector])=>{
      const observer=wx.createIntersectionObserver(this,{thresholds:[0,.2]});
      observer.relativeToViewport({top:-this.data.headerHeight}).observe(selector,result=>{
        if(this.unloaded)return;this.videoVisibility[key]=result.intersectionRatio>=.2;this.syncProductVideoPlayback();
      });
      this.productVideoObservers.push(observer);
    });
  },
  syncProductVideoPlayback(){
    const blocked=this.pageVisible===false||this.unloaded||this.data.specOpen||this.data.detailSheetOpen||this.data.priceSheetOpen;
    const galleryVisible=this.videoVisibility?.gallery&&this.data.galleryMedia[this.data.galleryIndex]?.type==='video';
    const id=blocked?'':galleryVisible?'product-gallery-video':this.videoVisibility?.details?'product-detail-video':'';
    if(!id||!this.data.productFilm||this.data.videoFailures[id]){this.pauseProductVideo();return;}
    if(this.data.activeVideoId===id)return;
    this.pauseProductVideo();this.setData({activeVideoId:id});this.startProductVideoLoading(id);
  },
  playProductVideo(event){
    const id=event.currentTarget.dataset.videoId;
    if(!this.data.productFilm||!['product-gallery-video','product-detail-video'].includes(id))return;
    this.setData({videoFailures:{...this.data.videoFailures,[id]:false}});this.syncProductVideoPlayback();
  },
  startProductVideoLoading(id){
    if(id!==this.data.activeVideoId||this.data.videoLoadingId===id)return;
    clearTimeout(this.productVideoTimer);this.setData({videoLoadingId:id});
    this.productVideoTimer=setTimeout(()=>{if(!this.unloaded&&this.data.activeVideoId===id&&this.data.videoLoadingId===id)this.onProductVideoError({currentTarget:{id}});},PRODUCT_VIDEO_TIMEOUT);
  },
  onProductVideoWaiting(event){this.startProductVideoLoading(event.currentTarget.id);},
  onProductVideoReady(event){
    if(event.currentTarget.id!==this.data.activeVideoId)return;
    clearTimeout(this.productVideoTimer);if(this.data.videoLoadingId)this.setData({videoLoadingId:''});
  },
  onProductVideoEnded(){this.syncProductVideoPlayback();},
  onProductVideoError(event){
    const id=event.currentTarget.id;if(!['product-gallery-video','product-detail-video'].includes(id))return;
    if(id===this.data.activeVideoId)this.pauseProductVideo();
    this.setData({videoFailures:{...this.data.videoFailures,[id]:true}});
  },
  handlePurchaseAction(){this.openSpecs('bag');},
  beginAddToBag(){this.openSpecs('bag');},
  beginBuyNow(){if(requireFullMiniProgram(this.data.isTimelinePreview)&&!this.cartItemId)this.openSpecs('buy');},
  confirmPurchase(){if(this.data.purchaseIntent==='buy')return this.buySelection();return this.addToCart();},
  async buySelection(){
    if(!requireFullMiniProgram(this.data.isTimelinePreview)||this.cartItemId||this.data.adding||!this.data.product?.isPurchasable||!this.data.variant||this.data.variant.soldOut)return;
    this.setData({adding:true});
    try{
      beginDirectCheckout({productSlug:this.slug,style:this.data.selectedStyle||undefined,color:this.data.selectedColor,size:this.data.selectedSize,quantity:this.data.quantity});
      await new Promise((resolve,reject)=>wx.navigateTo({url:'/pages/checkout/index?mode=direct',success:resolve,fail:reject}));
      this.dismissSpecs();
    }catch{if(!this.unloaded)wx.showToast({title:'未能进入结算，请重试。',icon:'none'});}
    finally{if(!this.unloaded)this.setData({adding:false});}
  },
  openSpecs(intent='bag'){if(this.data.adding)return;this.pauseProductVideo();clearTimeout(this.specTimer);this.returnToSpecs=false;this.setData({purchaseIntent:intent==='buy'?'buy':'bag',detailSheetOpen:false,priceSheetOpen:false,specOpen:true,specClosing:false,guideOpen:false,added:false,specScrollTarget:'spec-selection-start'});},
  closeSpecs(){if(!this.data.adding)this.dismissSpecs();},
  dismissSpecs(){
    if(!this.data.specOpen)return;clearTimeout(this.specTimer);this.setData({specClosing:true});
    this.specTimer=setTimeout(()=>{if(!this.unloaded){this.setData({specOpen:false,specClosing:false,guideOpen:false,specScrollTarget:''});this.syncProductVideoPlayback();}},180);
  },
  onUnload(){this.pageVisible=false;this.setStatusBarColor('#000000');this.pauseProductVideo();this.productVideoObservers?.forEach(observer=>observer.disconnect());this.productVideoObservers=[];clearTimeout(this.galleryImageTimer);this.unloaded=true;this.priceWalletLoadId=(this.priceWalletLoadId||0)+1;clearTimeout(this.specTimer);clearTimeout(this.navTimer);},
  stopSheet(){},
  openProductDetails(){if(!this.data.product||this.data.adding)return;this.pauseProductVideo();clearTimeout(this.specTimer);this.returnToSpecs=!!this.data.specOpen;this.setData({detailSheetOpen:true,priceSheetOpen:false,specOpen:false,specClosing:false});},
  closeProductDetails(){this.setData({detailSheetOpen:false});if(this.returnToSpecs){this.returnToSpecs=false;this.openSpecs(this.data.purchaseIntent);}else this.syncProductVideoPlayback();},
  shopFromDetails(){this.returnToSpecs=false;this.setData({detailSheetOpen:false});this.openSpecs(this.data.purchaseIntent);},
  async addToCart(){if(!requireFullMiniProgram(this.data.isTimelinePreview))return;
    if(this.data.adding||!this.data.product?.isPurchasable||!this.data.variant||this.data.variant.soldOut)return;
    this.setData({adding:true});
    try{
      const input={productSlug:this.slug,style:this.data.selectedStyle||undefined,color:this.data.selectedColor,size:this.data.selectedSize,quantity:this.data.quantity};
      if(hasSession()&&!this.localEditing){if(this.cartItemId)await replaceCartItemVariant(this.cartItemId,{...input,expectedQuantity:this.initialQuantity});else await addCartItem(input);}
      else await writeGuestItem(input,this.cartItemId);
      if(this.unloaded)return;
      this.dismissSpecs();this.setData({added:true,addedLabel:this.data.selectionLabel});
      wx.showToast({title:this.cartItemId?'购物袋已更新':'已加入购物袋',icon:'success'});
      if(this.cartItemId)wx.navigateBack();
    }catch(error){
      const messages={PRODUCT_QUANTITY_LIMIT_EXCEEDED:'已超过选购上限，请调整购物袋。',CART_CHANGED:'购物袋已变化，请返回购物袋刷新。',CART_SYNC_PENDING:'购物袋同步尚未确认，请到购物袋重试。',QUANTITY_LIMIT_EXCEEDED:'此商品每次最多选购 '+maxQuantity(this.data.product)+' 条，请调整购物袋。',INSUFFICIENT_INVENTORY:'该尺码库存不足，请重新选择。',PRODUCT_NOT_PURCHASABLE:'商品发售状态已更新，请刷新。'};
      if(!this.unloaded)wx.showToast({title:messages[error.message]||'未能加入购物袋，请稍后重试。',icon:'none',duration:3000});
    }finally{if(!this.unloaded)this.setData({adding:false});}
  },
  toggleSection(event){const key=event.currentTarget.dataset.section;if(!['detailsOpen','careOpen'].includes(key))return;this.setData({[key]:!this.data[key]});this.afterLayout(()=>this.measureSections());},
  openContact(){if(!requireFullMiniProgram(this.data.isTimelinePreview))return;wx.navigateTo({url:'/pages/contact/index'});},
  openBag(){if(!requireFullMiniProgram(this.data.isTimelinePreview))return;wx.switchTab({url:'/pages/cart/index'});},
  async openGuide(){
    if(!this.data.specOpen)this.openSpecs();
    this.setData({guideOpen:true,specScrollTarget:'spec-guide-start'});
    await this.loadGuide();
  },
  async loadGuide(){
    if(this.data.guideNodes.length||this.data.guideLoading)return;
    this.setData({guideLoading:true,guideError:''});
    try{
      const page=await fetchPublishedPage('size-guide');
      if(!this.unloaded){this.guidePage=page;this.setData({guideNodes:documentNodes(page),...sizeGuideView(page,this.data.selectedSize)});this.afterLayout(()=>this.measureSections());}
    }catch{if(!this.unloaded)this.setData({guideError:'尺码指南暂时无法加载，请重试。'});}
    finally{if(!this.unloaded)this.setData({guideLoading:false});}
  },
  closeGuide(){this.setData({guideOpen:false,specScrollTarget:'spec-size-options'});},
  openDelivery(){if(!requireFullMiniProgram(this.data.isTimelinePreview))return;wx.navigateTo({url:'/pages/content/index?pageKey=shipping-policy'});},
  previewImage(event){if(!requireFullMiniProgram(this.data.isTimelinePreview))return;const product=this.data.product,images=product.previewImages||product.images,index=product.images.indexOf(event.currentTarget.dataset.src);if(index<0||!images[index])return;this.pauseProductVideo();wx.previewImage({current:images[index],urls:images});},
  previewDetailImage(event){if(!requireFullMiniProgram(this.data.isTimelinePreview))return;const images=[...(this.data.commonDetailMedia||[]),...(this.data.styleDetailMedia||[])].map(image=>image.previewUrl);const current=event.currentTarget.dataset.src;if(images.includes(current))wx.previewImage({current,urls:images});},
  shareContent(){return publicShareContent({page:'product',product:this.data.product,slug:this.slug,style:this.data.selectedStyle,cover:this.data.shareCover,coverSource:this.data.shareCoverSource});},
  onShareAppMessage(){return this.shareContent().message;},
  onShareTimeline(){return this.shareContent().timeline;},
}, ["goBack","retry","previewImage","onMediaRetry","playProductVideo","chooseImage","jumpToSection","openPriceDetails","openProductDetails","openSpecs","openDelivery","loadGuide","openGuide","previewDetailImage","toggleSection","openContact","openBag","beginAddToBag","beginBuyNow","closeSpecs","chooseStyle","chooseSize","changeQuantity","choosePack","closeGuide","confirmPurchase","closeProductDetails","shopFromDetails","closePriceDetails","loadPriceWallet","openPriceWallet","togglePriceRules","selectFromPriceDetails"]));

function decodeOption(value){try{return decodeURIComponent(value||'');}catch{return value||'';}}

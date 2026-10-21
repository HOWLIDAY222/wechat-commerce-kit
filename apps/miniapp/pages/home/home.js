import { withTapFeedback } from '../../utils/tap-feedback';
import {isTimelinePreview,enablePublicSharing,requireFullMiniProgram,publicShareContent,shareCoverEvents} from '../../utils/sharing';
import {mediaFeedback} from '../../utils/media-feedback';
import {homePresentation} from '../../models/home-presentation';
import {fetchProducts} from '../../services/catalog';
import {fetchPublishedPage,toNativeContentSections} from '../../services/content';
import {readPage} from '../../stores/content';
import {navigateToManagedPage,navigateToProduct,navigateToPage} from '../../utils/navigation';

Page(withTapFeedback({...mediaFeedback,...shareCoverEvents,
  data:{mediaLoaded:{},mediaFailed:{},loading:false,error:'',notice:'',product:null,sections:[],introductionAnchor:'',
    campaignSectionId:'',campaignVideoSrc:'',
    campaignVideoPoster:'https://example.invalid/assets/campaign/x1-air-20261016/hero-poster.webp',
    campaignPosterLoading:true,campaignVideoLoading:false,campaignInViewport:false,
    campaignVideoMounted:false,campaignVideoFailed:false,campaignVideoMuted:true},
  onLoad(){this.setData({isTimelinePreview:isTimelinePreview()});enablePublicSharing();this.load();},
  onShow(){this.homeVisible=true;this.load();this.observeCampaignVideo();},
  onHide(){this.homeVisible=false;this.pauseCampaignVideo();this.disconnectCampaignObserver();},
  onUnload(){this.unloaded=true;this.homeVisible=false;this.pauseCampaignVideo();this.disconnectCampaignObserver();},
  onPullDownRefresh(){this.load(true);},
  async load(force=false){
    if(this.loadingHome)return;
    this.loadingHome=true;
    this.setData({loading:true,error:'',notice:''});
    let products=this.products||[];
    let page=null;
    let contentFailed=false;
    let catalogFailed=false;
    const render=()=>{
      if(!page||this.unloaded)return;
      const notice=contentFailed?'暂时无法更新，正在显示最近保存的内容。':catalogFailed?'商品暂时无法加载，请稍后重试。':'';
      if(this.renderedHomePage===page&&this.renderedHomeProducts===products){
        if(this.data.notice!==notice)this.setData({notice});
        return;
      }
      const presentation=homePresentation(toNativeContentSections(page),products);
      this.setData({
        ...presentation,
        campaignSectionId:presentation.sections.find(section=>section.type==='hero')?.id||'',
        notice,
      });
      this.renderedHomePage=page;this.renderedHomeProducts=products;
      this.observeCampaignVideo();
    };
    // Render published content without waiting for catalog loading. Normal tab
    // returns reuse the 60-second cache; pull-to-refresh bypasses it.
    await Promise.allSettled([
      fetchProducts({force}).then(value=>{products=value;this.products=value;render();}).catch(()=>{catalogFailed=true;render();}),
      fetchPublishedPage('home',{force}).then(value=>{page=value;render();}).catch(()=>{
        contentFailed=true;
        page=readPage('home',true);
        if(page)render();
        else if(!this.unloaded)this.setData({error:'页面暂时无法加载，请稍后重试。'});
      }),
    ]);
    this.loadingHome=false;
    if(!this.unloaded)this.setData({loading:false,catalogNotice:getApp().globalData.catalogNotice||''});
    wx.stopPullDownRefresh();
  },
  retry(){this.load(true);},
  // Load the film only while its hero is visible; every automatic start is muted.
  observeCampaignVideo(){
    if(!this.homeVisible||!this.data.campaignSectionId||this.campaignObserver)return;
    const observe=()=>{
      if(this.unloaded||!this.homeVisible||this.campaignObserver)return;
      if(!wx.createIntersectionObserver){this.onCampaignVisibility(true);return;}
      this.campaignObserver=wx.createIntersectionObserver(this,{thresholds:[0,.05]});
      this.campaignObserver.relativeToViewport().observe('.campaign-video-frame',entry=>this.onCampaignVisibility(entry.intersectionRatio>.05));
    };
    if(wx.nextTick)wx.nextTick(observe);else observe();
  },
  disconnectCampaignObserver(){this.campaignObserver?.disconnect();this.campaignObserver=null;},
  onCampaignVisibility(visible){
    if(this.unloaded)return;
    if(this.data.campaignInViewport!==visible)this.setData({campaignInViewport:visible});
    if(visible&&this.homeVisible&&!this.data.campaignVideoFailed)this.startCampaignVideo();
    else this.pauseCampaignVideo();
  },
  startCampaignVideo(){
    if(this.campaignPlaybackRequested||this.unloaded)return;
    this.campaignPlaybackRequested=true;
    const mounted=this.data.campaignVideoMounted;
    this.setData({campaignVideoMounted:true,campaignVideoFailed:false,campaignVideoMuted:true,campaignVideoLoading:true});
    if(mounted){
      const play=()=>{if(!this.unloaded&&this.homeVisible&&this.data.campaignInViewport){try{wx.createVideoContext('home-campaign-video',this).play();}catch(_){}}};
      if(wx.nextTick)wx.nextTick(play);else play();
    }
  },
  openCampaignVideo(){this.startCampaignVideo();},
  toggleCampaignSound(){this.setData({campaignVideoMuted:!this.data.campaignVideoMuted});},
  onCampaignPosterLoad(event){if(this.unloaded)return;this.onMediaLoad(event);this.setData({campaignPosterLoading:false});},
  onCampaignPosterError(event){if(this.unloaded)return;this.onMediaError(event);this.setData({campaignPosterLoading:false});},
  onCampaignPosterTimeout(){
    if(this.unloaded)return;
    this.setData({campaignPosterLoading:false,mediaFailed:{...this.data.mediaFailed,[this.data.campaignVideoPoster]:true}});
  },
  onCampaignVideoWaiting(){if(!this.unloaded)this.setData({campaignVideoLoading:true});},
  onCampaignVideoReady(){if(!this.unloaded&&this.data.campaignVideoLoading)this.setData({campaignVideoLoading:false});},
  pauseCampaignVideo(){
    this.campaignPlaybackRequested=false;
    if(!this.data.campaignVideoMounted)return;
    try{wx.createVideoContext('home-campaign-video',this).pause();}catch(_){}
    this.onCampaignVideoReady();
  },
  onCampaignVideoError(){
    if(this.unloaded)return;
    this.campaignPlaybackRequested=false;
    this.setData({campaignVideoMounted:false,campaignVideoFailed:true,campaignVideoMuted:true,campaignVideoLoading:false});
  },
  openLink(e){if(!requireFullMiniProgram(this.data.isTimelinePreview))return;
    const {link,section:sectionId}=e.currentTarget.dataset;
    const section=this.data.sections.find(value=>value.id===sectionId);
    // Generic campaign links browse the introduction in place. Explicit CMS
    // destinations and query-driven shopping links retain their meaning.
    if(section && link?.pageKey==='shop' && !link.query){
      if(section.type==='productGrid')this.openPurchase({currentTarget:{dataset:{slug:section.products?.[0]?.slug}}});
      else this.openIntroduction();
      return;
    }
    navigateToManagedPage(link);
  },
  openIntroduction(){
    if(!this.data.introductionAnchor)return;
    const selector='#'+this.data.introductionAnchor;
    if(!wx.createSelectorQuery){wx.pageScrollTo({selector,duration:260});return;}
    const header=this.selectComponent?.('#home-brand-header')?.data;
    const headerHeight=this.data.isTimelinePreview?0:header?header.statusBarHeight+header.navigationBarHeight:64;
    const query=wx.createSelectorQuery();query.select(selector).boundingClientRect();query.selectViewport().scrollOffset();
    query.exec(rects=>{if(!rects[0])return;wx.pageScrollTo({scrollTop:Math.max(0,rects[0].top+(rects[1]?.scrollTop||0)-headerHeight-12),duration:260});});
  },
  openProduct(){if(!requireFullMiniProgram(this.data.isTimelinePreview))return;this.openIntroduction();},
  openPurchase(e){
    if(!requireFullMiniProgram(this.data.isTimelinePreview))return;
    const slug=e?.currentTarget?.dataset?.slug||this.data.product?.slug;
    if(!slug){wx.showToast({title:'商品正在加载，请稍后重试',icon:'none'});return;}
    navigateToProduct(slug,'purchase');
  },
  openSearch(){if(!requireFullMiniProgram(this.data.isTimelinePreview))return;navigateToManagedPage({pageKey:'shop',query:'focus=1'});},
  openSubscriptions(){if(!requireFullMiniProgram(this.data.isTimelinePreview))return;navigateToPage('/pages/subscriptions/index');},
  openProducts(){if(!requireFullMiniProgram(this.data.isTimelinePreview))return;navigateToManagedPage('shop');},
  openStory(){if(!requireFullMiniProgram(this.data.isTimelinePreview))return;navigateToManagedPage('about');},
  shareContent(){return publicShareContent({product:this.data.product,cover:this.data.shareCover,coverSource:this.data.shareCoverSource});},
  onShareAppMessage(){return this.shareContent().message;},
  onShareTimeline(){return this.shareContent().timeline;},
}, ["retry","openIntroduction","openStory","openCampaignVideo","toggleCampaignSound","onMediaRetry","openLink","openPurchase","openSubscriptions"], {"tabBar":true}));

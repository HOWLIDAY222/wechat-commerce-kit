import { servicePage } from '../../utils/service-page';
import { fetchProductBySlug } from '../../services/catalog';
import { careGuide } from '../../models/service-guides';
import { navigateToPage, navigateToProduct } from '../../utils/navigation';

Page(servicePage('/pages/care-guide/index',{
  data:{loading:false,error:'',guide:null,activeTab:'essentials'},
  onAuthorized(){return this.loadGuide();},
  onInvalidate(){this.setData({guide:null,loading:false});},
  async loadGuide(){
    if(!this.ensureServiceAccess()||this.data.loading)return;
    const id=this.accessId;this.setData({loading:true,error:'',guide:null});
    try{
      const product=await fetchProductBySlug('x1-air-white',{force:true});
      if(!this.requestIsCurrent(id)||!this.ensureServiceAccess())return;
      const guide=careGuide(product);if(!guide)throw Error('CARE_UNAVAILABLE');
      this.setData({guide});
    }catch(error){if(this.requestIsCurrent(id)){if(!this.ensureServiceAccess())return;this.setData({error:error?.message==='CARE_UNAVAILABLE'?'该商品洗护说明暂未发布，请联系客服。':'洗护指南加载失败，请重试。'});}}
    finally{if(this.requestIsCurrent(id))this.setData({loading:false});}
  },
  changeTab(event){if(!this.ensureServiceAccess())return;const tab=event.currentTarget.dataset.tab;if(['essentials','steps'].includes(tab))this.setData({activeTab:tab});},
  openProduct(){if(this.ensureServiceAccess())navigateToProduct('x1-air-white');},
  openHelp(){navigateToPage('/pages/contact/index');},
},['loadGuide','changeTab','openProduct','openHelp']));

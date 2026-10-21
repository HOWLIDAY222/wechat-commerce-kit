import { servicePage } from '../../utils/service-page';
import { fetchProductBySlug } from '../../services/catalog';
import { fetchPublishedPage } from '../../services/content';
import { publishedSizeGuide, queryPublishedSize } from '../../models/service-guides';
import { navigateToPage } from '../../utils/navigation';

Page(servicePage('/pages/size-guide/index', {
  data:{loading:false,error:'',productName:'',rows:[],tips:[],activeTab:'table',selectedSize:'',fields:{waistCm:'',weightKg:'',preference:'regular'},queryError:'',result:null,measureOpen:false},
  onAuthorized(){return this.loadGuide();},
  onInvalidate(){this.setData({rows:[],tips:[],productName:'',loading:false,fields:{waistCm:'',weightKg:'',preference:'regular'},result:null,queryError:'',selectedSize:'',measureOpen:false});},
  async loadGuide(){
    if(!this.ensureServiceAccess()||this.data.loading)return;
    const id=this.accessId;this.setData({loading:true,error:'',rows:[],tips:[],result:null,selectedSize:''});
    try{
      const [product,page]=await Promise.all([fetchProductBySlug('x1-air-white',{force:true}),fetchPublishedPage('size-guide',{force:true})]);
      if(!this.requestIsCurrent(id)||!this.ensureServiceAccess())return;
      const guide=publishedSizeGuide(page,product);
      if(!guide.rows.length)throw Error('SIZE_GUIDE_UNAVAILABLE');
      this.setData({productName:product.displayName||product.name,rows:guide.rows,tips:guide.tips});
    }catch(error){if(this.requestIsCurrent(id)){if(!this.ensureServiceAccess())return;this.setData({error:error?.message==='SIZE_GUIDE_UNAVAILABLE'?'该商品尺码表暂未发布，请联系客服。':'尺码表加载失败，请重试。'});}}
    finally{if(this.requestIsCurrent(id))this.setData({loading:false});}
  },
  changeTab(event){if(!this.ensureServiceAccess())return;const tab=event.currentTarget.dataset.tab;if(['table','query'].includes(tab))this.setData({activeTab:tab});},
  selectSize(event){if(!this.ensureServiceAccess())return;const size=event.currentTarget.dataset.size;if(this.data.rows.some(row=>row.size===size))this.setData({selectedSize:size});},
  input(event){if(!this.ensureServiceAccess())return;const key=event.currentTarget.dataset.key;if(['waistCm','weightKg'].includes(key))this.setData({fields:{...this.data.fields,[key]:event.detail.value},queryError:'',result:null,selectedSize:''});},
  choosePreference(event){if(!this.ensureServiceAccess())return;const preference=event.currentTarget.dataset.preference;if(['regular','relaxed'].includes(preference))this.setData({fields:{...this.data.fields,preference},queryError:'',result:null,selectedSize:''});},
  querySize(){
    if(!this.ensureServiceAccess()||!this.data.rows.length)return;
    try{const result=queryPublishedSize(this.data.rows,this.data.fields);this.setData({result,selectedSize:result.recommended,queryError:''});}
    catch(error){const copy={WAIST_REQUIRED:'请先填写腰围。',INVALID_WAIST:'腰围请填写40–200 cm之间的数值，最多一位小数。',INVALID_WEIGHT:'体重请填写20–300 kg之间的数值，最多一位小数。'};this.setData({queryError:copy[error.message]||'请检查填写的数值。',result:null,selectedSize:''});}
  },
  showResultTable(){if(this.ensureServiceAccess())this.setData({activeTab:'table'});},
  openMeasure(){if(this.ensureServiceAccess())this.setData({measureOpen:true});},
  closeMeasure(){this.setData({measureOpen:false});},
  stopTouch(){},
  openProfile(){if(this.ensureServiceAccess())navigateToPage('/pages/fit-profile/index');},
  openHelp(){navigateToPage('/pages/contact/index');},
},['loadGuide','changeTab','selectSize','choosePreference','querySize','showResultTable','openMeasure','closeMeasure','openProfile','openHelp']));

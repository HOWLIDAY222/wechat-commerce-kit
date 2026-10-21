import { withTapFeedback } from '../../utils/tap-feedback';
import {mediaFeedback} from '../../utils/media-feedback';
import { fetchGuestCart, updateGuestQuantity, readGuestItems, clearGuestItems } from '../../services/guest-cart';
import { fetchCart, updateCartItem } from '../../services/cart';
import { hasPendingGuestSync } from '../../services/guest-sync';
import { hasSession } from '../../stores/session';
import { config } from '../../config/index';
import { rememberCheckoutLoginReturn } from '../../stores/navigation';
import { navigateToPage, navigateToProduct } from '../../utils/navigation';
Page(withTapFeedback({...mediaFeedback,
  data:{mediaLoaded:{},mediaFailed:{},cart:null,loading:true,error:'',syncNotice:'',syncBlocked:false,loggedIn:false,updatingItemId:''},
  onShow(){this.loadCart();},
  onPullDownRefresh(){this.loadCart();},
  async loadCart(){
    if(this.cartLoading)return;
    this.cartLoading=true;
    this.setData({loading:true,error:'',syncNotice:'',loggedIn:hasSession()});
    try { this.setData({cart:hasSession()?await fetchCart():await fetchGuestCart(),syncBlocked:false}); }
    catch(error){
      if(hasSession()&&readGuestItems().length){
        try {
          const cart=await fetchGuestCart();
          this.setData({cart,syncBlocked:hasPendingGuestSync(),syncNotice:cartError(error.message)});
        } catch { this.setData({error:'购物袋暂时无法更新，请检查网络后重试。'}); }
      }else this.setData({error:'购物袋暂时无法更新，请检查网络后重试。'});
    }finally{this.cartLoading=false;this.setData({loading:false});wx.stopPullDownRefresh();}
  },
  retry(){this.loadCart();},
  async useAccountBag(){
    if(this.data.syncBlocked)return;
    const result=await wx.showModal({title:'使用账户购物袋',content:'将移除尚未同步的本机商品，保留账户中已有的商品。是否继续？'});
    if(result.confirm){clearGuestItems();this.loadCart();}
  },
  async applyQuantity(id,quantity){
    if(this.data.updatingItemId||this.data.syncBlocked)return;
    this.setData({updatingItemId:id,error:''});
    try {this.setData({cart:this.data.cart?.guest?await updateGuestQuantity(id,quantity):await updateCartItem(id,quantity)});}
    catch(error){this.setData({error:cartError(error.message)});}
    finally{this.setData({updatingItemId:''});}
  },
  changeQuantity(event){
    if(this.data.updatingItemId||this.data.syncBlocked||this.data.loading||this.removalPending)return;
    const d=event.currentTarget.dataset;
    if(Number(d.quantity)===1&&Number(d.delta)===-1){this.removeItem(event);return;}
    this.applyQuantity(d.id,Math.max(0,Number(d.quantity)+Number(d.delta)));
  },
  inputQuantity(event){
    if(this.data.updatingItemId||this.data.syncBlocked||this.data.loading||this.removalPending)return;
    const item=this.data.cart?.items.find(i=>i.id===event.currentTarget.dataset.id);if(!item)return;
    const q=Number(event.detail.value),limit=item.quantityLimit??99;
    if(!Number.isInteger(q)||q<1||q>limit){wx.showToast({title:'请输入1至'+Math.max(1,limit)+'的整数数量',icon:'none'});this.setData({cart:this.data.cart});return;}
    if(q!==item.quantity)this.applyQuantity(item.id,q);
  },
  async removeItem(event){
    if(this.data.updatingItemId||this.data.syncBlocked||this.data.loading||this.removalPending)return;
    this.removalPending=true;
    try{const result=await wx.showModal({title:'移除商品',content:'确定从购物袋移除这件商品吗？'});if(result.confirm)await this.applyQuantity(event.currentTarget.dataset.id,0);}
    finally{this.removalPending=false;}
  },
  openProduct(event){navigateToProduct(event.currentTarget.dataset.slug);},
  editVariant(event){
    if(this.data.syncBlocked||this.data.updatingItemId||this.data.loading)return;
    const d=event.currentTarget.dataset;
    navigateToPage('/pages/product-detail/index?slug='+encodeURIComponent(d.slug)+'&cartItemId='+encodeURIComponent(d.id)+'&size='+encodeURIComponent(d.size)+'&color='+encodeURIComponent(d.color)+'&quantity='+d.quantity+'&style='+encodeURIComponent(d.style||'')+'&guest='+(this.data.cart?.guest?'1':'0')+'&section=purchase');
  },
  browseProducts(){wx.switchTab({url:'/pages/products/index'});},
  goCheckout(){
    if(!this.data.cart?.items.length||this.data.cart.hasUnavailable||this.data.error||this.data.loading||this.data.updatingItemId||this.data.syncBlocked||this.removalPending)return;
    if(!hasSession()){rememberCheckoutLoginReturn();wx.switchTab({url:'/pages/account/index'});return;}
    if(this.data.cart.guest){this.loadCart();return;}
    if(!config.checkoutEnabled){wx.showModal({title:'结算暂未开放',content:'所选商品已保留，您可稍后再来。',showCancel:false});return;}
    navigateToPage('/pages/checkout/index');
  },
}, ["browseProducts","retry","useAccountBag","openProduct","editVariant","changeQuantity","removeItem","goCheckout"], {"tabBar":true}));
function cartError(code){
  const messages={PRODUCT_QUANTITY_LIMIT_EXCEEDED:'本机商品与账户商品合并后超过选购上限。请调整本机商品，或使用账户购物袋。',QUANTITY_LIMIT_EXCEEDED:'已达到此商品的选购数量上限。',INSUFFICIENT_INVENTORY:'该尺码库存不足，请调整数量或移除后再同步。',SKU_NOT_FOUND:'部分商品规格已失效，请调整或移除后再同步。',CART_SYNC_PENDING:'购物袋同步结果尚未确认，请先重试。',CART_SYNC_ACCOUNT_CHANGED:'本机还有其他账户的同步记录，请使用原账户重试。',CART_CHANGED:'购物袋已变化，请刷新后重试。'};
  return messages[code]||'本机商品仍已保留。购物袋尚未同步，请稍后重试。';
}

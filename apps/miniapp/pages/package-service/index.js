import { servicePage } from '../../utils/service-page';
import { navigateToPage } from '../../utils/navigation';
Page(servicePage('/pages/package-service/index', {
  openService(event) {
    if (!this.ensureServiceAccess()) return;
    const service=event.currentTarget.dataset.service;
    const routes={size:'/pages/size-guide/index',care:'/pages/care-guide/index','after-sales':'/pages/after-sales/index'};
    if(Object.prototype.hasOwnProperty.call(routes,service))navigateToPage(routes[service]);
    else if(service==='member')wx.switchTab({url:'/pages/account/index',fail:()=>wx.showToast({title:'暂时无法打开，请重试',icon:'none'})});
  },
  openHelp(){navigateToPage('/pages/contact/index');},
  goShopping(){wx.switchTab({url:'/pages/home/home'});},
},['openService','openHelp','goShopping']));

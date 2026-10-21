import { config } from '../config/index';

export function customerServiceContext(input={}) {
  const scene=['product','order'].includes(input.scene)?input.scene:'general';
  const slug=typeof input.slug==='string'&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(input.slug)?input.slug:'';
  const style=['regular','upgraded'].includes(input.styleKey)?input.styleKey:'';
  const orderNo=typeof input.orderNo==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(input.orderNo)?input.orderNo:'';
  const session={scene};
  if(scene==='product'&&slug){session.slug=slug;if(style)session.style=style;}
  if(scene==='order'&&orderNo)session.orderNo=orderNo;
  let image=typeof input.image==='string'?input.image:'';
  if(image.startsWith('/assets/'))image=config.websiteBaseUrl+image;
  if(!image.startsWith(config.websiteBaseUrl+'/assets/')&&!image.startsWith(config.websiteBaseUrl+'/_next/image?url=%2Fassets%2F'))image='';
  return {
    sessionFrom:JSON.stringify(session),showMessageCard:scene==='product'&&!!slug,
    messageTitle:scene==='product'&&slug?String(input.productName||'商品咨询').slice(0,64)+(style==='upgraded'?' · 升级款':style==='regular'?' · 常规款':''):'联系 MerchantKit',
    messagePath:scene==='product'&&slug?'pages/product-detail/index?slug='+encodeURIComponent(slug)+(style?'&style='+style:''):'pages/home/home',messageImage:image,
  };
}

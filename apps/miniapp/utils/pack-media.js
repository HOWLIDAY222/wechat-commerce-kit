import {resolveProductImage} from './url';
export function packImage(product,quantity,width=384){
  if(product?.slug==='x1-air-white'&&Number.isInteger(quantity)&&quantity>=1&&quantity<=4){
    return resolveProductImage(`/assets/catalog/x1-air-white/vk-20261014-packs/pack-${quantity}-750.webp`,width);
  }
  return product?.bagImage||product?.image||'';
}

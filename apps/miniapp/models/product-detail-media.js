import { resolveAssetUrl } from '../utils/url';
import { X1_PRODUCT_DETAIL_COPY } from '../content/product-detail-copy';

export function normalizeDetailMedia(images) {
  if(!Array.isArray(images))return [];
  return images.filter(image=>image && ['all','upgraded'].includes(image.style) && image.url && image.mobileUrl && image.width>0 && image.height>0 && image.mobileWidth>0 && image.mobileHeight>0).map(image=>({
    ...image,
    imageUrl:resolveAssetUrl(image.mobileUrl),
    previewUrl:resolveAssetUrl(image.url),
    aspectPercent:100*image.mobileHeight/image.mobileWidth,
  }));
}

export function detailMediaForStyle(product, style) {
  const images=product?.detailMedia||[];
  return {
    commonDetailMedia:images.filter(image=>image.style==='all'),
    styleDetailMedia:style==='upgraded'?images.filter(image=>image.style==='upgraded'):[],
    detailSections:product?.slug==='x1-air-white'?Object.keys(X1_PRODUCT_DETAIL_COPY).filter(id=>style==='upgraded'||id!=='upgraded-gusset-material').map(id=>{
      const image=images.find(image=>image.id===id&&(id==='upgraded-gusset-material'?image.style==='upgraded':image.style==='all'));
      return image?.detail||X1_PRODUCT_DETAIL_COPY[id];
    }):[],
  };
}

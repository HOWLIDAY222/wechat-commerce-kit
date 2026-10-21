// Optional films must be supplied by the deployer with its own rights.
export function productGallery(product){
 const images=(product?.images||[]).filter(Boolean).map((source,imageIndex)=>({id:'image-'+imageIndex,type:'image',source,imageIndex,thumbnail:product.thumbImages?.[imageIndex]||source,title:'商品图片 '+(imageIndex+1)}));
 const source=typeof product?.videoUrl==='string'&&/^https:\/\//.test(product.videoUrl)?product.videoUrl:'';
 const productFilm=source?{id:'product-film',type:'video',title:'商品影片',source,poster:product.videoPoster||product.images?.[0]||''}:null;
 return {galleryMedia:productFilm?[productFilm,...images]:images,productFilm,galleryHeight:productFilm?562.5:750};
}
export function galleryImageHeight(width,height){const ratio=Number(height)/Number(width);return Number.isFinite(ratio)&&ratio>0?Math.max(350,Math.min(1500,750*ratio)):750;}

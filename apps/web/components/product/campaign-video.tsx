import Image from 'next/image';
export const X1_CAMPAIGN_POSTER='/assets/demo/product.png';
// Community artwork replaces the excluded commercial film.
export function CampaignVideo({english=false,priority=false}:{english?:boolean;priority?:boolean}){return <figure style={{margin:0,background:'#efefed'}}><Image src={X1_CAMPAIGN_POSTER} alt={english?'Fictional demo product':'虚构示例商品'} width={800} height={1000} priority={priority} style={{display:'block',width:'100%',height:'auto'}}/></figure>;}
export function ProductCampaignFilm({english=false}:{english?:boolean}){return <section aria-label={english?'Demo product artwork':'示例商品图'}><CampaignVideo english={english}/></section>;}

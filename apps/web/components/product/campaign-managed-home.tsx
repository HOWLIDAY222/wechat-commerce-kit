import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CampaignVideo } from "./campaign-video";
import { ProductCard } from "./product-card";
import { resolvePageHref, sitePageDefinitions, type PageDocument } from "@/lib/site-builder";
import type { StorefrontProduct } from "@/lib/storefront-product";
import { formatProductPrice } from "@/lib/storefront-product";
import { isPubliclyOfferedProduct } from "@/lib/storefront-visibility";
import "./campaign-home.css";

type Asset = { id: string; url: string; altText: string | null; name: string };

// The live page and draft preview both render this document, including visibility and order.
export function CampaignManagedHome({ document, assets, products }: { document: PageDocument; assets: Map<string, Asset>; products: StorefrontProduct[] }) {
  const sections = document.sections.filter(s => s.visible).slice().sort((a,b) => a.sortOrder-b.sortOrder);
  return <main className="campaign-home">{sections.map(section => {
    if(section.type === "hero") {
      return <section key={section.id} id={section.id} className="campaign-opening campaign-film-opening" aria-labelledby={`${section.id}-heading`}>
        <CampaignVideo priority hero />
        <div className="campaign-intro">{section.eyebrow&&<p>{section.eyebrow}</p>}<h1 id={`${section.id}-heading`}>{section.title}</h1><p>{section.body}</p><Link className="campaign-link" href={resolvePageHref(section.action,sitePageDefinitions)}>{section.action.label}<ArrowUpRight size={18}/></Link>{section.features.length>0 && <p>{section.features.join(" · ")}</p>}</div>
      </section>;
    }
    if(section.type === "productGrid") {
      const selected=section.productIds.map(id=>products.find(p=>p.id===id)).filter((p):p is StorefrontProduct=>!!p && isPubliclyOfferedProduct(p));
      const banner=section.mediaAssetId?assets.get(section.mediaAssetId):null;
      return <section key={section.id} id={section.id} className="campaign-shop">
        {banner&&<Image className="campaign-closing-photo" src={banner.url} alt={banner.altText||banner.name} width={1271} height={617} sizes="100vw"/>}
        {section.layout==='spotlight'?selected.map(product=><div key={product.id} className="campaign-shop-inner"><Link className="campaign-shop-photo" href={`/products/${product.slug}`}><Image src={product.image} alt={product.name} width={560} height={560} sizes="(max-width:767px) 40vw,280px"/></Link><div className="campaign-shop-copy"><h2>{section.title}</h2><p>{section.body||product.summary}</p>{product.release.showPrice&&<p className="campaign-price">{formatProductPrice(product)}</p>}<Link className="minimal-primary" href={resolvePageHref(section.action,sitePageDefinitions)}>{section.action.label}<ArrowUpRight size={18}/></Link><p className="campaign-availability">{product.release.statusLabel}{product.release.estimatedShipAt&&` · 预计 ${new Date(product.release.estimatedShipAt).toLocaleDateString('zh-CN',{timeZone:'Asia/Shanghai'})}前发货`}</p></div></div>):<><div className="campaign-heading"><h2>{section.title}</h2>{section.body&&<p>{section.body}</p>}<Link className="campaign-link" href={resolvePageHref(section.action,sitePageDefinitions)}>{section.action.label}<ArrowUpRight size={18}/></Link></div><div className="grid grid-cols-2 gap-1 md:grid-cols-4">{selected.map(product=><ProductCard key={product.id} product={product}/>)}</div></>}
        {!selected.length&&<p className="px-5 py-10">新品即将与您见面。</p>}</section>;
    }
    const layout=section.type==='categoryGrid'?'grid':section.layout||'grid';
    return <section key={section.id} id={section.id} className="campaign-wearing"><div className="campaign-heading"><h2>{section.title}</h2>{'body' in section&&section.body&&<p>{section.body}</p>}{'action' in section&&section.action&&<Link className="campaign-link" href={resolvePageHref(section.action,sitePageDefinitions)}>{section.action.label}<ArrowUpRight size={18}/></Link>}</div><div className={layout==='grid'?'grid gap-6 px-5 pb-12 md:px-8':`campaign-pair ${layout==='fitPair'?'campaign-fit-pair':'campaign-detail-pair'}`} style={layout==='grid'?{gridTemplateColumns:`repeat(${section.type === "categoryGrid" ? Math.min(section.items.length,2) : section.columns}, minmax(0, 1fr))`}:undefined}>{section.items.map(item=>{
      const asset=item.mediaAssetId ? assets.get(item.mediaAssetId):null;
      const content=<>{asset && <Image className="w-full h-auto" src={asset.url} alt={asset.altText || item.title} width={1200} height={1500} sizes="50vw"/>}{item.title&&<h3 className={layout==='grid'?'mt-5 text-xl':'px-5 py-5 text-sm'}>{item.title}</h3>}{item.body&&<p className="mt-3 whitespace-pre-line text-sm leading-7 text-black/65">{item.body}</p>}{"table" in item && item.table && <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr>{item.table.headers.map((h,i)=><th key={i} className="p-2 border-b">{h}</th>)}</tr></thead><tbody>{item.table.rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j} className="p-2 border-b">{cell}</td>)}</tr>)}</tbody></table></div>}{item.link && <span className="campaign-link mt-4">{item.link.label}<ArrowUpRight size={18}/></span>}</>;
      return <article key={item.id}>{item.link ? <Link href={resolvePageHref(item.link,sitePageDefinitions)}>{content}</Link>:content}</article>;
    })}</div></section>;
  })}{!sections.length && <p className="px-5 py-24 text-center">页面内容正在更新，请稍后再试。</p>}</main>;
}

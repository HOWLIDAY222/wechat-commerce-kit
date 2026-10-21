import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CampaignVideo } from "./campaign-video";
import "./campaign-home.css";

const campaign = "/assets/campaign/20260912";

export function CampaignHome({ href, action, price, note, productImage, english = false }: {
  href: string; action: string; price: string | null; note: string; productImage: string; english?: boolean;
}) {
  return <main className="campaign-home">
    <section className="campaign-opening campaign-film-opening" aria-labelledby="campaign-title">
      <CampaignVideo english={english} priority hero />
      <div className="campaign-intro">
        <h1 id="campaign-title">X1 Air</h1>
        <p>{english ? "The white low-rise brief." : "白色低腰三角内裤"}</p>
        <Link className="campaign-link" href={href} data-vk-event="home_campaign_explore">{english ? "Explore X1 Air" : "探索 X1 Air"}<ArrowUpRight aria-hidden="true" size={18} /></Link>
      </div>
    </section>

    <section className="campaign-wearing" aria-labelledby="campaign-fit-title">
      <div className="campaign-heading">
        <h2 id="campaign-fit-title">{english ? "Every angle. X1 Air." : "每一面，都是 X1 Air。"}</h2>
        <p>{english ? "Low-rise cut. Available in S, M and L." : "低腰剪裁。S / M / L。"}</p>
      </div>
      <div className="campaign-pair campaign-fit-pair">
        <Image src={`${campaign}/IMG_0591.JPG`} alt={english ? "X1 Air white brief, front fit" : "X1 Air 白色内裤正面穿着效果"} width={1274} height={2160} sizes="50vw" />
        <Image src={`${campaign}/IMG_0584.JPG`} alt={english ? "X1 Air white brief, back fit" : "X1 Air 白色内裤背面穿着效果"} width={1428} height={2574} sizes="50vw" />
      </div>
    </section>

    <section aria-labelledby="campaign-detail-title">
      <div className="campaign-heading">
        <h2 id="campaign-detail-title">{english ? "A closer look." : "细节，近一点看。"}</h2>
        <Link className="campaign-link" href={href}>{english ? "Discover the details" : "了解产品细节"}<ArrowUpRight aria-hidden="true" size={18} /></Link>
      </div>
      <div className="campaign-pair campaign-detail-pair">
        <figure>
          <Image src={`${campaign}/IMG_0592.JPG`} alt={english ? "Contoured front and wide waistband" : "立体前片与宽腰带特写"} width={1280} height={1080} sizes="50vw" />
          <figcaption>{english ? "Contoured front" : "立体前片"}</figcaption>
        </figure>
        <figure>
          <Image src={`${campaign}/IMG_0597.JPG`} alt={english ? "Mesh side panel and embossed waistband" : "侧片网眼与腰带压印特写"} width={1281} height={1072} sizes="50vw" />
          <figcaption>{english ? "Mesh side panels" : "侧片网眼"}</figcaption>
        </figure>
      </div>
    </section>

    <section className="campaign-shop" aria-labelledby="campaign-shop-title">
      <Image className="campaign-closing-photo" src={`${campaign}/IMG_0594.JPG`} alt={english ? "MerchantKit campaign, back and waistband detail" : "MerchantKit 背部与腰带品牌影像"} width={1271} height={617} sizes="100vw" />
      <div className="campaign-shop-inner">
        <Link className="campaign-shop-photo" href={href} aria-label={english ? "View X1 Air product" : "查看 X1 Air 商品"}>
          <Image src={productImage} alt={english ? "X1 Air white brief" : "X1 Air 白色低腰三角内裤"} width={560} height={560} sizes="(max-width: 767px) 40vw, 280px" />
        </Link>
        <div className="campaign-shop-copy">
          <h2 id="campaign-shop-title">X1 Air</h2>
          <p>{english ? "White · S / M / L" : "白色 · S / M / L"}</p>
          {price ? <p className="campaign-price">{price}</p> : null}
          <Link className="minimal-primary" href={href} data-vk-event="home_campaign_shop">{action}<ArrowUpRight aria-hidden="true" size={18} /></Link>
          {note ? <p className="campaign-availability">{note}</p> : null}
        </div>
      </div>
    </section>
  </main>;
}

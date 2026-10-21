import Image from "next/image";
import Link from "next/link";

export function MinimalProductHero({ name, description, colors, price, image, href, action, note, details, english = false }: {
  name: string; description: string; colors: string; price: string | null; image: string;
  href: string; action: string; note: string; details: string; english?: boolean;
}) {
  return <main className="minimal-home">
    <section className="minimal-hero" aria-labelledby="minimal-product-title">
      <div className="minimal-hero-image"><Image alt={`${name} ${english ? "product photograph" : "商品实拍"}`} src={image} fill priority sizes="(max-width: 767px) calc(100vw - 40px), 57vw" className="object-cover" /></div>
      <div className="minimal-hero-copy">
        <h1 id="minimal-product-title">{name}</h1>
        <p className="minimal-hero-description">{description}</p>
        <p className="minimal-hero-colors">{colors}</p>
        {price ? <p className="minimal-hero-price">{price}</p> : null}
        <Link className="minimal-primary" href={href}>{action}</Link>
        {note ? <p className="minimal-hero-note">{note}</p> : null}
      </div>
    </section>
    <div className="minimal-detail-line"><span>{english ? "Details" : "细节"}</span><p>{details}</p></div>
  </main>;
}

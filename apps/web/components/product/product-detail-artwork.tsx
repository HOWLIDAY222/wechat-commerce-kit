import type { ProductDetailImage } from "@/lib/product-detail-media";

export function ProductDetailArtwork({ images = [], english = false }: { images?: ProductDetailImage[]; english?: boolean }) {
  if (!images.length) return null;
  const common = images.filter(image => image.style === "all");
  const upgraded = images.filter(image => image.style === "upgraded");
  return <section className="mt-12 border-t border-black/10 pt-8" aria-label={english ? "Product detail images" : "商品细节图"}>
    <h2 className="text-2xl">{english ? "Product artwork" : "商品展示"}</h2>
    {english ? <p className="mt-3 text-sm leading-7 text-muted">Product detail artwork in Chinese, with English captions.</p> : null}
    <ArtworkGrid images={common} english={english} />
    {upgraded.length ? <section className="mt-10" aria-label={english ? "Upgraded gusset only" : "升级款裆部说明"}>
      <h3 className="text-xl font-semibold">{english ? "Upgraded gusset" : "升级款 · 裆部升级"}</h3>
      <ArtworkGrid images={upgraded} english={english} />
    </section> : null}
  </section>;
}

function ArtworkGrid({ images, english }: { images: ProductDetailImage[]; english: boolean }) {
  return <div className="mt-6 grid items-start gap-6 sm:grid-cols-2">{images.map(image => <figure className="min-w-0 overflow-hidden rounded-lg bg-[#f4f3f1]" key={image.id} data-detail-style={image.style}>
    <picture><source media="(max-width: 767px)" srcSet={image.mobileUrl} /><img alt={english ? image.titleEn : image.title} src={image.url} width={image.width} height={image.height} loading="lazy" decoding="async" className="block h-auto w-full" /></picture>
    <figcaption className="px-5 py-5 text-sm leading-7">
      {image.detail ? <>
        <h4 className="flex items-baseline gap-3 text-base font-semibold"><span className="text-xs font-normal tracking-widest text-muted">{image.detail.number}</span>{english ? image.detail.titleEn : image.detail.title}</h4>
        <p className="mt-3 text-muted">{english ? image.detail.bodyEn : image.detail.body}</p>
      </> : <p>{english ? image.titleEn : image.title}</p>}
    </figcaption>
  </figure>)}</div>;
}

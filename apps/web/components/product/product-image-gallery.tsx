"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Play } from "lucide-react";
import { BrandLoader } from "@/components/brand-loader";
import { CampaignVideo, X1_CAMPAIGN_POSTER } from "./campaign-video";
import styles from "./product-media.module.css";

type GalleryProps = { images: string[]; name: string; productSlug?: string; english?: boolean };

export function ProductImageGallery({ images, name, productSlug, english = false }: GalleryProps) {
  const photographs = [...new Set(images.filter(Boolean))];
  const hasFilm = productSlug === "x1-air-white";
  const media = photographs.flatMap((src, index) => index === 0 && hasFilm ? [src, "film"] : [src]);
  const [active, setActive] = useState(media[0]);
  if (!media.length) return null;
  const selected = media.includes(active) ? active : media[0];

  return <section className={`minimal-product-gallery ${styles.gallery}`} aria-label={english ? "Product images and film" : "商品图片与影片"}>
    {selected === "film" ? <CampaignVideo english={english} /> : <GalleryPhotograph key={selected} src={selected} name={name} english={english} />}
    <div className={styles.thumbnails}>
      {media.map((src, index) => <button type="button" aria-label={src === "film" ? (english ? "View brand film" : "查看品牌影片") : (english ? `View product image ${index + 1}` : `查看商品图片 ${index + 1}`)} aria-pressed={selected === src} className={styles.thumbnail} onClick={() => setActive(src)} key={src}>
        <Image alt="" src={src === "film" ? X1_CAMPAIGN_POSTER : src} fill sizes="68px" className="object-contain" />
        {src === "film" ? <span className={styles.thumbnailPlay}><Play fill="currentColor" aria-hidden="true" /></span> : null}
      </button>)}
    </div>
    <p className={styles.mediaCaption}>{selected === "film" ? (english ? "X1 Air · Brand film · Sound off by default" : "X1 Air · 品牌影片 · 默认静音") : (english ? "Complete photograph · Select a thumbnail for another view" : "完整展示 · 点击缩略图切换角度")}</p>
  </section>;
}

function GalleryPhotograph({ src, name, english }: { src: string; name: string; english: boolean }) {
  const image = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (state !== "loading") return;
    const timer = window.setTimeout(() => setState("error"), 15000);
    return () => window.clearTimeout(timer);
  }, [state, attempt]);
  return <div className={styles.imageFrame} aria-busy={state === "loading"}>
    <Image key={attempt} ref={image} alt={name} src={src} fill priority className="object-contain" sizes="(max-width: 767px) 100vw, 57vw"
      onLoad={() => setState("ready")} onError={() => setState("error")} />
    {state === "loading" ? <BrandLoader fill label={english ? "Loading photograph" : "正在加载商品图片"} /> : null}
    {state === "error" ? <div className={styles.imageError} role="alert"><p>{english ? "This photograph could not load. Choose another view or retry." : "这张图片暂时无法加载，可切换其他角度或重试。"}</p><button type="button" onClick={() => { setState("loading"); setAttempt(value => value + 1); }}>{english ? "Try again" : "重新加载"}</button></div> : null}
  </div>;
}

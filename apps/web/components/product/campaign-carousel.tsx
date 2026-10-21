"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Pause, Play } from "lucide-react";
import { campaignAsset } from "@/lib/campaign-assets";

const desktop = campaignAsset("IMG_0606");
const mobile = campaignAsset("IMG_0609");
const posters = [
  { width: 1611, height: 1074, zh: "黑色衬衫与 X1 Air", en: "Black shirt and X1 Air" },
  { width: 886, height: 1073, zh: "黑色背心与 X1 Air", en: "Black tank and X1 Air" },
  { width: 960, height: 1802, zh: "X1 Air 背面穿着效果", en: "X1 Air back fit" },
  { width: 958, height: 2160, zh: "黑色 T 恤与 X1 Air", en: "Black T-shirt and X1 Air" },
  { width: 958, height: 1791, zh: "灰色开衫与 X1 Air", en: "Grey cardigan and X1 Air" },
];
const total = posters.length + 1;

export function CampaignCarousel({ english = false }: { english?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(0);
  const [displayed, setDisplayed] = useState(0);
  const [loaded, setLoaded] = useState<number[]>([]);
  const [visited, setVisited] = useState<number[]>([0]);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [inView, setInView] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reduced, setReduced] = useState(true);
  const firstImageRef = useCallback((image: HTMLImageElement | null) => {
    // The server-rendered first image may finish before hydration attaches onLoad.
    if (image?.complete && image.naturalWidth > 0) setLoaded(items => items.includes(0) ? items : [...items, 0]);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotion = () => setReduced(media.matches);
    const updateVisibility = () => setHidden(document.hidden);
    updateMotion(); updateVisibility();
    media.addEventListener("change", updateMotion);
    document.addEventListener("visibilitychange", updateVisibility);
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.2 });
    if (root.current) observer.observe(root.current);
    return () => { observer.disconnect(); media.removeEventListener("change", updateMotion); document.removeEventListener("visibilitychange", updateVisibility); };
  }, []);

  // Only the next poster is warmed after the current image has loaded.
  useEffect(() => {
    if (!inView || hidden || !loaded.includes(displayed)) return;
    const next = (displayed + 1) % total;
    const timer = window.setTimeout(() => setVisited(items => items.includes(next) ? items : [...items, next]), 800);
    return () => window.clearTimeout(timer);
  }, [displayed, loaded, inView, hidden]);

  const rotating = !paused && !hovered && !focused && !reduced && !hidden && inView;
  useEffect(() => {
    if (!rotating || !loaded.includes(selected)) return;
    const timer = window.setTimeout(() => {
      const next = (selected + 1) % total;
      setVisited(items => items.includes(next) ? items : [...items, next]);
      setSelected(next);
      if (loaded.includes(next)) setDisplayed(next);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [rotating, loaded, selected]);

  function select(index: number) {
    const next = (index + total) % total;
    setPaused(true);
    setVisited(items => items.includes(next) ? items : [...items, next]);
    setSelected(next);
    if (loaded.includes(next)) setDisplayed(next);
  }
  function ready(index: number) {
    setLoaded(items => items.includes(index) ? items : [...items, index]);
    if (index === selected) setDisplayed(index);
  }

  return <div ref={root} className="campaign-carousel" role="region" aria-roledescription={english ? "carousel" : "轮播"} aria-label={english ? "X1 Air campaign posters" : "X1 Air 品牌海报"}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}
    onKeyDown={event => { if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); select(selected + (event.key === "ArrowRight" ? 1 : -1)); } }}>
    <div className="campaign-carousel-stage" aria-live={rotating ? "off" : "polite"}>
      <div className={`campaign-slide ${displayed === 0 ? "is-active" : ""}`} aria-hidden={displayed !== 0}><picture className="campaign-hero-picture">
        <source media="(max-width: 767px)" srcSet={mobile.srcSet} sizes="100vw" width={1837} height={2160} />
        {/* Pre-sized sources retain the supplied lettering and avoid runtime image transforms. */}
        <img ref={firstImageRef} {...desktop} alt={english ? "MerchantKit — X1 Air campaign" : "MerchantKit · X1 Air 品牌大片"} width={1920} height={1080} sizes="100vw" loading="eager" fetchPriority="high" onLoad={() => ready(0)} />
      </picture></div>
      {posters.map((poster, index) => {
        const slide = index + 1;
        if (!visited.includes(slide)) return null;
        const widths = [480, 768, Math.min(poster.width, 1280)];
        const asset = (width: number) => `/assets/campaign/20260917/campaign-${slide}-${width}.webp`;
        return <div key={slide} className={`campaign-slide ${displayed === slide ? "is-active" : ""}`} aria-hidden={displayed !== slide}>
          {/* Static responsive WebP assets are already optimized; no first-visitor transform. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={asset(widths[2])} srcSet={widths.map(width => `${asset(width)} ${width}w`).join(", ")} sizes={`(max-width: 767px) 100vw, ${Math.ceil(56.25 * poster.width / poster.height)}vw`} width={poster.width} height={poster.height} alt={`MerchantKit · ${english ? poster.en : poster.zh}`} decoding="async" fetchPriority="low" onLoad={() => ready(slide)} />
        </div>;
      })}
    </div>
    <div className="campaign-carousel-controls">
      <div className="campaign-carousel-dots" aria-label={english ? "Choose a poster" : "选择海报"}>
        {Array.from({ length: total }, (_, index) => <button key={index} type="button" aria-label={english ? `Show poster ${index + 1}` : `查看第 ${index + 1} 张海报`} aria-current={displayed === index ? "true" : undefined} onClick={() => select(index)}><span /></button>)}
      </div>
      <span className="campaign-carousel-count" aria-hidden="true">{String(displayed + 1).padStart(2, "0")} / 06</span>
      <button type="button" aria-label={english ? "Previous poster" : "上一张海报"} onClick={() => select(selected - 1)}><ArrowLeft size={17} aria-hidden="true" /></button>
      <button type="button" aria-label={english ? "Next poster" : "下一张海报"} onClick={() => select(selected + 1)}><ArrowRight size={17} aria-hidden="true" /></button>
      {!reduced && <button type="button" aria-label={paused ? (english ? "Play slideshow" : "播放轮播") : (english ? "Pause slideshow" : "暂停轮播")} onClick={() => setPaused(value => !value)}>{paused ? <Play size={15} aria-hidden="true" /> : <Pause size={15} aria-hidden="true" />}</button>}
    </div>
  </div>;
}

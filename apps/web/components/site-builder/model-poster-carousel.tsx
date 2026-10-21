"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

const AUTOPLAY_DELAY_MS = 5_000;

export function ModelPosterCarousel({ images, locale = "zh-CN", productName }: { images: readonly string[]; locale?: "zh-CN" | "en"; productName: string }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const imageCount = images.length;

  useEffect(() => {
    if (paused || imageCount < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setActiveIndex((current) => (current + 1) % imageCount), AUTOPLAY_DELAY_MS);
    return () => window.clearInterval(timer);
  }, [imageCount, paused]);

  function showPrevious() {
    setActiveIndex((current) => (current - 1 + imageCount) % imageCount);
  }

  function showNext() {
    setActiveIndex((current) => (current + 1) % imageCount);
  }

  if (!imageCount) return null;

  return (
    <section
      aria-label={locale === "en" ? `${productName} campaign images` : `${productName} 模特海报轮播`}
      aria-roledescription={locale === "en" ? "carousel" : "轮播图"}
      className="relative h-full min-h-[440px] overflow-hidden bg-[#d4ccc6] md:min-h-full"
      data-testid="x1-model-carousel"
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
      }}
      onFocusCapture={() => setPaused(true)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {images.map((image, index) => {
        const active = index === activeIndex;
        return (
          <div
            aria-hidden={!active}
            className={`absolute inset-0 transition-opacity duration-700 motion-reduce:transition-none ${active ? "opacity-100" : "pointer-events-none opacity-0"}`}
            key={image}
          >
            <Image
              alt={active ? (locale === "en" ? `${productName} campaign image ${index + 1}` : `${productName} 模特海报 ${index + 1}`) : ""}
              className="object-contain object-center"
              fill
              priority={index === 0}
              sizes="(max-width: 767px) 100vw, 50vw"
              src={image}
            />
          </div>
        );
      })}

      {imageCount > 1 ? (
        <div className="absolute inset-x-0 bottom-4 z-10 flex items-center justify-center gap-3 px-4 md:bottom-6">
          <button aria-label={locale === "en" ? "Previous image" : "上一张模特海报"} className="flex h-10 w-10 items-center justify-center rounded-full border border-white/55 bg-black/45 text-2xl leading-none text-white backdrop-blur-sm transition hover:bg-black/65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" onClick={showPrevious} type="button"><span aria-hidden="true">‹</span></button>
          <div aria-label={locale === "en" ? "Choose an image" : "选择模特海报"} className="flex items-center gap-2 rounded-full bg-black/45 px-3 py-2 backdrop-blur-sm" role="group">
            {images.map((image, index) => <button aria-label={locale === "en" ? `View image ${index + 1}` : `查看第 ${index + 1} 张模特海报`} aria-pressed={index === activeIndex} className={`h-2 rounded-full transition-all ${index === activeIndex ? "w-6 bg-white" : "w-2 bg-white/55 hover:bg-white/80"}`} key={image} onClick={() => setActiveIndex(index)} type="button" />)}
          </div>
          <button aria-label={locale === "en" ? "Next image" : "下一张模特海报"} className="flex h-10 w-10 items-center justify-center rounded-full border border-white/55 bg-black/45 text-2xl leading-none text-white backdrop-blur-sm transition hover:bg-black/65 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" onClick={showNext} type="button"><span aria-hidden="true">›</span></button>
        </div>
      ) : null}

      <p aria-live="polite" className="sr-only">{locale === "en" ? `Image ${activeIndex + 1} of ${imageCount}` : `第 ${activeIndex + 1} 张，共 ${imageCount} 张模特海报`}</p>
    </section>
  );
}

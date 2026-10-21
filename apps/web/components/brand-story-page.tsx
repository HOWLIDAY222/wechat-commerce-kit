import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import styles from "./brand-story-page.module.css";

type StorySection = { title: string; paragraphs?: string[] };

export function BrandStoryPage({ title, tagline, sections, english = false }: {
  title: string; tagline: string; sections: StorySection[]; english?: boolean;
}) {
  return <main className={styles.page}>
    <header className={styles.header}>
      <h1>{title}</h1>
      <div className={styles.signature}><BrandLogo size="hero" /></div>
      <p className={styles.tagline}>{tagline}</p>
    </header>
    <div className={styles.layout}>
      <figure className={styles.portrait}>
        {/* Static responsive assets preserve the full supplied image without a runtime transform. */}
        <picture>
          <source srcSet="/assets/campaign/20260917/campaign-2-480.webp 480w, /assets/campaign/20260917/campaign-2-768.webp 768w, /assets/campaign/20260917/campaign-2-886.webp 886w" sizes="(max-width: 767px) 100vw, 40vw" />
          <img src="/assets/campaign/20260917/campaign-2-886.webp" width={886} height={1073} alt={english ? "MerchantKit — black tank and X1 Air" : "MerchantKit · 黑色背心与 X1 Air 品牌影像"} loading="lazy" />
        </picture>
        <figcaption>Close to the body.</figcaption>
      </figure>
      <article className={styles.story} aria-label={english ? "Our story" : "品牌故事正文"}>
        {sections.map((section, sectionIndex) => <section key={`${sectionIndex}-${section.title}`} className={styles.chapter}>
          <h2 className="sr-only">{section.title}</h2>
          {section.paragraphs?.map((paragraph, index) => <p key={index} className={sectionIndex === 0 && index === 0 ? styles.lead : undefined}>{paragraph}</p>)}
        </section>)}
        <Link className={styles.explore} href={english ? "/en/products/x1-air-white" : "/products/x1-air-white"}>{english ? "Explore the demo product" : "查看示例商品"}<ArrowUpRight size={17} aria-hidden="true" /></Link>
      </article>
    </div>
  </main>;
}
